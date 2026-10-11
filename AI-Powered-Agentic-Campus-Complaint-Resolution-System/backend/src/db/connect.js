import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  logger.info('database connected', { db: mongoose.connection.name });
  // Build declared indexes (unique email, unique issue-group key, filter indexes). Idempotent.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  return mongoose.connection;
}

export const disconnectDb = () => mongoose.disconnect();

export const dbState = () =>
  ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
