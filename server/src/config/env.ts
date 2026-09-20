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
    DB_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('qisi_ai'),
    DB_USER: z.string().min(1).default('qisi_ai'),
    DB_PASSWORD: z.string().default(''),
    DB_SSL: booleanValue.default(false),
    DB_SSL_CA_PATH: z.string().min(1).default('certs/ApsaraDB-CA-Chain.pem'),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(10),
    MEDIA_STORAGE_ROOT: z.string().min(1).default('.data/private-media'),
    AI_BASE_URL: z.url().default('https://newapi.inner.youdao.com/v1'),
    AI_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).default('gpt-5.5'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(60_000),
    YOUDAO_SPEECH_APP_KEY: z.string().min(1).optional(),
    YOUDAO_SPEECH_APP_SECRET: z.string().min(1).optional(),
    YOUDAO_SPEECH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(25_000),
    VOLC_TTS_API_KEY: z.string().min(1).optional(),
    VOLC_TTS_RESOURCE_ID: z.string().min(1).default('seed-tts-2.0'),
    VOLC_TTS_SPEAKER: z.string().min(1).default('zh_female_vv_uranus_bigtts'),
    VOLC_TTS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(30_000),
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
    if (Boolean(environment.YOUDAO_SPEECH_APP_KEY) !== Boolean(environment.YOUDAO_SPEECH_APP_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['YOUDAO_SPEECH_APP_SECRET'],
        message: 'YOUDAO_SPEECH_APP_KEY and YOUDAO_SPEECH_APP_SECRET must be configured together',
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
