// Live check of the Anthropic integration: model availability plus one real call per agent task.
//
//   ANTHROPIC_API_KEY=... MONGODB_URI=mongodb://127.0.0.1:27017 npm run verify:anthropic
//
// The key is read from the environment only and is never printed. A temporary database
// (ccrs_verify_ai_<random>) is created on the MongoDB server and dropped afterwards.
// Exit codes: 0 = every check came from Anthropic, 1 = something failed, 2 = skipped (no key).
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { connectDb } from '../src/db/connect.js';
import { User, Category, Location, Complaint, AgentRun } from '../src/models/index.js';
import { createAnthropicProvider } from '../src/agents/providers/anthropic.js';
import { setProvider } from '../src/agents/providers/index.js';
import {
  runSummaryAgent, runPriorityAgent, runAssignmentAgent, runResolutionSuggestions, runResponseAgent, runEvidenceReview,
} from '../src/agents/agents.js';

const { anthropicApiKey: apiKey, anthropicModel: model, anthropicBaseUrl: baseUrl, timeoutMs, maxTokens } = config.agents;
if (!apiKey) {
  console.log('SKIPPED: ANTHROPIC_API_KEY is not set. Live Anthropic calls are UNVERIFIED.');
  process.exit(2);
}
if (!config.mongoUri) { console.error('MONGODB_URI is required (a temporary database is created and dropped).'); process.exit(1); }

const results = [];
const record = (check, pass, detail) => { results.push({ check, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${check}${detail ? `  ${detail}` : ''}`); };
const short = (v) => JSON.stringify(v).slice(0, 160);

const provider = createAnthropicProvider({ apiKey, model, baseUrl, timeoutMs, maxTokens });
console.log(`Model under test: ${model}${baseUrl !== 'https://api.anthropic.com' ? ` via ${baseUrl}` : ''}`);
const m = await provider.checkModel().catch((e) => ({ ok: false, status: 0, error: e.message }));
record('model ID is available to this API key (GET /v1/models/{id})', m.ok && m.id === model, m.ok ? `${m.id} (${m.displayName})` : `HTTP ${m.status} ${m.error ?? ''}`);
if (!m.ok) { console.log('Stopping: the model check failed, so agent calls would fail too.'); process.exit(1); }

// Same server and credentials as MONGODB_URI, but a throwaway database name.
const target = new URL(config.mongoUri);
target.pathname = `/ccrs_verify_ai_${crypto.randomBytes(3).toString('hex')}`;
const uri = target.toString();
await connectDb(uri);
setProvider(provider);
try {
  const cat = await Category.create({ name: 'Network' });
  const loc = await Location.create({ name: 'Library' });
  const hash = 'x'.repeat(60);
  const student = await User.create({ name: 'Verify Student', email: `s.${Date.now()}@verify.test`, role: 'student', passwordHash: hash });
  const staffA = await User.create({ name: 'Verify Staff A', email: `a.${Date.now()}@verify.test`, role: 'staff', categories: [cat._id], passwordHash: hash });
  await User.create({ name: 'Verify Staff B', email: `b.${Date.now()}@verify.test`, role: 'staff', categories: [cat._id], passwordHash: hash });
  const c = await Complaint.create({
    reporter: student._id, category: cat._id, location: loc._id, title: 'Library Wi-Fi keeps dropping',
    description: 'The Wi-Fi on the second floor of the library disconnects every few minutes since Monday. About twenty students are affected during exam week.',
  });

  const tasks = [
    ['summary agent', 'summary', null, () => runSummaryAgent(c._id)],
    ['priority agent', 'priority', null, () => runPriorityAgent(c._id)],
    ['assignment agent (2 eligible staff, so the model chooses)', 'assignment', null, () => runAssignmentAgent(c._id, { apply: false })],
    ['resolution agent: suggestions', 'resolution', 'suggest', () => runResolutionSuggestions(c._id, { triggeredBy: staffA })],
    ['resolution agent: response draft', 'resolution', 'draft', () => runResponseAgent(c._id, { guidance: 'The access point was replaced this morning.' })],
    ['resolution agent: evidence review', 'resolution', 'evidence', () => runEvidenceReview(c._id, { resolutionNote: 'Replaced access point AP-7 on floor 2 and confirmed three laptops stay connected for 30 minutes.' })],
  ];
  for (const [label, agent, task, fn] of tasks) {
    const out = await fn();
    const run = await AgentRun.findOne({ complaint: c._id, agent, ...(task ? { task } : {}) }).sort({ createdAt: -1 }).lean();
    const pass = run?.source === 'anthropic' && run?.status === 'success';
    record(`live call: ${label}`, pass, `source=${run?.source} errorCategory=${run?.errorCategory ?? 'none'} ${run?.durationMs ?? '?'}ms output=${short(out)}`);
  }
} finally {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\nAnthropic live verification: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
