import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupDb, teardownDb, makeUser, makeRefData, signIn, complaintInput } from '../helpers.js';
import { startMockGemini, completed, apiError, agentReply } from '../mockGemini.js';
import { Complaint, AgentRun, User, Comment } from '../../src/models/index.js';
import { createComplaint } from '../../src/services/complaintService.js';
import { createGeminiProvider } from '../../src/agents/providers/gemini.js';
import { setProvider } from '../../src/agents/providers/index.js';
import {
  runIntake, runResolutionSuggestions, runResponseAgent, runEvidenceReview, setIntakeScheduler,
} from '../../src/agents/agents.js';

// All four agents running on the real Gemini adapter + real @google/genai SDK, against a local mock
// of the Gemini API. No live Google calls are made here.
const KEY = 'test-gemini-key-NOT-REAL-456';
let mock; let ref; let student; let admin;
const gemini = (over = {}) => createGeminiProvider({ apiKey: KEY, model: 'gemini-3.5-flash-lite', baseUrl: mock.baseUrl, timeoutMs: 1500, maxRequestsPerMinute: 0, ...over });
const promptOf = (body) => body.input;

beforeAll(async () => {
  mock = await startMockGemini();
  await setupDb('gemini');
  ref = await makeRefData();
  [student, admin] = await Promise.all([makeUser('student'), makeUser('admin')]);
});
afterAll(async () => { setProvider(null); await teardownDb(); await mock.close(); });
beforeEach(async () => { mock.reset(); setProvider(null); await User.deleteMany({ role: 'staff' }); });

const newComplaint = async (over) => (await createComplaint({ user: student, input: complaintInput(ref, over) })).complaint;

describe('all four agents on Gemini', () => {
  it('summary, priority and assignment succeed with source "gemini" and schema-constrained requests', async () => {
    const [s1, s2] = await Promise.all([1, 2].map(() => makeUser('staff', { categories: [ref.network._id] })));
    mock.state.handler = (body) => completed(agentReply(promptOf(body)));
    setProvider(gemini());
    const c = await newComplaint();
    const r = await runIntake(c._id);
    expect(r.summary).toMatchObject({ source: 'gemini', model: 'gemini-3.5-flash-lite', text: 'Library Wi-Fi drops on floor 2.' });
    expect(r.priority).toMatchObject({ source: 'gemini', predicted: 'High', applied: true });
    expect(r.assignment).toMatchObject({ source: 'gemini', applied: true });
    const saved = await Complaint.findById(c._id).lean();
    expect(saved).toMatchObject({ priority: 'High', prioritySource: 'ai', status: 'Assigned' });
    expect(await AgentRun.countDocuments({ complaint: c._id, source: 'gemini', status: 'success' })).toBe(3);

    const calls = mock.interactionCalls();
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.body).toMatchObject({ store: false, response_format: { mime_type: 'application/json' } });
    // Assignment schema: the staff id is limited to the validated candidates.
    const assignCall = calls.find((x) => promptOf(x.body).includes('Eligible staff'));
    expect([...assignCall.body.response_format.schema.properties.staffId.enum].sort()).toEqual([String(s1._id), String(s2._id)].sort());
    // Privacy: the reporter's identity is never sent to Gemini.
    expect(JSON.stringify(calls)).not.toContain(student.email);
  });

  it('Resolution and Response agent: all three tasks succeed on Gemini and change nothing', async () => {
    const staff = await makeUser('staff', { categories: [ref.network._id] });
    const c = await newComplaint();
    await Complaint.updateOne({ _id: c._id }, { $set: { assignee: staff._id, status: 'In Progress' } });
    mock.state.handler = (body) => completed(agentReply(promptOf(body)));
    setProvider(gemini());
    const s = await runResolutionSuggestions(c._id, { triggeredBy: staff });
    const d = await runResponseAgent(c._id, { guidance: 'AP replaced' });
    const e = await runEvidenceReview(c._id, { resolutionNote: 'Replaced AP-7 and tested from two rooms.' });
    expect(s).toMatchObject({ source: 'gemini', troubleshootingSteps: [{ step: 'Check AP-7', who: 'staff' }] });
    expect(d).toMatchObject({ source: 'gemini', requiresApproval: true });
    expect(e).toMatchObject({ source: 'gemini', assessment: 'likely_sufficient', verified: false });
    const after = await Complaint.findById(c._id).lean();
    expect(after.status).toBe('In Progress');
    expect(await Comment.countDocuments({ complaint: c._id })).toBe(0); // nothing sent automatically
    expect(await AgentRun.countDocuments({ complaint: c._id, agent: 'resolution', source: 'gemini' })).toBe(3);
  });

  it('Gemini output that fails zod validation falls back and is labelled', async () => {
    mock.state.handler = () => completed({ priority: 'URGENT!!', rationale: 'x' });
    setProvider(gemini());
    const c = await newComplaint({ title: 'Socket sparking', description: 'The socket near my desk is sparking and smells of smoke.' });
    const r = await runIntake(c._id);
    expect(r.priority).toMatchObject({ source: 'fallback', errorCategory: 'malformed_output', predicted: 'High' });
  });
});

describe('Gemini failures never break core workflows', () => {
  const scenarios = [
    ['per-minute rate limit (429)', () => apiError(429, 'rate_limit_exceeded'), 'rate_limited'],
    ['daily quota exceeded (429)', () => apiError(429, 'quota_exceeded'), 'quota_exceeded'],
    ['invalid API key (401)', () => apiError(401, 'authentication'), 'auth_error'],
    ['service unavailable (503)', () => apiError(503, 'service_unavailable'), 'provider_error'],
  ];
  for (const [label, response, category] of scenarios) {
    it(`${label}: submission and auto-assignment still work`, async () => {
      await makeUser('staff', { categories: [ref.network._id] });
      mock.state.handler = response;
      setProvider(gemini());
      let pending;
      setIntakeScheduler((fn) => { pending = fn(); });
      const S = await signIn(student);
      const res = await S.post('/api/complaints').field(complaintInput(ref, { title: `Wi-Fi down (${category})` }));
      await pending;
      setIntakeScheduler(() => {});
      expect(res.status).toBe(201);
      const saved = await Complaint.findById(res.body.complaint._id).lean();
      expect(saved.assignee).not.toBeNull(); // the deterministic assignment rule still applied
      expect(saved.status).toBe('Assigned');
      const runs = await AgentRun.find({ complaint: saved._id }).lean();
      expect(runs.filter((r) => r.agent !== 'assignment').every((r) => r.source === 'fallback' && r.errorCategory === category)).toBe(true);
    });
  }

  it('after a 429, later complaints fall back immediately without calling Gemini', async () => {
    mock.state.handler = () => apiError(429, 'rate_limit_exceeded');
    setProvider(gemini());
    await runIntake((await newComplaint())._id);
    const before = mock.interactionCalls().length;
    await runIntake((await newComplaint())._id);
    expect(before).toBe(1); // first agent call hit the 429; the rest of that intake was paused
    expect(mock.interactionCalls().length).toBe(before);
  });

  it('the API key is never stored or returned: agent runs, complaints and settings are clean', async () => {
    mock.state.handler = () => apiError(401, 'authentication', `API key ${KEY} not valid`);
    setProvider(gemini());
    const c = await newComplaint();
    await runIntake(c._id);
    const stored = JSON.stringify([await AgentRun.find().lean(), await Complaint.find().lean()]);
    expect(stored).not.toContain(KEY);
    const A = await signIn(admin);
    const settings = await A.get('/api/settings');
    expect(settings.body.agents.provider).toMatchObject({ configured: true, name: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(JSON.stringify(settings.body)).not.toContain(KEY);
  });
});
