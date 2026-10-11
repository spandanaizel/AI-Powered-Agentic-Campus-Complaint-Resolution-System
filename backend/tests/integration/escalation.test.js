import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupDb, teardownDb, makeUser, makeRefData, signIn, complaintInput } from '../helpers.js';
import { Complaint, IssueGroup, IssueReporter, IssueEscalation, AuditEvent, User } from '../../src/models/index.js';
import { createComplaint, overridePriority } from '../../src/services/complaintService.js';
import { resolveIssueGroup } from '../../src/services/escalationService.js';
import { config } from '../../src/config/env.js';

let ref;
beforeAll(async () => { await setupDb('esc'); ref = await makeRefData(); });
afterAll(teardownDb);
beforeEach(async () => {
  await Promise.all([Complaint.deleteMany({}), IssueGroup.deleteMany({}), IssueReporter.deleteMany({}), IssueEscalation.deleteMany({}), AuditEvent.collection.deleteMany({}), User.deleteMany({ role: 'student' })]);
  config.escalation.threshold = 5;
  config.escalation.windowDays = 30;
});

const report = async (user, over) => (await createComplaint({ user, input: complaintInput(ref, over) })).issue;
const students = (n) => Promise.all(Array.from({ length: n }, () => makeUser('student')));

describe('repeated-issue escalation (> 5 distinct reporters)', () => {
  it('exactly five distinct reporters does NOT escalate', async () => {
    const s = await students(5);
    let last;
    for (const u of s) last = await report(u);
    expect(last.reporterCount).toBe(5);
    expect(last.escalated).toBe(false);
    expect(await Complaint.countDocuments({ priority: 'Critical' })).toBe(0);
    expect(await AuditEvent.countDocuments({ action: 'issue.escalated' })).toBe(0);
  });

  it('the sixth distinct reporter escalates the issue and all linked open complaints to Critical', async () => {
    const s = await students(6);
    const results = [];
    for (const u of s) results.push(await report(u));
    expect(results[4].escalated).toBe(false);
    expect(results[5]).toMatchObject({ reporterCount: 6, escalated: true });
    const all = await Complaint.find().lean();
    expect(all).toHaveLength(6);
    expect(all.every((c) => c.priority === 'Critical' && c.prioritySource === 'escalation')).toBe(true);
    const group = await IssueGroup.findOne().lean();
    expect(group.escalated).toBe(true);
    expect(group.escalationThreshold).toBe(5);
    expect(await AuditEvent.countDocuments({ action: 'issue.escalated' })).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'complaint.priority_escalated', studentVisible: true })).toBe(6);
  });

  it('one student submitting many complaints counts once', async () => {
    const [u] = await students(1);
    let last;
    for (let i = 0; i < 8; i += 1) last = await report(u, { title: `Wi-Fi down again ${i}` });
    expect(last.reporterCount).toBe(1);
    expect(last.escalated).toBe(false);
  });

  it('five distinct students plus repeats from one of them still does not escalate', async () => {
    const s = await students(5);
    for (const u of s) await report(u);
    for (let i = 0; i < 4; i += 1) await report(s[0], { title: `Still broken ${i}` });
    expect(await IssueReporter.countDocuments()).toBe(5);
    expect((await IssueGroup.findOne()).escalated).toBe(false);
  });

  it('reports for unrelated issues (different category or location) stay separate', async () => {
    const s = await students(6);
    for (const [i, u] of s.entries()) {
      // 3 Network@BlockA, 3 split across other keys
      const over = i < 3 ? {} : i === 3 ? { categoryId: String(ref.hostel._id) } : { locationId: String(ref.library._id) };
      await report(u, over);
    }
    const groups = await IssueGroup.find().lean();
    expect(groups.length).toBe(3);
    expect(groups.every((g) => !g.escalated)).toBe(true);
    expect(await Complaint.countDocuments({ priority: 'Critical' })).toBe(0);
  });

  it('concurrent submissions: 12 distinct reporters at once escalate exactly once, none skipped', async () => {
    const s = await students(12);
    await Promise.all(s.map((u) => report(u)));
    const group = await IssueGroup.findOne().lean();
    expect(await IssueReporter.countDocuments()).toBe(12);
    expect(group.escalated).toBe(true);
    expect(await IssueEscalation.countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'issue.escalated' })).toBe(1);
    expect(await Complaint.countDocuments({ priority: { $ne: 'Critical' } })).toBe(0);
  });

  it('concurrent sixth and seventh reports after five sequential ones: exactly one transition', async () => {
    const s = await students(7);
    for (const u of s.slice(0, 5)) await report(u);
    await Promise.all([report(s[5]), report(s[6])]);
    expect(await IssueReporter.countDocuments()).toBe(7);
    expect(await IssueEscalation.countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'issue.escalated' })).toBe(1);
    expect(await Complaint.countDocuments({ priority: 'Critical' })).toBe(7);
  });

  it('concurrent duplicate submissions by the same student do not inflate the count', async () => {
    const s = await students(5);
    await Promise.all([...s.map((u) => report(u)), report(s[0]), report(s[0]), report(s[1])]);
    expect(await IssueReporter.countDocuments()).toBe(5);
    expect(await IssueEscalation.countDocuments()).toBe(0);
    expect(await Complaint.countDocuments()).toBe(8);
  });

  it('heavy concurrency: 60 simultaneous submissions across 3 issues, with duplicates, count and escalate exactly', async () => {
    const s = await students(15);
    const issues = [{}, { locationId: String(ref.library._id) }, { categoryId: String(ref.hostel._id) }];
    // Issue A: 15 distinct reporters, each submitting twice. Issue B: 6 distinct (escalates). Issue C: 5 distinct x3 (does not).
    const jobs = [
      ...s.flatMap((u) => [report(u, issues[0]), report(u, issues[0])]),
      ...s.slice(0, 6).map((u) => report(u, issues[1])),
      ...s.slice(0, 5).flatMap((u) => [report(u, issues[2]), report(u, issues[2]), report(u, issues[2])]),
      ...s.slice(6, 15).map((u) => report(u, { ...issues[1], locationId: String(ref.blockA._id), categoryId: String(ref.network._id) })),
    ];
    await Promise.all(jobs);
    const groups = await IssueGroup.find().lean();
    const byKey = Object.fromEntries(await Promise.all(groups.map(async (g) => [g.groupKey, {
      reporters: await IssueReporter.countDocuments({ issueGroup: g._id }), escalations: await IssueEscalation.countDocuments({ issueGroup: g._id }),
      notCritical: await Complaint.countDocuments({ issueGroup: g._id, priority: { $ne: 'Critical' } }),
    }])));
    const key = (o) => `${o.categoryId ?? ref.network._id}:${o.locationId ?? ref.blockA._id}`;
    expect(byKey[key(issues[0])]).toEqual({ reporters: 15, escalations: 1, notCritical: 0 });
    expect(byKey[key(issues[1])]).toEqual({ reporters: 6, escalations: 1, notCritical: 0 });
    expect(byKey[key(issues[2])].reporters).toBe(5);
    expect(byKey[key(issues[2])].escalations).toBe(0);
    expect(await Complaint.countDocuments()).toBe(jobs.length);
    expect(await AuditEvent.countDocuments({ action: 'issue.escalated' })).toBe(2);
  });

  it('complaints reported after escalation are also Critical', async () => {
    const s = await students(7);
    for (const u of s.slice(0, 6)) await report(u);
    await report(s[6]);
    expect(await Complaint.countDocuments({ priority: 'Critical' })).toBe(7);
  });

  it('an admin priority override is respected by later escalation passes and audited', async () => {
    const admin = await makeUser('admin');
    const s = await students(7);
    for (const u of s.slice(0, 6)) await report(u);
    const first = await Complaint.findOne({ reporter: s[0]._id });
    await overridePriority({ user: admin, complaintId: first._id, priority: 'High', reason: 'Duplicate of a fixed ticket' });
    await report(s[6]); // re-applies escalation to the group
    expect((await Complaint.findById(first._id)).priority).toBe('High');
    expect(await AuditEvent.countDocuments({ action: 'complaint.priority_overridden', resourceId: first._id })).toBe(1);
  });

  it('reports outside the counting window start a new generation', async () => {
    const s = await students(6);
    for (const u of s.slice(0, 5)) await report(u);
    await IssueGroup.updateOne({}, { $set: { windowStartedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const r = await report(s[5]);
    expect(r).toMatchObject({ reporterCount: 1, escalated: false, generation: 2 });
  });

  it('window 0 counts across all time', async () => {
    config.escalation.windowDays = 0;
    const s = await students(6);
    for (const u of s.slice(0, 5)) await report(u);
    await IssueGroup.updateOne({}, { $set: { windowStartedAt: new Date('2020-01-01') } });
    expect((await report(s[5])).escalated).toBe(true);
  });

  it('admin resolving an issue keeps history and restarts the count', async () => {
    const admin = await makeUser('admin');
    const s = await students(6);
    for (const u of s) await report(u);
    const g = await IssueGroup.findOne();
    const after = await resolveIssueGroup(g._id, admin, 'Router replaced');
    expect(after).toMatchObject({ generation: 2, escalated: false });
    expect(after.resolvedGenerations[0]).toMatchObject({ generation: 1, reporterCount: 6, escalated: true });
    expect((await report(s[0])).reporterCount).toBe(1);
  });

  it('escalation is returned by the API and visible to the student without exposing other reporters', async () => {
    const s = await students(6);
    for (const u of s.slice(0, 5)) await report(u);
    const client = await signIn(s[5]);
    const res = await client.post('/api/complaints').field(complaintInput(ref));
    expect(res.status).toBe(201);
    expect(res.body.issue.escalated).toBe(true);
    expect(res.body.complaint.priority).toBe('Critical');
    expect(res.body.complaint.issue).toEqual({ escalated: true });
    expect(JSON.stringify(res.body)).not.toContain('reporters');
    const list = await client.get('/api/complaints');
    expect(list.body.items[0]).toMatchObject({ escalated: true, priority: 'Critical' });
    expect(list.body.items[0].prioritySource).toBeUndefined();
    const tl = await client.get(`/api/complaints/${res.body.complaint._id}/timeline`);
    expect(tl.body.items.some((i) => i.action === 'complaint.priority_escalated')).toBe(true);
  });
});
