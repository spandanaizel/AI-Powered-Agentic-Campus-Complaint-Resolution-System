import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundRoute(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// Consistent error shape: { error: { code, message, details? } }. No stack traces leave the server.
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })) } });
  }
  if (err?.code === 11000) return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
  if (err instanceof mongoose.Error && /buffering timed out|ECONNREFUSED|server selection/i.test(err.message)) {
    logger.error('database unavailable', { path: req.path });
    return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again shortly.' } });
  }
  logger.error('unhandled error', { path: req.path, method: req.method, message: err?.message });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
}
