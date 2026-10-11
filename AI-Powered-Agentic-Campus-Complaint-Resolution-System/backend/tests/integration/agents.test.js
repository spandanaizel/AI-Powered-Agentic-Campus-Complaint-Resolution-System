import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupDb, teardownDb, makeUser, makeRefData, signIn, complaintInput } from '../helpers.js';
import { Complaint, AgentRun, Comment, User } from '../../src/models/index.js';
import { createComplaint } from '../../src/services/complaintService.js';
import { runIntake, runSummaryAgent, runPriorityAgent, runAssignmentAgent, runResponseAgent, setIntakeScheduler } from '../../src/agents/agents.js';
import { setProvider } from '../../src/agents/providers/index.js';
import { ProviderError } from '../../src/agents/providers/anthropic.js';
import { config } from '../../src/config/env.js';

let ref; let student;
const prompts = [];
/** Stub provider: responds per agent based on prompt content. */
const stub = (handlers) => ({
  name: 'anthropic', model: 'stub-model',
  async complete({ prompt }) {
    prompts.push(prompt);
    const key = /Summarise/.test(prompt) ? 'summary' : /urgency/.test(prompt) ? 'priority' : /Eligible staff/.test(prompt) ? 'assignment' : 'response';
    const h = handlers[key];
    if (typeof h === 'function') return h(prompt);
    return h;
  },
});
const newComplaint = async (over) => (await createComplaint({ user: student, input: complaintInput(ref, over) })).complaint;

beforeAll(async () => { await setupDb('agents'); ref = await makeRefData(); student = await makeUser('student'); });
afterAll(teardownDb);
beforeEach(async () => { prompts.length = 0; setProvider(null); config.agents.autoAssign = true; await User.deleteMany({ role: 'staff' }); });

describe('agents with a working (stubbed) provider', () => {
  it('summary + priority + assignment: outputs validated, stored with source, runs recorded', async () => {
    const s1 = await makeUser('staff', { categories: [ref.network._id] });
    const s2 = await makeUser('staff', { categories: [ref.network._id] });
    setProvider(stub({
      summary: '{"summary":"Wi-Fi down in Block A since morning.","keyFacts":["Block A","since morning"],"categoryHint":null,"limitations":null}',
      priority: '{"priority":"High","rationale":"Whole hostel block affected","confidence":0.7}',
      assignment: (p) => `{"staffId":"${p.includes(String(s2._id)) ? s2._id : s1._id}","reason":"Lower workload"}`,
    }));
    const c = await newComplaint();
    const r = await runIntake(c._id);
    expect(r.summary).toMatchObject({ source: 'anthropic', model: 'stub-model', text: 'Wi-Fi down in Block A since morning.' });
    expect(r.priority).toMatchObject({ predicted: 'High', source: 'anthropic', applied: true });
    expect(r.assignment).toMatchObject({ source: 'anthropic', applied: true });
    const saved = await Complaint.findById(c._id).lean();
    expect(saved).toMatchObject({ priority: 'High', prioritySource: 'ai', status: 'Assigned' });
    expect(String(saved.assignee)).toBe(String(s2._id));
    expect(await AgentRun.countDocuments({ complaint: c._id, status: 'success' })).toBe(3);
    // Privacy: prompts never include reporter identity.
    expect(prompts.join('\n')).not.toContain(student.email);
    expect(prompts.join('\n')).not.toContain(student.name);
  });

  it('malformed model output falls back, is labelled, and records the error category', async () => {
    setProvider(stub({ summary: 'I cannot help with that', priority: '{"priority":"Urgent!!","rationale":"x"}' }));
    const c = await newComplaint({ title: 'Exposed wire sparking', description: 'There is an exposed wire sparking near the hostel desk lamp.' });
    const s = await runSummaryAgent(c._id);
    const p = await runPriorityAgent(c._id);
    expect(s).toMatchObject({ source: 'fallback', errorCategory: 'malformed_output' });
    expect(s.limitations).toMatch(/not an AI summary/);
    expect(p).toMatchObject({ source: 'fallback', predicted: 'High', errorCategory: 'malformed_output' });
    expect((await Complaint.findById(c._id)).prioritySource).toBe('fallback-rules');
  });

  it('provider timeouts/rate limits never break the complaint workflow', async () => {
    setProvider({ name: 'anthropic', model: 'stub', complete: async () => { throw new ProviderError('timeout', 'slow'); } });
    const c = await newComplaint();
    const r = await runIntake(c._id);
    expect(r.summary.errorCategory).toBe('timeout');
    expect(r.priority.errorCategory).toBe('timeout');
    expect(await Complaint.exists({ _id: c._id })).toBeTruthy();
    expect(await AgentRun.countDocuments({ complaint: c._id, errorCategory: 'timeout' })).toBeGreaterThanOrEqual(2);
  });

  it('assignment guardrail: an id outside the eligible list is rejected and the rule fallback is used', async () => {
    const s1 = await makeUser('staff', { categories: [ref.network._id] });
    const s2 = await makeUser('staff', { categories: [ref.network._id] });
    const outsider = await makeUser('staff', { categories: [ref.hostel._id] });
    setProvider(stub({ assignment: `{"staffId":"${outsider._id}","reason":"x"}` }));
    const c = await newComplaint();
    const r = await runAssignmentAgent(c._id);
    expect(r).toMatchObject({ source: 'fallback', errorCategory: 'malformed_output', applied: true });
    const assignee = String((await Complaint.findById(c._id)).assignee);
    expect([String(s1._id), String(s2._id)]).toContain(assignee);
  });

  it('assignment never targets inactive staff or staff at capacity; no candidate leaves it unassigned', async () => {
    await makeUser('staff', { categories: [ref.network._id], active: false });
    const full = await makeUser('staff', { categories: [ref.network._id], maxOpenAssignments: 1 });
    await Complaint.create({ reporter: student._id, title: 'Existing load', description: 'An existing open complaint for capacity.', category: ref.network._id, location: ref.blockA._id, status: 'Assigned', assignee: full._id });
    const c = await newComplaint();
    const r = await runAssignmentAgent(c._id);
    expect(r).toMatchObject({ applied: false, errorCategory: 'no_candidates' });
    expect(r.reason).toMatch(/capacity/);
    expect((await Complaint.findById(c._id)).assignee).toBeNull();
  });

  it('AI prediction never overrides escalation or a human override', async () => {
    setProvider(stub({ priority: '{"priority":"Low","rationale":"minor"}' }));
    const c = await newComplaint();
    await Complaint.updateOne({ _id: c._id }, { $set: { priority: 'Critical', prioritySource: 'escalation' } });
    const r = await runPriorityAgent(c._id);
    expect(r.applied).toBe(false);
    expect((await Complaint.findById(c._id)).priority).toBe('Critical');
  });

  it('response agent: draft only, uses public thread but never internal notes, flags dates', async () => {
    const staff = await makeUser('staff', { categories: [ref.network._id] });
    const c = await newComplaint();
    await Complaint.updateOne({ _id: c._id }, { $set: { assignee: staff._id, status: 'In Progress' } });
    await Comment.create({ complaint: c._id, author: staff._id, body: 'SECRET internal: vendor contract issue', visibility: 'internal' });
    await Comment.create({ complaint: c._id, author: student._id, body: 'Any update please?', visibility: 'public' });
    setProvider(stub({ response: '{"draft":"Hello, a technician will visit tomorrow.","warnings":[]}' }));
    const before = await Comment.countDocuments({ complaint: c._id });
    const r = await runResponseAgent(c._id, { guidance: 'Technician booked' });
    expect(r.source).toBe('anthropic');
    expect(r.warnings.join(' ')).toMatch(/date or time/);
    expect(prompts.at(-1)).toContain('Any update please?');
    expect(prompts.at(-1)).not.toContain('SECRET internal');
    expect(await Comment.countDocuments({ complaint: c._id })).toBe(before); // nothing sent automatically
  });
});

describe('agents with NO provider configured', () => {
  it('every agent returns a clearly labelled non-AI result and records no_provider', async () => {
    await makeUser('staff', { categories: [ref.network._id] });
    const c = await newComplaint();
    const r = await runIntake(c._id);
    expect(r.summary.source).toBe('fallback');
    expect(r.priority.source).toBe('fallback');
    expect(r.assignment.applied).toBe(true); // single eligible staff: deterministic rule
    const d = await runResponseAgent(c._id);
    expect(d.source).toBe('fallback');
    expect(d.warnings[0]).toMatch(/not an AI draft/);
    expect(await AgentRun.countDocuments({ complaint: c._id, errorCategory: 'no_provider' })).toBe(3);
  });
});

describe('agent API access control', () => {
  it('students cannot call agents; staff only on assigned complaints; intake runs after create', async () => {
    const staff = await makeUser('staff', { categories: [ref.network._id] });
    const other = await makeUser('staff', { categories: [ref.network._id] });
    let pending;
    setIntakeScheduler((fn) => { pending = fn(); });
    const A = await signIn(student);
    const created = await A.post('/api/complaints').field(complaintInput(ref));
    await pending; // intake ran after the response was sent
    setIntakeScheduler(() => {});
    const id = created.body.complaint._id;
    const assignee = String((await Complaint.findById(id)).assignee);
    const mine = assignee === String(staff._id) ? staff : other;
    const notMine = mine === staff ? other : staff;
    expect((await A.post(`/api/complaints/${id}/agents/summary`)).status).toBe(403);
    expect((await (await signIn(notMine)).post(`/api/complaints/${id}/agents/response-draft`).send({})).status).toBe(404);
    const ok = await (await signIn(mine)).post(`/api/complaints/${id}/agents/response-draft`).send({ guidance: 'Router replaced' });
    expect(ok.status).toBe(200);
    expect(ok.body.result.draft).toBeTruthy();
    expect((await (await signIn(mine)).post(`/api/complaints/${id}/agents/priority`)).status).toBe(403);
  });
});
