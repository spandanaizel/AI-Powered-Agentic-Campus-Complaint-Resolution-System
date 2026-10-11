// Live check of the Google Gemini integration. Makes REAL API calls with your key.
//
//   npm run verify:gemini                 # key + model check, then one real call (no database needed)
//   npm run verify:gemini -- --all-agents # also one real call per agent task (needs MONGODB_URI;
//                                         # uses a temporary database that is dropped afterwards)
//
// The key is read from GEMINI_API_KEY (backend/.env or the environment) and is never printed: every
// output line passes through a scrubber that replaces it with [REDACTED].
// Uses at most 8 requests of your quota. Exit codes: 0 = all checks passed with real Gemini output,
// 1 = a check failed, 2 = skipped (no key).
import crypto from 'node:crypto';
import { config } from '../src/config/env.js';
import { createGeminiProvider } from '../src/agents/providers/gemini.js';
import { parseModelJson, summaryOutput, jsonSchemas, SAFETY_PREAMBLE } from '../src/agents/schemas.js';

const a = config.agents;
const apiKey = a.geminiApiKey;
const say = (line) => console.log(apiKey ? String(line).split(apiKey).join('[REDACTED]') : line);

if (!apiKey) {
  say('SKIPPED: GEMINI_API_KEY is not set in backend/.env or the environment. Live Gemini calls are UNVERIFIED.');
  process.exit(2);
}

const results = [];
const record = (check, pass, detail = '') => { results.push({ check, pass }); say(`${pass ? 'PASS' : 'FAIL'} ${check}${detail ? `  ${detail}` : ''}`); };
const short = (v) => JSON.stringify(v).slice(0, 160);
const finish = () => {
  const passed = results.filter((r) => r.pass).length;
  say(`\nGemini live verification: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

const provider = createGeminiProvider({
  apiKey, model: a.geminiModel, baseUrl: a.geminiBaseUrl || null, timeoutMs: a.timeoutMs, maxTokens: a.maxTokens,
  thinkingLevel: a.thinkingLevel, structuredOutput: a.structuredOutput, maxRequestsPerMinute: 0, // the script paces itself
});
say(`Model under test: ${a.geminiModel}${a.geminiBaseUrl ? ` via ${a.geminiBaseUrl}` : ''}  (key: configured, ${apiKey.length} characters, not shown)`);

// 1. Key and model: GET models/{model}
const m = await provider.checkModel();
record('API key accepted and model available (models.get)', m.ok && m.id === a.geminiModel,
  m.ok ? `${m.id} (${m.displayName ?? 'no display name'})` : `HTTP ${m.status} ${m.category ?? ''}: ${m.error}`);
if (!m.ok) { say('Stopping: the key/model check failed, so generation calls would fail too.'); finish(); }

// 2. One real Interactions API call with structured output, validated by the same zod schema the app uses.
const started = Date.now();
try {
  const text = await provider.complete({
    system: SAFETY_PREAMBLE, jsonSchema: jsonSchemas.summary,
    prompt: '<complaint>\nTitle: Library Wi-Fi keeps dropping\nDescription:\nThe Wi-Fi on the second floor disconnects every few minutes since Monday.\n</complaint>\nSummarise this complaint. Return JSON: {"summary": "...", "keyFacts": ["..."], "categoryHint": null, "limitations": null}',
  });
  record('real Interactions API call returns schema-valid JSON', true, `${Date.now() - started}ms output=${short(parseModelJson(text, summaryOutput))}`);
} catch (err) {
  record('real Interactions API call returns schema-valid JSON', false, `${err.category ?? 'error'}: ${err.message}`);
}

if (process.argv.includes('--all-agents')) {
  if (!config.mongoUri) { record('--all-agents requires MONGODB_URI', false); finish(); }
  const mongoose = (await import('mongoose')).default;
  const { connectDb } = await import('../src/db/connect.js');
  const { User, Category, Location, Complaint, AgentRun } = await import('../src/models/index.js');
  const { setProvider } = await import('../src/agents/providers/index.js');
  const agents = await import('../src/agents/agents.js');
  const target = new URL(config.mongoUri);
  target.pathname = `/ccrs_verify_ai_${crypto.randomBytes(3).toString('hex')}`;
  await connectDb(target.toString());
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
      ['Complaint Understanding (summary) agent', 'summary', null, () => agents.runSummaryAgent(c._id)],
      ['Priority Prediction agent', 'priority', null, () => agents.runPriorityAgent(c._id)],
      ['Automatic Assignment agent (2 eligible staff, so the model chooses)', 'assignment', null, () => agents.runAssignmentAgent(c._id, { apply: false })],
      ['Resolution and Response agent: suggestions', 'resolution', 'suggest', () => agents.runResolutionSuggestions(c._id, { triggeredBy: staffA })],
      ['Resolution and Response agent: response draft', 'resolution', 'draft', () => agents.runResponseAgent(c._id, { guidance: 'The access point was replaced this morning.' })],
      ['Resolution and Response agent: evidence review', 'resolution', 'evidence', () => agents.runEvidenceReview(c._id, { resolutionNote: 'Replaced access point AP-7 on floor 2 and confirmed three laptops stay connected for 30 minutes.' })],
    ];
    for (const [label, agent, task, fn] of tasks) {
      const out = await fn();
      const run = await AgentRun.findOne({ complaint: c._id, agent, ...(task ? { task } : {}) }).sort({ createdAt: -1 }).lean();
      record(`live call: ${label}`, run?.source === 'gemini' && run?.status === 'success',
        `source=${run?.source} errorCategory=${run?.errorCategory ?? 'none'} ${run?.durationMs ?? '?'}ms output=${short(out)}`);
    }
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}
finish();
