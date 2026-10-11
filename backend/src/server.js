import { config, assertConfig } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';
import { providerStatus } from './agents/providers/index.js';
import { logger } from './utils/logger.js';

async function main() {
  try { assertConfig(config); } catch (err) { console.error(err.message); process.exit(1); }
  try {
    await connectDb(config.mongoUri);
  } catch (err) {
    console.error(`Could not connect to MongoDB at the configured MONGODB_URI: ${err.message}`);
    process.exit(1);
  }
  const server = createApp().listen(config.port, () => {
    logger.info('api listening', { port: config.port, env: config.env, aiProvider: providerStatus() });
  });
  const shutdown = async (sig) => {
    logger.info('shutting down', { sig });
    server.close(async () => { await disconnectDb(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
