import { ConfigService } from './config/config.service.js';
import { DEFAULT_SERVER_DATABASE_PATH } from './config/constants.js';
import { createContainer } from './container.js';
import { openDatabase } from './db/database.client.js';
import { buildServer } from './server.js';
import { Logger } from './shared/logger/logger.js';

async function bootstrap(): Promise<void> {
  const config = ConfigService.fromEnv();
  Logger.configure(config.get('LOG_LEVEL'));
  const logger = new Logger('Main');

  // A server needs state that survives restarts, so unlike the CLI it defaults to a file.
  const databasePath = config.get('DATABASE_PATH') ?? DEFAULT_SERVER_DATABASE_PATH;
  if (databasePath === ':memory:') {
    logger.warn('DATABASE_PATH=:memory: -- refunds and the audit log are lost on restart');
  }

  const container = createContainer({
    config,
    database: await openDatabase(databasePath, { seedSampleOrders: config.get('SEED_SAMPLE_ORDERS') }),
  });
  await container.verify(); // fail fast on a database that doesn't match the code
  // One instance owns the database, so a review still "deciding" belongs to a process that died: put it back.
  const recovered = container.approvals ? await container.reviews.recover() : 0;
  if (recovered > 0) logger.warn('reviews left mid-answer by a previous run were put back to waiting', { recovered });
  const app = buildServer(container);

  // Graceful shutdown: let in-flight requests finish, then close the database.
  const shutdown = async (signal: string): Promise<void> => {
    logger.log('shutting down', { signal });
    try {
      await app.close(); // stops accepting, lets in-flight requests finish
      await container.close();
      process.exit(0);
    } catch (error) {
      logger.error('error during shutdown', { err: String(error) });
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const host = config.get('HOST');
  const port = config.get('PORT');
  await app.listen({ host, port });
  logger.log('support triage service listening', {
    host,
    port,
    database: databasePath,
    llm: container.llm.name,
  });
}

bootstrap().catch((error) => {
  new Logger('Main').fatal('failed to start', { err: String(error) });
  process.exit(1);
});
