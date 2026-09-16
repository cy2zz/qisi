import { z } from 'zod';

const booleanValue = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value),
  z.boolean(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    DB_HOST: z.string().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().positive().max(65535).default(3306),
    DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/).default('qisi_ai'),
    DB_USER: z.string().min(1).default('qisi_ai'),
    DB_PASSWORD: z.string().default(''),
    DB_SSL: booleanValue.default(false),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(10),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && environment.DB_PASSWORD.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['DB_PASSWORD'],
        message: 'DB_PASSWORD is required in production',
      });
    }
    if (environment.NODE_ENV === 'production' && !environment.DB_SSL) {
      context.addIssue({
        code: 'custom',
        path: ['DB_SSL'],
        message: 'DB_SSL must be enabled in production',
      });
    }
  });

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Record<string, unknown>): AppEnvironment {
  return environmentSchema.parse(values);
}

export function environmentFilePaths(nodeEnvironment = process.env.NODE_ENV ?? 'development') {
  return [`.env.${nodeEnvironment}.local`, `.env.${nodeEnvironment}`, '.env.local', '.env'];
}
