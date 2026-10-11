import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { singleImage } from '../middleware/upload.js';
import * as S from '../validation/schemas.js';
import * as auth from '../controllers/authController.js';
import * as complaints from '../controllers/complaintController.js';
import * as agents from '../controllers/agentController.js';
import * as admin from '../controllers/adminController.js';
import { dbState } from '../db/connect.js';

export function buildRouter() {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: config.loginRateLimit.windowMs, limit: config.loginRateLimit.max,
    standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' } },
  });
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many registrations from this address. Try again later.' } } });
  const agentLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => String(req.user?._id || req.ip), message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests. Please wait a minute.' } } });

  r.get('/health', (_req, res) => res.status(dbState() === 'connected' ? 200 : 503).json({ status: dbState() === 'connected' ? 'ok' : 'degraded', db: dbState() }));

  // Auth
  r.post('/auth/register', registerLimiter, validate(S.registerBody), auth.register);
  r.post('/auth/login', loginLimiter, validate(S.loginBody), auth.login);
  r.post('/auth/logout', requireAuth, auth.logout);
  r.get('/auth/me', requireAuth, auth.me);

  // Reference data (any signed-in user; admins manage)
  r.get('/categories', requireAuth, admin.categories.list);
  r.post('/categories', requireAuth, requireRole('admin'), validate(S.nameBody), admin.categories.create);
  r.patch('/categories/:id', requireAuth, requireRole('admin'), validate(S.idParam, 'params'), validate(S.updateNamedBody), admin.categories.update);
  r.get('/locations', requireAuth, admin.locations.list);
  r.post('/locations', requireAuth, requireRole('admin'), validate(S.nameBody), admin.locations.create);
  r.patch('/locations/:id', requireAuth, requireRole('admin'), validate(S.idParam, 'params'), validate(S.updateNamedBody), admin.locations.update);

  // Complaints (ownership enforced in the service layer for every role)
  const id = validate(S.idParam, 'params');
  r.post('/complaints', requireAuth, requireRole('student'), singleImage('attachment'), validate(S.createComplaintBody), complaints.create);
  r.get('/complaints', requireAuth, validate(S.listComplaintsQuery, 'query'), complaints.list);
  r.get('/complaints/stats', requireAuth, complaints.stats);
  r.get('/complaints/:id', requireAuth, id, complaints.get);
  r.get('/complaints/:id/timeline', requireAuth, id, complaints.timeline);
  r.get('/complaints/:id/attachments/:attachmentId', requireAuth, id, complaints.attachment);
  r.patch('/complaints/:id/status', requireAuth, id, validate(S.statusBody), complaints.changeStatus);
  r.patch('/complaints/:id/priority', requireAuth, requireRole('admin'), id, validate(S.priorityBody), complaints.overridePriority);
  r.post('/complaints/:id/assign', requireAuth, requireRole('admin'), id, validate(S.assignBody), complaints.assign);
  r.post('/complaints/:id/comments', requireAuth, id, validate(S.commentBody), complaints.addComment);

  // AI agents (server-side only)
  r.post('/complaints/:id/agents/summary', requireAuth, requireRole('staff', 'admin'), agentLimiter, id, agents.summary);
  r.post('/complaints/:id/agents/priority', requireAuth, requireRole('admin'), agentLimiter, id, agents.priority);
  r.post('/complaints/:id/agents/assignment', requireAuth, requireRole('admin'), agentLimiter, id, agents.assignment);
  // Resolution and Response Agent (three tasks)
  r.post('/complaints/:id/agents/resolution-suggestions', requireAuth, requireRole('staff', 'admin'), agentLimiter, id, agents.resolutionSuggestions);
  r.post('/complaints/:id/agents/response-draft', requireAuth, requireRole('staff', 'admin'), agentLimiter, id, validate(S.responseDraftBody), agents.responseDraft);
  r.post('/complaints/:id/agents/evidence-review', requireAuth, requireRole('staff', 'admin'), agentLimiter, id, validate(S.evidenceReviewBody), agents.evidenceReview);

  // Admin
  r.get('/users', requireAuth, requireRole('admin'), validate(S.listUsersQuery, 'query'), admin.listUsers);
  r.post('/users', requireAuth, requireRole('admin'), validate(S.createUserBody), admin.createUser);
  r.patch('/users/:id', requireAuth, requireRole('admin'), id, validate(S.updateUserBody), admin.updateUser);
  r.get('/staff', requireAuth, requireRole('admin'), admin.listStaff);
  r.get('/issues', requireAuth, requireRole('admin'), admin.listIssues);
  r.post('/issues/:id/resolve', requireAuth, requireRole('admin'), id, validate(S.resolveIssueBody), admin.resolveIssue);
  r.get('/reports/summary', requireAuth, requireRole('admin'), validate(S.reportQuery, 'query'), admin.report);
  r.get('/settings', requireAuth, requireRole('admin'), admin.settings);

  return r;
}
