import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start
 * if anything is missing or malformed. The alternative — reading
 * `process.env.FOO!` at the call site — defers the failure to whenever that
 * code path first runs, which in practice means discovering a missing
 * secret during a live payment rather than at deploy time.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    /**
     * Secrets are separate per token type so that leaking one does not let an
     * attacker mint the other. 32 chars is the floor for HS256 to carry a
     * sensible security margin.
     */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /** Signs QR payloads so a ticket cannot be forged or altered client-side. */
    TICKET_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),

    /** Comma-separated origin allowlist. Wildcards are deliberately unsupported. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    /** Signed direct uploads for event banners. Optional: the upload endpoint answers 503 without them. */
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),

    /** How long a seat reservation lasts before it is released back to sale. */
    HOLD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(480),
    /**
     * Run background job processors inside the API process. Render's free
     * tier has no background-worker service type, so production defaults to
     * one process doing both; set false when running `worker.ts` separately.
     */
    RUN_WORKERS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    QUEUE_PREFIX: z.string().min(1).default('gatherly'),

    /** Transactional email. Without a key, emails are written to the log instead of sent. */
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Gatherly <onboarding@resend.dev>'),
    /** Public URL of the web app, used for links inside emails. */
    WEB_APP_URL: z.url().default('http://localhost:5173'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  /**
   * Razorpay credentials are optional in development so the app boots before
   * an account exists, but a production process without them would fail at
   * the first checkout — so fail at boot instead.
   */
  .refine(
    (e) =>
      e.NODE_ENV !== 'production' ||
      (e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET),
    {
      message: 'Razorpay credentials are required when NODE_ENV=production',
      path: ['RAZORPAY_KEY_ID'],
    },
  );

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // Bypasses the logger deliberately: this runs before the logger exists.
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
