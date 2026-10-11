import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, teardownDb, makeUser, makeRefData, signIn, complaintInput } from '../helpers.js';
import { Complaint } from '../../src/models/index.js';

let ref; let studentA; let studentB; let staffNet; let staffHostel; let admin; let A; let B; let N; let H; let AD;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

beforeAll(async () => {
  await setupDb('cmp');
  ref = await makeRefData();
  [studentA, studentB, admin] = await Promise.all([makeUser('student'), makeUser('student'), makeUser('admin')]);
  staffNet = await makeUser('staff', { categories: [ref.network._id] });
  staffHostel = await makeUser('staff', { categories: [ref.hostel._id] });
  [A, B, N, H, AD] = await Promise.all([studentA, studentB, staffNet, staffHostel, admin].map((u) => signIn(u)));
});
afterAll(teardownDb);

const create = (client, over) => client.post('/api/complaints').field(complaintInput(ref, over));

describe('complaint ownership and roles', () => {
  let cid;
  it('student creates a complaint; status Submitted, default priority', async () => {
    const res = await create(A);
    expect(res.status).toBe(201);
    expect(res.body.complaint).toMatchObject({ status: 'Submitted', priority: 'Medium', title: 'Wi-Fi not working' });
    expect(res.body.complaint.ai).toBeUndefined();
    cid = res.body.complaint._id;
  });

  it('rejects mass assignment of protected fields and invalid references', async () => {
    expect((await A.post('/api/complaints').field({ ...complaintInput(ref), status: 'Resolved' })).status).toBe(400);
    expect((await A.post('/api/complaints').field({ ...complaintInput(ref), priority: 'Critical' })).status).toBe(400);
    expect((await create(A, { categoryId: '000000000000000000000000' })).status).toBe(400);
    expect((await create(A, { description: 'too short' })).status).toBe(400);
  });

  it('only students can create complaints', async () => {
    expect((await create(AD)).status).toBe(403);
    expect((await create(N)).status).toBe(403);
  });

  it('another student cannot see, list, comment on or change it (404, not 403)', async () => {
    expect((await B.get(`/api/complaints/${cid}`)).status).toBe(404);
    expect((await B.get(`/api/complaints/${cid}/timeline`)).status).toBe(404);
    expect((await B.post(`/api/complaints/${cid}/comments`).send({ body: 'hi' })).status).toBe(404);
    expect((await B.get('/api/complaints')).body.total).toBe(0);
    expect((await A.get('/api/complaints')).body.total).toBe(1);
  });

  it('unassigned staff cannot see it; admin can', async () => {
    expect((await N.get(`/api/complaints/${cid}`)).status).toBe(404);
    expect((await AD.get(`/api/complaints/${cid}`)).status).toBe(200);
  });

  it('assignment validates staff eligibility and moves to Assigned', async () => {
    expect((await AD.post(`/api/complaints/${cid}/assign`).send({ staffId: String(staffHostel._id) })).status).toBe(400); // wrong category
    expect((await AD.post(`/api/complaints/${cid}/assign`).send({ staffId: String(studentB._id) })).status).toBe(400); // not staff
    const inactive = await makeUser('staff', { categories: [ref.network._id], active: false });
    expect((await AD.post(`/api/complaints/${cid}/assign`).send({ staffId: String(inactive._id) })).status).toBe(400);
    expect((await N.post(`/api/complaints/${cid}/assign`).send({ staffId: String(staffNet._id) })).status).toBe(403);
    const ok = await AD.post(`/api/complaints/${cid}/assign`).send({ staffId: String(staffNet._id) });
    expect(ok.status).toBe(200);
    expect(ok.body.complaint.status).toBe('Assigned');
    expect((await N.get(`/api/complaints/${cid}`)).status).toBe(200);
    expect((await N.get('/api/complaints')).body.total).toBe(1);
  });

  it('enforces the status machine per role', async () => {
    expect((await A.patch(`/api/complaints/${cid}/status`).send({ status: 'In Progress' })).status).toBe(403); // valid transition, wrong role
    expect((await H.patch(`/api/complaints/${cid}/status`).send({ status: 'In Progress' })).status).toBe(404);
    expect((await N.patch(`/api/complaints/${cid}/status`).send({ status: 'Closed' })).status).toBe(400);
    expect((await N.patch(`/api/complaints/${cid}/status`).send({ status: 'In Progress' })).status).toBe(200);
    expect((await N.patch(`/api/complaints/${cid}/status`).send({ status: 'Resolved' })).status).toBe(400); // resolution note required
    expect((await N.patch(`/api/complaints/${cid}/status`).send({ status: 'Resolved', reason: 'Replaced the faulty access point and tested the connection.' })).status).toBe(200);
    expect((await N.patch(`/api/complaints/${cid}/status`).send({ status: 'Closed' })).status).toBe(403);
    expect((await A.patch(`/api/complaints/${cid}/status`).send({ status: 'In Progress' })).status).toBe(400); // reason required
    expect((await A.patch(`/api/complaints/${cid}/status`).send({ status: 'In Progress', reason: 'Still down' })).status).toBe(200);
  });

  it('internal notes are hidden from the student; public replies are visible', async () => {
    expect((await A.post(`/api/complaints/${cid}/comments`).send({ body: 'x', visibility: 'internal' })).status).toBe(403);
    expect((await N.post(`/api/complaints/${cid}/comments`).send({ body: 'Router in rack 3 is faulty', visibility: 'internal' })).status).toBe(201);
    expect((await N.post(`/api/complaints/${cid}/comments`).send({ body: 'We are replacing the router.', visibility: 'public', fromAiDraft: true })).status).toBe(201);
    const student = await A.get(`/api/complaints/${cid}/timeline`);
    const staff = await N.get(`/api/complaints/${cid}/timeline`);
    expect(JSON.stringify(student.body)).not.toContain('rack 3');
    expect(JSON.stringify(student.body)).toContain('replacing the router');
    expect(student.body.items.some((i) => i.action === 'complaint.assigned')).toBe(false);
    expect(JSON.stringify(staff.body)).toContain('rack 3');
    expect(staff.body.items.find((i) => i.kind === 'comment' && i.visibility === 'public').fromAiDraft).toBe(true);
  });

  it('priority override is admin-only, requires a reason, and is audited', async () => {
    expect((await N.patch(`/api/complaints/${cid}/priority`).send({ priority: 'High', reason: 'x y z' })).status).toBe(403);
    expect((await AD.patch(`/api/complaints/${cid}/priority`).send({ priority: 'High' })).status).toBe(400);
    const r = await AD.patch(`/api/complaints/${cid}/priority`).send({ priority: 'High', reason: 'Exam week' });
    expect(r.body.complaint).toMatchObject({ priority: 'High', prioritySource: 'override' });
    const tl = await AD.get(`/api/complaints/${cid}/timeline`);
    expect(tl.body.items.some((i) => i.action === 'complaint.priority_overridden' && i.reason === 'Exam week')).toBe(true);
  });

  it('student stats and list are scoped to their own complaints', async () => {
    const s = await A.get('/api/complaints/stats');
    expect(s.body.total).toBe(1);
    expect((await AD.get('/api/complaints/stats')).body.total).toBe(await Complaint.countDocuments());
  });

  it('rejects malformed ids and query params', async () => {
    expect((await A.get('/api/complaints/not-an-id')).status).toBe(400);
    expect((await A.get('/api/complaints?status=Bogus')).status).toBe(400);
    expect((await A.get('/api/complaints?limit=1000')).status).toBe(400);
  });
});

describe('attachments', () => {
  it('accepts a real PNG and only the owner/admin can download it', async () => {
    const res = await A.post('/api/complaints').field(complaintInput(ref, { title: 'Broken socket photo' })).attach('attachment', PNG, 'photo.png');
    expect(res.status).toBe(201);
    const att = res.body.complaint.attachments[0];
    expect(att.storedName).toBeUndefined();
    const url = `/api/complaints/${res.body.complaint._id}/attachments/${att._id}`;
    const own = await A.get(url);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect((await B.get(url)).status).toBe(404);
    expect((await AD.get(url)).status).toBe(200);
  });

  it('rejects a non-image disguised as .png and oversized files', async () => {
    const fake = await A.post('/api/complaints').field(complaintInput(ref)).attach('attachment', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const big = await A.post('/api/complaints').field(complaintInput(ref)).attach('attachment', Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), 'big.png');
    expect(big.status).toBe(400);
  });
});

describe('admin-only endpoints', () => {
  it('students and staff are forbidden', async () => {
    for (const c of [A, N]) {
      for (const url of ['/api/users', '/api/staff', '/api/issues', '/api/reports/summary', '/api/settings']) {
        expect((await c.get(url)).status).toBe(403);
      }
      expect((await c.post('/api/categories').send({ name: 'Parking' })).status).toBe(403);
    }
  });
  it('settings never expose secrets', async () => {
    const s = await AD.get('/api/settings');
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.body)).not.toMatch(/secret|apiKey|api_key|JWT/i);
    expect(s.body.escalation.threshold).toBe(5);
  });
  it('reports reflect stored data', async () => {
    const r = await AD.get('/api/reports/summary');
    expect(r.body.total).toBe(await Complaint.countDocuments());
    expect((await AD.get('/api/reports/summary?from=2030-01-01&to=2020-01-01')).status).toBe(400);
  });
});
