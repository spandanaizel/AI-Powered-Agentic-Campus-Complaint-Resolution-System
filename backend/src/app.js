import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env.js';
import { buildRouter } from './routes/index.js';
import { requireCsrfHeader } from './middleware/auth.js';
import { errorHandler, notFoundRoute } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.isProd ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true, allowedHeaders: ['Content-Type', 'X-Requested-With'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', requireCsrfHeader, buildRouter());
  app.use('/api', notFoundRoute);
  app.use(errorHandler);
  return app;
}
