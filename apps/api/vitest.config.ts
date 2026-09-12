import { defineConfig } from 'vitest/config';

const secret = (c: string) => c.repeat(40);

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      // Replaced per test file with the in-memory replica set; must merely pass env validation.
      MONGODB_URI: 'mongodb://placeholder',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      JWT_ACCESS_SECRET: secret('a'),
      JWT_REFRESH_SECRET: secret('b'),
      TICKET_SIGNING_SECRET: secret('c'),
      CORS_ORIGINS: 'http://localhost:5173',
      RAZORPAY_KEY_ID: 'rzp_test_dummy',
      RAZORPAY_KEY_SECRET: 'dummy_key_secret',
      RAZORPAY_WEBHOOK_SECRET: 'dummy_webhook_secret',
    },
  },
});
