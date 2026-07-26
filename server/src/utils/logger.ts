import { env } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = env.isProduction ? LEVEL_ORDER.info : LEVEL_ORDER.debug;

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < minLevel || env.isTest) return;

  if (env.isProduction) {
    // Structured single-line JSON so log aggregators can parse it.
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta });
    (level === 'error' ? console.error : console.log)(line);
    return;
  }

  const prefix = `[${level.toUpperCase()}]`;
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta) {
    target(prefix, message, meta);
  } else {
    target(prefix, message);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta),
};
