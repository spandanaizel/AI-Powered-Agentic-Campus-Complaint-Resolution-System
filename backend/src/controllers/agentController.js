import { runSummaryAgent, runPriorityAgent, runAssignmentAgent, runResponseAgent, runResolutionSuggestions, runEvidenceReview } from '../agents/agents.js';
import { getAuthorizedComplaint } from '../services/complaintService.js';
import { forbidden } from '../utils/errors.js';

// All agent endpoints first verify the caller may see the complaint (404 otherwise). Agents return
// advice only: none of these endpoints sends a message or changes a complaint's status.
export async function summary(req, res) {
  await getAuthorizedComplaint(req.user, req.params.id);
  res.json({ result: await runSummaryAgent(req.params.id, { triggeredBy: req.user }) });
}
export async function priority(req, res) {
  await getAuthorizedComplaint(req.user, req.params.id);
  res.json({ result: await runPriorityAgent(req.params.id, { triggeredBy: req.user }) });
}
export async function assignment(req, res) {
  await getAuthorizedComplaint(req.user, req.params.id);
  // Re-running from the API returns a recommendation only; applying it is an explicit admin action.
  res.json({ result: await runAssignmentAgent(req.params.id, { triggeredBy: req.user, apply: false }) });
}

// Resolution and Response Agent: staff must be the assignee; admins may use it on any complaint.
async function assertResolver(req) {
  const c = await getAuthorizedComplaint(req.user, req.params.id);
  if (req.user.role === 'staff' && String(c.assignee) !== String(req.user._id)) throw forbidden();
  return c;
}
export async function resolutionSuggestions(req, res) {
  await assertResolver(req);
  res.json({ result: await runResolutionSuggestions(req.params.id, { triggeredBy: req.user }) });
}
export async function responseDraft(req, res) {
  await assertResolver(req);
  res.json({ result: await runResponseAgent(req.params.id, { triggeredBy: req.user, guidance: req.body?.guidance }) });
}
export async function evidenceReview(req, res) {
  await assertResolver(req);
  res.json({ result: await runEvidenceReview(req.params.id, { triggeredBy: req.user, resolutionNote: req.body?.resolutionNote }) });
}
