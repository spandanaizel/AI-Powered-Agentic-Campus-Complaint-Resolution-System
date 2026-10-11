import fs from 'node:fs';
import * as svc from '../services/complaintService.js';
import { assignComplaint } from '../services/assignmentService.js';
import { scheduleIntake } from '../agents/agents.js';
import { storeImage, storedPath } from '../middleware/upload.js';
import { notFound } from '../utils/errors.js';

export async function create(req, res) {
  const attachment = await storeImage(req.file);
  const { complaint, issue } = await svc.createComplaint({ user: req.user, input: req.body, attachment });
  scheduleIntake(complaint._id); // AI agents run after the response; failures never affect the complaint
  const populated = await svc.getAuthorizedComplaint(req.user, complaint._id, { populate: true });
  res.status(201).json({ complaint: await svc.serializeForRole(populated, req.user), issue: { escalated: issue.escalated } });
}

export async function list(req, res) {
  res.json(await svc.listComplaints(req.user, req.validQuery));
}

export async function stats(req, res) {
  res.json(await svc.complaintStats(req.user));
}

export async function get(req, res) {
  const c = await svc.getAuthorizedComplaint(req.user, req.params.id, { populate: true });
  res.json({ complaint: await svc.serializeForRole(c, req.user) });
}

async function respondWith(req, res, complaintId) {
  const c = await svc.getAuthorizedComplaint(req.user, complaintId, { populate: true });
  res.json({ complaint: await svc.serializeForRole(c, req.user) });
}

export async function changeStatus(req, res) {
  await svc.changeStatus({ user: req.user, complaintId: req.params.id, to: req.body.status, reason: req.body.reason });
  await respondWith(req, res, req.params.id);
}

export async function overridePriority(req, res) {
  await svc.overridePriority({ user: req.user, complaintId: req.params.id, priority: req.body.priority, reason: req.body.reason });
  await respondWith(req, res, req.params.id);
}

export async function assign(req, res) {
  await svc.getAuthorizedComplaint(req.user, req.params.id); // 404 if missing
  await assignComplaint({ complaintId: req.params.id, staffId: req.body.staffId, actor: req.user, reason: req.body.reason });
  await respondWith(req, res, req.params.id);
}

export async function addComment(req, res) {
  const comment = await svc.addComment({ user: req.user, complaintId: req.params.id, ...req.body });
  res.status(201).json({ comment });
}

export async function timeline(req, res) {
  res.json({ items: await svc.timeline(req.user, req.params.id) });
}

export async function attachment(req, res) {
  const c = await svc.getAuthorizedComplaint(req.user, req.params.id);
  const att = c.attachments.id(req.params.attachmentId);
  if (!att) throw notFound('Attachment not found');
  const file = storedPath(att.storedName);
  if (!fs.existsSync(file)) throw notFound('Attachment file is missing');
  res.set({ 'Content-Type': att.mimeType, 'Content-Disposition': `inline; filename="${att.originalName.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=300' });
  fs.createReadStream(file).pipe(res);
}
