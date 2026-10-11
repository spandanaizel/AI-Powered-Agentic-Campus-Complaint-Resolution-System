// Idempotent seed: categories, locations, one admin and one staff account per category.
// Passwords come from env vars; if absent, strong random ones are generated and printed ONCE.
import crypto from 'node:crypto';
import { config, assertConfig } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/db/connect.js';
import { User, Category, Location } from '../src/models/index.js';
import { hashPassword } from '../src/controllers/authController.js';

// Categories carried over from the original admin frontend.
const CATEGORIES = [
  ['Network', 'Wi-Fi, LAN and internet access'],
  ['Hostel', 'Rooms, water, bathrooms and hostel facilities'],
  ['Infrastructure', 'Classrooms, projectors, furniture, buildings'],
  ['Security', 'Locks, access control, safety concerns'],
  ['Electricity', 'Power cuts, lighting, sockets and wiring'],
];
const LOCATIONS = ['Hostel Block A', 'Hostel Block B', 'Library', 'Main Academic Block', 'Science Labs', 'Cafeteria', 'Sports Complex', 'Campus-wide'];

const genPassword = () => `${crypto.randomBytes(9).toString('base64url')}9a`;

async function upsertUser({ email, name, role, password, categories = [] }) {
  const existing = await User.findOne({ email });
  if (existing) return { email, created: false };
  await User.create({ email, name, role, categories, passwordHash: await hashPassword(password) });
  return { email, created: true, password };
}

async function main() {
  assertConfig(config);
  await connectDb(config.mongoUri);
  for (const [name, description] of CATEGORIES) await Category.updateOne({ name }, { $setOnInsert: { name, description, active: true } }, { upsert: true });
  for (const name of LOCATIONS) await Location.updateOne({ name }, { $setOnInsert: { name, active: true } }, { upsert: true });
  const cats = await Category.find().lean();

  const results = [];
  results.push(await upsertUser({
    email: process.env.SEED_ADMIN_EMAIL || 'admin@campus.example',
    name: 'Campus Admin', role: 'admin', password: process.env.SEED_ADMIN_PASSWORD || genPassword(),
  }));
  const staffPassword = process.env.SEED_STAFF_PASSWORD;
  for (const c of cats) {
    results.push(await upsertUser({
      email: `${c.name.toLowerCase()}.staff@campus.example`, name: `${c.name} Staff`, role: 'staff',
      categories: [c._id], password: staffPassword || genPassword(),
    }));
  }
  console.log(`Seeded ${cats.length} categories and ${LOCATIONS.length} locations.`);
  for (const r of results) {
    if (!r.created) console.log(`  exists   ${r.email}`);
    else console.log(`  created  ${r.email}  password: ${r.password}${process.env.SEED_ADMIN_PASSWORD || staffPassword ? ' (from env)' : '  <- generated, shown once'}`);
  }
  console.log('Students register themselves through the app.');
  await disconnectDb();
}

main().catch(async (err) => { console.error(err.message); await disconnectDb().catch(() => {}); process.exit(1); });
