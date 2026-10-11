import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupDb, teardownDb, makeUser, app, signIn, PASSWORD } from '../helpers.js';
import { User } from '../../src/models/index.js';

const X = { 'X-Requested-With': 'XMLHttpRequest' };
let api;
beforeAll(async () => { await setupDb('auth'); api = app(); });
afterAll(teardownDb);

describe('authentication', () => {
  it('registers a student, hashes the password, ignores no role from the client', async () => {
    const res = await request(api).post('/api/auth/register').set(X).send({ name: 'Ann Lee', email: 'Ann@Uni.test', password: 'abcdef12' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ann@uni.test', role: 'student' });
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Strict/i);
    const stored = await User.findOne({ email: 'ann@uni.test' }).select('+passwordHash').lean();
    expect(stored.passwordHash).not.toContain('abcdef12');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion/);
  });

  it('rejects weak passwords and a client-supplied role', async () => {
    expect((await request(api).post('/api/auth/register').set(X).send({ name: 'Bo', email: 'bo@uni.test', password: 'short' })).status).toBe(400);
    expect((await request(api).post('/api/auth/register').set(X).send({ name: 'Bo B', email: 'bo@uni.test', password: 'abcdef12', role: 'admin' })).status).toBe(400);
  });

  it('uses one generic error for unknown email, wrong password and deactivated accounts', async () => {
    const u = await makeUser('student');
    const off = await makeUser('student', { active: false });
    const a = await request(api).post('/api/auth/login').set(X).send({ email: 'nobody@uni.test', password: PASSWORD });
    const b = await request(api).post('/api/auth/login').set(X).send({ email: u.email, password: 'Wrong1234' });
    const c = await request(api).post('/api/auth/login').set(X).send({ email: off.email, password: PASSWORD });
    for (const r of [a, b, c]) { expect(r.status).toBe(401); expect(r.body.error.message).toBe('Invalid email or password'); }
  });

  it('requires a session for protected routes and the CSRF header for unsafe methods', async () => {
    expect((await request(api).get('/api/complaints')).status).toBe(401);
    const s = await signIn(await makeUser('student'), api);
    expect((await s.agent.post('/api/auth/logout')).status).toBe(403);
  });

  it('logout invalidates the token even if the cookie is replayed', async () => {
    const u = await makeUser('student');
    const login = await request(api).post('/api/auth/login').set(X).send({ email: u.email, password: PASSWORD });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    expect((await request(api).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    expect((await request(api).post('/api/auth/logout').set(X).set('Cookie', cookie)).status).toBe(204);
    expect((await request(api).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('role comes from the database: a demoted admin loses access immediately', async () => {
    const admin = await makeUser('admin');
    const other = await makeUser('admin');
    const s = await signIn(admin, api);
    expect((await s.get('/api/users')).status).toBe(200);
    const o = await signIn(other, api);
    expect((await o.patch(`/api/users/${admin._id}`).send({ role: 'student' })).status).toBe(200);
    expect((await s.get('/api/users')).status).toBe(401); // token invalidated by tokenVersion bump
  });

  it('rate-limits repeated failed sign-ins', async () => {
    const u = await makeUser('student');
    const codes = [];
    for (let i = 0; i < 7; i += 1) codes.push((await request(api).post('/api/auth/login').set(X).send({ email: u.email, password: 'Wrong1234' })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('admins cannot demote themselves or remove the last admin', async () => {
    const admin = await makeUser('admin');
    await User.updateMany({ role: 'admin', _id: { $ne: admin._id } }, { $set: { active: false } });
    const s = await signIn(admin, api);
    expect((await s.patch(`/api/users/${admin._id}`).send({ active: false })).status).toBe(400);
  });
});
