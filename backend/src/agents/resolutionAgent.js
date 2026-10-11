/**
 * Resolution and Response Agent (the fourth agent). Three tasks, all advisory and staff-facing:
 *
 *   suggest  - troubleshooting steps, likely causes and possible resolutions
 *   draft    - an editable reply to the student (never sent automatically)
 *   evidence - a review of the written record before a complaint is resolved or closed
 *
 * None of these tasks changes a complaint's status, sends a message or assigns anyone. Sending a
 * reply and moving a complaint to Resolved or Closed are separate, explicit human actions through the
 * comments and status endpoints. The evidence review reads text records only; it cannot inspect
 * photos or confirm physical work, so its result is always `verified: false`.
 */
import { Complaint, Comment, AuditEvent } from '../models/index.js';
import { isAiSource } from '../config/constants.js';
import { resolutionOutput, responseOutput, evidenceOutput, parseModelJson, SAFETY_PREAMBLE, jsonSchemas } from './schemas.js';
import { resolutionFallback, responseFallback, evidenceFallback, hazardsIn, hazardNote } from './fallbacks.js';
import { complaintBlock, execute, loadComplaint } from './core.js';

const AGENT = 'resolution';

// Appended to every evidence review regardless of source, so the limitation can never be dropped.
export const EVIDENCE_LIMITATION = 'Advisory only. This review reads the written record. It cannot inspect photos, visit the site or confirm that work was done. A person decides whether the complaint is resolved or closed.';

const thread = async (complaintId, { includeInternal }) => Comment.find({
  complaint: complaintId, ...(includeInternal ? {} : { visibility: 'public' }),
}).sort({ createdAt: -1 }).limit(8).populate('author', 'role').lean();

const renderThread = (items) => items
  .map((m) => `- [${m.visibility === 'internal' ? 'internal note' : 'public'}; ${m.author?.role ?? 'user'}] ${m.body.slice(0, 400)}`)
  .join('\n') || '- none';

// ---------- Task 1: resolution suggestions ----------
export async function runResolutionSuggestions(complaintId, { triggeredBy } = {}) {
  const c = await loadComplaint(complaintId);
  if (!c) return null;
  // Output is shown to staff and admins only, so internal notes may inform the suggestions.
  const notes = await thread(c._id, { includeInternal: true });
  const r = await execute({
    agent: AGENT, task: 'suggest', complaintId: c._id, triggeredBy,
    fallback: () => resolutionFallback(c),
    callModel: async (p) => parseModelJson(await p.complete({
      system: SAFETY_PREAMBLE,
      jsonSchema: jsonSchemas.resolution,
      prompt: `${complaintBlock(c)}
Current status: ${c.status}
Recent messages and staff notes (newest first):
${renderThread(notes)}

Help the staff member resolve this complaint. Suggest practical troubleshooting steps in order, likely causes, and possible resolutions.
Rules: steps are for campus staff, never instructions for the student to do risky work. Any step involving electricity, gas, structural damage, fire, security incidents or injury must be marked who="specialist" and come with a safety note. Say what information is missing instead of guessing.
Return JSON: {"likelyCauses": ["..."], "troubleshootingSteps": [{"step": "...", "who": "staff|specialist"}], "possibleResolutions": ["..."], "safetyNotes": ["..."], "informationNeeded": ["..."], "limitations": "what these suggestions cannot account for, or null"}`,
    }), resolutionOutput),
  });
  // Guardrail: a hazard mentioned in the complaint always produces a safety note, even if the model omitted one.
  const hazards = hazardsIn(c);
  const safetyNotes = r.output.safetyNotes.length || !hazards.length ? r.output.safetyNotes : [hazardNote(hazards)];
  const result = {
    likelyCauses: r.output.likelyCauses, troubleshootingSteps: r.output.troubleshootingSteps,
    possibleResolutions: r.output.possibleResolutions, safetyNotes,
    informationNeeded: r.output.informationNeeded,
    limitations: r.output.limitations || 'Suggestions are based only on the complaint text and notes. Check on site before acting.',
    source: r.source, model: r.model, generatedAt: new Date(),
  };
  await Complaint.updateOne({ _id: c._id }, { $set: { 'ai.resolution': result } });
  return { ...result, errorCategory: r.errorCategory };
}

// ---------- Task 2: response draft (never sent automatically) ----------
const DATE_LIKE = /\b(today|tomorrow|tonight|within \d+|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?)\b/i;

export async function runResponseAgent(complaintId, { triggeredBy, guidance = '' } = {}) {
  const c = await loadComplaint(complaintId);
  if (!c) return null;
  // Only student-visible history is used, so internal notes can never leak into a reply.
  const publicThread = await thread(c._id, { includeInternal: false });
  const r = await execute({
    agent: AGENT, task: 'draft', complaintId: c._id, triggeredBy,
    fallback: () => responseFallback(c),
    callModel: async (p) => parseModelJson(await p.complete({
      system: SAFETY_PREAMBLE,
      jsonSchema: jsonSchemas.response,
      prompt: `${complaintBlock(c)}
Current status: ${c.status}
Recent public messages (newest first):
${renderThread(publicThread)}
Staff guidance for this reply (trusted): ${guidance.slice(0, 800) || 'none'}

Draft a clear, empathetic, actionable reply from staff to the student. Address them as "Hello," without a name.
Do not promise dates, times or outcomes unless the staff guidance states them. Do not mention other students or internal notes.
Return JSON: {"draft": "the message", "warnings": ["anything staff must verify before sending"]}`,
    }), responseOutput),
  });
  const warnings = [...r.output.warnings];
  if (isAiSource(r.source) && DATE_LIKE.test(r.output.draft)) warnings.push('The draft mentions a date or time. Confirm it is accurate before sending.');
  return {
    draft: r.output.draft, warnings, source: r.source, model: r.model,
    requiresApproval: true, // the caller must send it explicitly through POST /complaints/:id/comments
    contextUsed: { publicMessages: publicThread.length, guidanceProvided: Boolean(guidance) },
    errorCategory: r.errorCategory,
  };
}

// ---------- Task 3: resolution evidence review ----------
async function latestResolutionNote(complaintId) {
  const ev = await AuditEvent.findOne({ resourceType: 'Complaint', resourceId: complaintId, action: 'complaint.status_changed', to: 'Resolved' })
    .sort({ createdAt: -1 }).lean();
  return ev?.reason || '';
}

/**
 * Reviews whether the written record supports resolving or closing the complaint. `resolutionNote`
 * is what staff say was done; if omitted, the note recorded when the complaint was marked Resolved
 * is used.
 */
export async function runEvidenceReview(complaintId, { triggeredBy, resolutionNote } = {}) {
  const c = await loadComplaint(complaintId);
  if (!c) return null;
  const note = (resolutionNote ?? '').trim() || await latestResolutionNote(c._id);
  const notes = await thread(c._id, { includeInternal: true });
  const publicStaffReplies = notes.filter((m) => m.visibility === 'public' && m.author?.role !== 'student').length;
  const workStarted = Boolean(await AuditEvent.exists({ resourceType: 'Complaint', resourceId: c._id, action: 'complaint.status_changed', to: 'In Progress' }));
  const facts = { resolutionNote: note, publicStaffReplies, workStarted, studentPhotos: c.attachments.length };

  const r = await execute({
    agent: AGENT, task: 'evidence', complaintId: c._id, triggeredBy,
    fallback: () => evidenceFallback(facts),
    callModel: async (p) => parseModelJson(await p.complete({
      system: SAFETY_PREAMBLE,
      jsonSchema: jsonSchemas.evidence,
      prompt: `${complaintBlock(c)}
Current status: ${c.status}
Staff resolution note (what staff say was done): ${note ? note.slice(0, 2000) : 'none provided'}
Recorded facts: work marked In Progress: ${workStarted ? 'yes' : 'no'}; public staff replies to the student: ${publicStaffReplies}; photos attached by the student (not visible to you): ${c.attachments.length}
Messages and staff notes (newest first):
${renderThread(notes)}

Review whether this written record supports resolving the complaint. Check that the resolution note addresses the problem actually reported, says what was done, and says how the fix was checked, and that the student was informed.
You cannot see photos or the site, so you cannot confirm the work was done; never claim that it was. Use "cannot_assess" when the record is too thin to judge.
Return JSON: {"assessment": "likely_sufficient|needs_more_information|cannot_assess", "checks": [{"item": "...", "status": "present|missing|unclear", "note": "... or null"}], "followUpQuestions": ["questions staff should answer before closing"], "limitations": "... or null"}`,
    }), evidenceOutput),
  });

  const limitations = [r.output.limitations, EVIDENCE_LIMITATION].filter(Boolean).join(' ');
  const review = {
    assessment: r.output.assessment, checks: r.output.checks, followUpQuestions: r.output.followUpQuestions,
    limitations, verified: false, resolutionNote: note || null, statusAtReview: c.status,
    source: r.source, model: r.model, generatedAt: new Date(), reviewedBy: triggeredBy?._id ?? null,
  };
  await Complaint.updateOne({ _id: c._id }, { $set: { 'ai.evidenceReview': review } });
  return { ...review, errorCategory: r.errorCategory };
}
