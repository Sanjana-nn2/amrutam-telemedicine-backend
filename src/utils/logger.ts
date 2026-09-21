import winston from 'winston';
import { env } from '../config/env';

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'mfasecret',
  'encryptionkey',
  'authorization',
  'cookie',
];

const maskSensitiveData = winston.format((info) => {
  const sanitize = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);

    const copy: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
        copy[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        copy[k] = sanitize(v);
      } else {
        copy[k] = v;
      }
    }
    return copy;
  };

  for (const [k, v] of Object.entries(info)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      info[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      info[k] = sanitize(v);
    }
  }

  return info;
});

const format = winston.format.combine(
  maskSensitiveData(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  env.NODE_ENV === 'production'
    ? winston.format.json()
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          const correlation = info.correlationId ? ` [cid: ${info.correlationId}]` : '';
          return `${info.timestamp} [${info.level}]${correlation}: ${info.message}${
            info.stack ? `\n${info.stack}` : ''
          }`;
        })
      )
);

const transports = [
  new winston.transports.Console({
    silent: env.NODE_ENV === 'test', // Silent during test runs to keep test outputs clean
  }),
];

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format,
  transports,
});
