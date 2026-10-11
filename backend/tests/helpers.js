import mongoose from 'mongoose';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/db/connect.js';
import { User, Category, Location } from '../src/models/index.js';
import { hashPassword } from '../src/controllers/authController.js';
import { setIntakeScheduler } from '../src/agents/agents.js';
import { setProvider } from '../src/agents/providers/index.js';

export const PASSWORD = 'Passw0rd123';

/**
 * Identify the server behind the connection. FerretDB reports a MongoDB version number but adds
 * ferretdb* fields to buildInfo. Other MongoDB-compatible services are not detected here.
 */
export async function serverIdentity() {
  const bi = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  const ferret = bi.ferretdbVersion || bi.ferretdb;
  return { genuineMongoDB: !ferret, product: ferret ? `FerretDB ${ferret}` : 'MongoDB', reportedVersion: bi.version };
}

/** Connect to a fresh, uniquely named test database. */
export async function setupDb(label) {
  const dbName = `ccrs_test_${label}_${crypto.randomBytes(3).toString('hex')}`;
  await connectDb(`${process.env.MONGODB_TEST_URI}/${dbName}`);
  if (process.env.REQUIRE_GENUINE_MONGODB === '1') {
    const id = await serverIdentity();
    if (!id.genuineMongoDB) {
      await mongoose.disconnect();
      throw new Error(`REQUIRE_GENUINE_MONGODB=1 but the server is ${id.product}. Point MONGODB_TEST_URI at a real MongoDB server.`);
    }
  }
  // By default, tests trigger intake explicitly instead of via setImmediate.
  setIntakeScheduler(() => {});
  setProvider(null);
  return dbName;
}

export async function teardownDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

let hashed;
export async function makeUser(role = 'student', overrides = {}) {
  hashed ||= await hashPassword(PASSWORD);
  const n = crypto.randomBytes(4).toString('hex');
  return User.create({ name: `${role} ${n}`, email: `${role}.${n}@uni.test`, role, passwordHash: hashed, ...overrides });
}

export async function makeRefData() {
  const [network, hostel] = await Category.create([{ name: 'Network' }, { name: 'Hostel' }]);
  const [blockA, library] = await Location.create([{ name: 'Hostel Block A' }, { name: 'Library' }]);
  return { network, hostel, blockA, library };
}

export const app = () => createApp();

/** A supertest agent that is signed in (cookie jar) and sends the CSRF header. */
export async function signIn(user, appInstance = app()) {
  const agent = request.agent(appInstance);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const wrap = (m) => (url) => agent[m](url).set('X-Requested-With', 'XMLHttpRequest');
  return { agent, get: (url) => agent.get(url), post: wrap('post'), patch: wrap('patch') };
}

export const complaintInput = (ref, over = {}) => ({
  title: 'Wi-Fi not working', description: 'The Wi-Fi in hostel block A has been down since this morning.',
  categoryId: String(ref.network._id), locationId: String(ref.blockA._id), ...over,
});
