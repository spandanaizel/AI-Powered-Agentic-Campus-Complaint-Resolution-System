import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupDb, teardownDb, makeUser, makeRefData, signIn, complaintInput } from '../helpers.js';
import { Complaint, Comment, AgentRun, AuditEvent, Category } from '../../src/models/index.js';
import { createComplaint, changeStatus } from '../../src/services/complaintService.js';
import { runResolutionSuggestions, runResponseAgent, runEvidenceReview } from '../../src/agents/agents.js';
import { EVIDENCE_LIMITATION } from '../../src/agents/resolutionAgent.js';
import { setProvider } from '../../src/agents/providers/index.js';
import { ProviderError } from '../../src/agents/providers/errors.js';

let ref; let student; let staff; let admin; let electricity;
const prompts = [];
const stub = (text) => ({ name: 'gemini', model: 'stub-model', complete: async ({ prompt }) => { prompts.push(prompt); return typeof text === 'function' ? text(prompt) : text; } });
const failing = (category) => ({ name: 'gemini', model: 'stub-model', complete: async () => { throw new ProviderError(category, category); } });

const GOOD_SUGGESTIONS = JSON.stringify({
  likelyCauses: ['Overloaded access point'],
  troubleshootingSteps: [{ step: 'Check the access point status lights', who: 'staff' }, { step: 'Replace the access point', who: 'specialist' }],
  possibleResolutions: ['Replace or reconfigure the access point'],
  safetyNotes: [], informationNeeded: ['Which floor exactly?'], limitations: null,
});

async function assignedComplaint(over) {
  const { complaint } = await createComplaint({ user: student, input: complaintInput(ref, over) });
  await Complaint.updateOne({ _id: complaint._id }, { $set: { assignee: staff._id, status: 'In Progress' } });
  return Complaint.findById(complaint._id);
}
const snapshot = async (id) => {
  const c = await Complaint.findById(id).lean();
  return { status: c.status, assignee: String(c.assignee), priority: c.priority, comments: await Comment.countDocuments({ complaint: id }) };
};

beforeAll(async () => {
  await setupDb('resolution');
  ref = await makeRefData();
  electricity = await Category.create({ name: 'Electricity' });
  [student, admin] = await Promise.all([makeUser('student'), makeUser('admin')]);
  staff = await makeUser('staff', { categories: [ref.network._id, electricity._id] });
});
afterAll(teardownDb);
beforeEach(() => { prompts.length = 0; setProvider(null); });

describe('resolution suggestions', () => {
  it('returns validated structured suggestions, stores them, and records a run with the task', async () => {
    const c = await assignedComplaint();
    await Comment.create({ complaint: c._id, author: staff._id, body: 'INTERNAL: AP-7 rebooted twice already', visibility: 'internal' });
    setProvider(stub(GOOD_SUGGESTIONS));
    const r = await runResolutionSuggestions(c._id, { triggeredBy: staff });
    expect(r).toMatchObject({ source: 'gemini', model: 'stub-model', errorCategory: null, likelyCauses: ['Overloaded access point'] });
    expect(r.troubleshootingSteps).toEqual([{ step: 'Check the access point status lights', who: 'staff' }, { step: 'Replace the access point', who: 'specialist' }]);
    expect(r.limitations).toMatch(/Check on site/); // default limitation when the model gives none
    expect(prompts[0]).toContain('AP-7 rebooted'); // staff-only output may use internal notes
    expect((await Complaint.findById(c._id)).ai.resolution.troubleshootingSteps).toHaveLength(2);
    expect(await AgentRun.countDocuments({ complaint: c._id, agent: 'resolution', task: 'suggest', status: 'success' })).toBe(1);
  });

  it('adds a safety note when the complaint mentions a hazard and the model gave none', async () => {
    const c = await assignedComplaint({ categoryId: String(electricity._id), title: 'Socket sparking', description: 'The socket by my desk is sparking and smells of smoke.' });
    setProvider(stub(GOOD_SUGGESTIONS));
    const r = await runResolutionSuggestions(c._id);
    expect(r.safetyNotes[0]).toMatch(/"smoke", "spark"|"spark"/);
  });

  it('malformed output falls back to a labelled category checklist', async () => {
    const c = await assignedComplaint({ categoryId: String(electricity._id), title: 'Exposed wire', description: 'There is an exposed wire hanging from the ceiling light.' });
    setProvider(stub('{"troubleshootingSteps": "just fix it"}'));
    const r = await runResolutionSuggestions(c._id);
    expect(r).toMatchObject({ source: 'fallback', errorCategory: 'malformed_output' });
    expect(r.limitations).toMatch(/not an analysis of this complaint/);
    expect(r.troubleshootingSteps.some((s) => s.who === 'specialist')).toBe(true);
    expect(r.safetyNotes[0]).toMatch(/exposed wire/);
  });
});

describe('response drafting', () => {
  it('produces an editable draft that requires approval and sends nothing', async () => {
    const c = await assignedComplaint();
    const before = await snapshot(c._id);
    setProvider(stub('{"draft":"Hello, we have replaced the access point.","warnings":[]}'));
    const r = await runResponseAgent(c._id, { guidance: 'Access point replaced' });
    expect(r).toMatchObject({ source: 'gemini', requiresApproval: true, draft: 'Hello, we have replaced the access point.' });
    expect(await snapshot(c._id)).toEqual(before);
    expect(await AgentRun.countDocuments({ complaint: c._id, agent: 'resolution', task: 'draft' })).toBe(1);
  });
});

describe('evidence review', () => {
  it('uses the recorded resolution note, is never marked verified, and always carries the fixed limitation', async () => {
    const c = await assignedComplaint();
    await changeStatus({ user: staff, complaintId: c._id, to: 'Resolved', reason: 'Replaced access point AP-7 and confirmed students on floor 2 can connect.' });
    // A model that tries to claim verification: the extra field is stripped and `verified` stays false.
    setProvider(stub('{"assessment":"likely_sufficient","verified":true,"checks":[{"item":"Note says what was done","status":"present","note":null}],"followUpQuestions":[],"limitations":null}'));
    const r = await runEvidenceReview(c._id, { triggeredBy: admin });
    expect(r).toMatchObject({ assessment: 'likely_sufficient', verified: false, source: 'gemini', statusAtReview: 'Resolved' });
    expect(r.resolutionNote).toMatch(/Replaced access point AP-7/);
    expect(prompts[0]).toContain('Replaced access point AP-7');
    expect(r.limitations).toContain(EVIDENCE_LIMITATION);
    const stored = (await Complaint.findById(c._id)).ai.evidenceReview;
    expect(stored).toMatchObject({ verified: false, assessment: 'likely_sufficient' });
    expect(String(stored.reviewedBy)).toBe(String(admin._id));
  });

  it('an explicit note from staff (before resolving) is reviewed instead of the recorded one', async () => {
    const c = await assignedComplaint();
    setProvider(stub('{"assessment":"needs_more_information","checks":[{"item":"How the fix was tested","status":"missing","note":"Not stated"}],"followUpQuestions":["Did you test from floor 2?"],"limitations":null}'));
    const r = await runEvidenceReview(c._id, { resolutionNote: 'Rebooted the router.' });
    expect(prompts[0]).toContain('Rebooted the router.');
    expect(r).toMatchObject({ assessment: 'needs_more_information', followUpQuestions: ['Did you test from floor 2?'] });
  });

  it('rule-based fallback only checks that records exist and never says "likely_sufficient"', async () => {
    const thin = await assignedComplaint();
    const a = await runEvidenceReview(thin._id); // no provider configured
    expect(a).toMatchObject({ source: 'fallback', errorCategory: 'no_provider', assessment: 'needs_more_information', verified: false });
    expect(a.checks.find((x) => x.item.startsWith('A resolution note')).status).toBe('missing');
    expect(a.checks.find((x) => x.item.startsWith('The student was told')).status).toBe('missing');

    const full = await assignedComplaint();
    await AuditEvent.create({ actor: staff._id, actorType: 'user', action: 'complaint.status_changed', resourceType: 'Complaint', resourceId: full._id, from: 'Assigned', to: 'In Progress' });
    await Comment.create({ complaint: full._id, author: staff._id, body: 'Fixed: the access point was replaced.', visibility: 'public' });
    const b = await runEvidenceReview(full._id, { resolutionNote: 'Replaced the access point and tested it from three rooms.' });
    expect(b.assessment).toBe('cannot_assess');
    expect(b.checks.every((x) => x.status !== 'missing')).toBe(true);
    expect(b.limitations).toMatch(/only confirm that records exist/);
  });
});

describe('failures and missing credentials, for every task', () => {
  it('timeouts fall back with errorCategory "timeout"', async () => {
    const c = await assignedComplaint();
    setProvider(failing('timeout'));
    const results = [await runResolutionSuggestions(c._id), await runResponseAgent(c._id), await runEvidenceReview(c._id)];
    expect(results.map((r) => [r.source, r.errorCategory])).toEqual([['fallback', 'timeout'], ['fallback', 'timeout'], ['fallback', 'timeout']]);
    expect(await AgentRun.countDocuments({ complaint: c._id, agent: 'resolution', errorCategory: 'timeout' })).toBe(3);
  });
  it('truncated output (token limit) falls back with errorCategory "truncated"', async () => {
    const c = await assignedComplaint();
    setProvider(failing('truncated'));
    expect((await runEvidenceReview(c._id)).errorCategory).toBe('truncated');
  });
  it('no API key: every task returns a labelled fallback', async () => {
    const c = await assignedComplaint();
    const s = await runResolutionSuggestions(c._id);
    const d = await runResponseAgent(c._id);
    const e = await runEvidenceReview(c._id);
    for (const r of [s, d, e]) expect(r).toMatchObject({ source: 'fallback', errorCategory: 'no_provider' });
    expect(d.warnings[0]).toMatch(/not an AI draft/);
  });
});

describe('approval: the agent never acts on its own', () => {
  it('running all three tasks leaves status, assignee, priority and messages unchanged', async () => {
    const c = await assignedComplaint();
    const before = await snapshot(c._id);
    setProvider(stub((p) => (p.includes('troubleshooting') ? GOOD_SUGGESTIONS
      : p.includes('Draft a clear') ? '{"draft":"Hello, fixed.","warnings":[]}'
        : '{"assessment":"likely_sufficient","checks":[{"item":"x","status":"present"}],"followUpQuestions":[]}')));
    await runResolutionSuggestions(c._id);
    await runResponseAgent(c._id);
    await runEvidenceReview(c._id, { resolutionNote: 'Replaced the access point.' });
    expect(await snapshot(c._id)).toEqual(before);
    expect(await AuditEvent.countDocuments({ resourceId: c._id, action: 'complaint.status_changed' })).toBe(0);
  });
});

describe('API access control and contract', () => {
  it('students are forbidden; only the assignee or an admin may use the agent', async () => {
    const c = await assignedComplaint();
    const other = await makeUser('staff', { categories: [ref.network._id] });
    const S = await signIn(student); const O = await signIn(other); const ST = await signIn(staff); const A = await signIn(admin);
    for (const path of ['resolution-suggestions', 'response-draft', 'evidence-review']) {
      expect((await S.post(`/api/complaints/${c._id}/agents/${path}`).send({})).status).toBe(403);
      expect((await O.post(`/api/complaints/${c._id}/agents/${path}`).send({})).status).toBe(404);
    }
    const s = await ST.post(`/api/complaints/${c._id}/agents/resolution-suggestions`).send();
    expect(s.status).toBe(200);
    expect(s.body.result.troubleshootingSteps.length).toBeGreaterThan(0);
    const e = await A.post(`/api/complaints/${c._id}/agents/evidence-review`).send({ resolutionNote: 'Router replaced.' });
    expect(e.body.result).toMatchObject({ verified: false });
    expect((await ST.post(`/api/complaints/${c._id}/agents/evidence-review`).send({ verified: true })).status).toBe(400); // strict body
    const detail = await ST.get(`/api/complaints/${c._id}`);
    expect(detail.body.complaint.ai.evidenceReview.verified).toBe(false);
    const studentView = await S.get(`/api/complaints/${c._id}`);
    expect(studentView.body.complaint.ai).toBeUndefined();
  });
});
