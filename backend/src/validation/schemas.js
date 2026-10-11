import { z } from 'zod';
import mongoose from 'mongoose';
import { STATUSES, PRIORITIES, COMMENT_VISIBILITY } from '../config/constants.js';

// Every schema is .strict(): unknown fields (e.g. "role", "status", "reporter") are rejected, which
// blocks mass assignment.
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const text = (min, max) => z.string().trim().min(min).max(max);
const reason = z.string().trim().max(1000).optional();

export const password = z.string().min(8, 'Password must be at least 8 characters').max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

export const registerBody = z.object({
  name: text(2, 100), email: z.string().trim().toLowerCase().email().max(254), password,
}).strict();

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128),
}).strict();

export const createComplaintBody = z.object({
  title: text(5, 150), description: text(20, 5000), categoryId: objectId, locationId: objectId,
}).strict();

const csvEnum = (values) => z.enum(values).optional();
export const listComplaintsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: csvEnum(STATUSES), priority: csvEnum(PRIORITIES),
  categoryId: objectId.optional(), locationId: objectId.optional(),
  assigneeId: z.union([objectId, z.literal('unassigned')]).optional(),
  issueGroupId: objectId.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'priority', 'updated']).default('newest'),
}).strict();

export const statusBody = z.object({ status: z.enum(STATUSES), reason }).strict();
export const priorityBody = z.object({ priority: z.enum(PRIORITIES), reason: text(3, 1000) }).strict();
export const assignBody = z.object({ staffId: objectId, reason }).strict();
export const commentBody = z.object({
  body: text(1, 4000), visibility: z.enum(COMMENT_VISIBILITY).default('public'), fromAiDraft: z.boolean().optional(),
}).strict();
export const responseDraftBody = z.object({ guidance: z.string().trim().max(800).optional() }).strict();
export const evidenceReviewBody = z.object({ resolutionNote: z.string().trim().max(2000).optional() }).strict();

export const createUserBody = z.object({
  name: text(2, 100), email: z.string().trim().toLowerCase().email().max(254), password,
  role: z.enum(['staff', 'admin']),
  categories: z.array(objectId).max(50).optional(),
  maxOpenAssignments: z.number().int().min(1).max(500).optional(),
}).strict();

export const updateUserBody = z.object({
  name: text(2, 100).optional(),
  role: z.enum(['student', 'staff', 'admin']).optional(),
  active: z.boolean().optional(),
  categories: z.array(objectId).max(50).optional(),
  maxOpenAssignments: z.number().int().min(1).max(500).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listUsersQuery = z.object({
  role: z.enum(['student', 'staff', 'admin']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const nameBody = z.object({ name: text(2, 80), description: z.string().trim().max(300).optional() }).strict();
export const updateNamedBody = z.object({
  name: text(2, 80).optional(), description: z.string().trim().max(300).optional(), active: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const resolveIssueBody = z.object({ reason: text(3, 1000) }).strict();

export const reportQuery = z.object({
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
}).strict().refine((v) => !v.from || !v.to || v.from <= v.to, 'from must be before to');

export const idParam = z.object({ id: objectId }).passthrough();
