import path from 'node:path';
import pino from 'pino';
import { env } from '../config/env.js';
import { PATHS } from './paths.js';

/**
 * Structured logging with Pino.
 * - Human-readable output on stderr (pino-pretty), so stdout stays clean for JSON results
 * - Machine-readable JSON lines in logs/framework.log (CI artifact / log shipping)
 */
const silent = env.LOG_LEVEL === 'silent';

const transport = silent
  ? undefined
  : pino.transport({
      targets: [
        {
          target: 'pino-pretty',
          level: env.LOG_LEVEL,
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app', destination: 2 }
        },
        {
          target: 'pino/file',
          level: 'debug',
          options: { destination: path.join(PATHS.logs, 'framework.log'), mkdir: true }
        }
      ]
    });

export const logger = pino(
  {
    level: silent ? 'silent' : 'debug',
    base: { app: 'ai-qa-agent-framework' },
    redact: { paths: ['*.apiKey', '*.password', '*.token', 'headers.authorization'], censor: '[REDACTED]' }
  },
  transport
);

export const agentLogger = (agent: string) => logger.child({ agent });
