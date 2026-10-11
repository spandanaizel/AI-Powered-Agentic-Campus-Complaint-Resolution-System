import { Complaint, AgentRun } from '../models/index.js';
import { AUTO_PRIORITY_SOURCES } from '../config/constants.js';
import { config } from '../config/env.js';
import { ProviderError } from './providers/errors.js';
import { isAiSource } from '../config/constants.js';
import { summaryOutput, priorityOutput, assignmentOutput, parseModelJson, SAFETY_PREAMBLE, jsonSchemas } from './schemas.js';
import { summaryFallback, priorityFallback, assignmentFallback } from './fallbacks.js';
import { complaintBlock, execute, loadComplaint } from './core.js';
// The fourth agent lives in its own module; re-exported here so every agent is importable from one place.
export { runResolutionSuggestions, runResponseAgent, runEvidenceReview } from './resolutionAgent.js';
import { eligibleStaff, assignComplaint } from '../services/assignmentService.js';
import { audit } from '../services/auditService.js';
import { logger } from '../utils/logger.js';

// ---------- 1. Complaint Summary Agent ----------
/** The production summary prompt. Exported so verify:gemini exercises exactly what the app sends. */
export const summaryPrompt = (c) => `${complaintBlock(c)}
Summarise this complaint for triage staff. Return JSON:
{"summary": "<= 2 sentences, only facts stated in the complaint",
 "keyFacts": ["short factual points from the text"],
 "categoryHint": "a better-fitting category name if the chosen one looks wrong, else null",
 "limitations": "what is missing or unclear, else null"}`;

export async function runSummaryAgent(complaintId, { triggeredBy } = {}) {
  const c = await loadComplaint(complaintId);
  if (!c) return null;
  const r = await execute({
    agent: 'summary', complaintId: c._id, triggeredBy,
    fallback: () => summaryFallback(c),
    callModel: async (p) => parseModelJson(await p.complete({ system: SAFETY_PREAMBLE, jsonSchema: jsonSchemas.summary, prompt: summaryPrompt(c) }), summaryOutput),
  });
  const summary = { text: r.output.summary, keyFacts: r.output.keyFacts, categoryHint: r.output.categoryHint ?? null, limitations: r.output.limitations ?? null, source: r.source, model: r.model, generatedAt: new Date() };
  await Complaint.updateOne({ _id: c._id }, { $set: { 'ai.summary': summary } });
  return { ...summary, errorCategory: r.errorCategory };
}

// ---------- 2. Priority Prediction Agent ----------
export async function runPriorityAgent(complaintId, { triggeredBy } = {}) {
  const c = await loadComplaint(complaintId);
  if (!c) return null;
  const r = await execute({
    agent: 'priority', complaintId: c._id, triggeredBy,
    fallback: () => priorityFallback(c),
    callModel: async (p) => parseModelJson(await p.complete({
      system: SAFETY_PREAMBLE,
      jsonSchema: jsonSchemas.priority,
      prompt: `${complaintBlock(c)}
Recommend an urgency level using only: safety risk, number of people affected, disruption to study/living, and time sensitivity.
Levels: Low (minor inconvenience), Medium (service degraded), High (safety risk or major disruption), Critical (immediate danger to people).
Return JSON: {"priority": "Low|Medium|High|Critical", "rationale": "one or two sentences", "confidence": 0.0-1.0}`,
    }), priorityOutput),
  });
  const prediction = { predicted: r.output.priority, rationale: r.output.rationale, confidence: r.output.confidence ?? null, source: r.source, model: r.model, generatedAt: new Date() };
  await Complaint.updateOne({ _id: c._id }, { $set: { 'ai.priority': prediction } });

  // Apply the recommendation only while the priority is still automatic. Escalation and human
  // overrides always win; the conditional filter makes this safe against a concurrent escalation.
  const applied = await Complaint.findOneAndUpdate(
    { _id: c._id, prioritySource: { $in: AUTO_PRIORITY_SOURCES } },
    { $set: { priority: r.output.priority, prioritySource: isAiSource(r.source) ? 'ai' : 'fallback-rules' } },
    { new: false },
  );
  if (applied && applied.priority !== r.output.priority) {
    await audit({ actorType: 'agent', action: 'complaint.priority_predicted', resourceId: c._id, from: applied.priority, to: r.output.priority, reason: isAiSource(r.source) ? `AI recommendation: ${r.output.rationale}` : r.output.rationale });
  }
  return { ...prediction, applied: Boolean(applied), errorCategory: r.errorCategory };
}

// ---------- 3. Automatic Assignment Agent ----------
export async function runAssignmentAgent(complaintId, { triggeredBy, apply = config.agents.autoAssign } = {}) {
  const c = await loadComplaint(complaintId);
  if (!c) return null;
  const all = await eligibleStaff(c.category._id);
  const candidates = all.filter((s) => s.openAssignments < s.maxOpenAssignments);

  if (!candidates.length) {
    const reason = all.length ? 'All eligible staff are at capacity; left in the admin queue.' : 'No active staff cover this category; left in the admin queue.';
    await AgentRun.create({ agent: 'assignment', complaint: c._id, status: 'fallback', source: 'none', errorCategory: 'no_candidates', durationMs: 0, triggeredBy: triggeredBy?._id ?? null });
    const rec = { recommendedStaff: null, reason, applied: false, source: 'fallback', model: null, generatedAt: new Date() };
    await Complaint.updateOne({ _id: c._id }, { $set: { 'ai.assignment': rec } });
    return { ...rec, errorCategory: 'no_candidates' };
  }

  let r;
  if (candidates.length === 1) {
    // Nothing for a model to decide; record a deterministic choice honestly.
    await AgentRun.create({ agent: 'assignment', complaint: c._id, status: 'fallback', source: 'fallback', errorCategory: null, durationMs: 0, triggeredBy: triggeredBy?._id ?? null });
    r = { output: { staffId: String(candidates[0]._id), reason: 'Rule-based: the only eligible staff member with capacity.' }, source: 'fallback', model: null, errorCategory: null };
  } else {
    const ids = new Set(candidates.map((s) => String(s._id)));
    r = await execute({
      agent: 'assignment', complaintId: c._id, triggeredBy,
      fallback: () => assignmentFallback(candidates),
      callModel: async (p) => {
        const out = parseModelJson(await p.complete({
          system: SAFETY_PREAMBLE,
          jsonSchema: jsonSchemas.assignment([...ids]),
          prompt: `${complaintBlock(c)}
Eligible staff (all handle this category and have capacity):
${candidates.map((s) => `- id=${s._id} name=${s.name} open_assignments=${s.openAssignments}/${s.maxOpenAssignments}`).join('\n')}
Pick the most suitable staff member, balancing workload. Return JSON: {"staffId": "<one id from the list>", "reason": "one sentence"}`,
        }), assignmentOutput);
        // Guardrail: never accept an id outside the validated candidate list.
        if (!ids.has(out.staffId)) throw new ProviderError('malformed_output', 'Model chose a staff id outside the eligible list');
        return out;
      },
    });
  }

  let applied = false;
  if (apply && !c.assignee && ['Submitted', 'Reviewed'].includes(c.status)) {
    try {
      await assignComplaint({ complaintId: c._id, staffId: r.output.staffId, actor: null, actorType: 'agent', reason: r.output.reason, source: 'agent' });
      applied = true;
    } catch (err) {
      logger.warn('automatic assignment not applied', { complaintId: String(c._id), reason: err.message });
    }
  }
  const rec = { recommendedStaff: r.output.staffId, reason: r.output.reason, applied, source: r.source, model: r.model, generatedAt: new Date() };
  await Complaint.updateOne({ _id: c._id }, { $set: { 'ai.assignment': rec } });
  return { ...rec, errorCategory: r.errorCategory };
}

/**
 * Intake pipeline run after a complaint is created. Each agent is isolated: a failure in one never
 * blocks the others or the complaint itself.
 */
export async function runIntake(complaintId) {
  const results = {};
  for (const [name, fn] of [['summary', runSummaryAgent], ['priority', runPriorityAgent], ['assignment', runAssignmentAgent]]) {
    try { results[name] = await fn(complaintId); } catch (err) {
      logger.error('agent crashed', { agent: name, complaintId: String(complaintId), message: err.message });
      results[name] = { error: 'internal' };
    }
  }
  return results;
}

/** Fire-and-forget scheduler; tests replace it to await the pipeline deterministically. */
let scheduler = (fn) => setImmediate(() => { fn().catch((err) => logger.error('intake failed', { message: err.message })); });
export const scheduleIntake = (complaintId) => scheduler(() => runIntake(complaintId));
export const setIntakeScheduler = (s) => { scheduler = s; };
