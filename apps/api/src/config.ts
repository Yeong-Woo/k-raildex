/** 환경 변수(zod 검증). docs/04-api.md 3절, .env.example */
import { z } from 'zod';

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65535).default(5100),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.string().default('development'),
    CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
    CF_ACCESS_AUD: z.string().optional(),
    ADMIN_EMAIL: z.string().optional(),
    AUTH_DEV_BYPASS: flag,
  })
  .transform((e) => ({
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    nodeEnv: e.NODE_ENV,
    production: e.NODE_ENV === 'production',
    access:
      e.CF_ACCESS_TEAM_DOMAIN && e.CF_ACCESS_AUD && e.ADMIN_EMAIL
        ? {
            teamDomain: e.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
            audience: e.CF_ACCESS_AUD,
            adminEmail: e.ADMIN_EMAIL.toLowerCase(),
          }
        : null,
    adminEmail: e.ADMIN_EMAIL?.toLowerCase() ?? null,
    // 운영(NODE_ENV=production)에서는 무시한다
    devBypass: e.AUTH_DEV_BYPASS && e.NODE_ENV !== 'production',
  }))
  .superRefine((c, ctx) => {
    if (c.production && !c.access)
      ctx.addIssue({
        code: 'custom',
        path: ['CF_ACCESS_TEAM_DOMAIN'],
        message: '운영에서는 CF_ACCESS_TEAM_DOMAIN·CF_ACCESS_AUD·ADMIN_EMAIL 이 필요함',
      });
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = envSchema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`환경 변수 오류\n${msg}`);
  }
  return r.data;
}
