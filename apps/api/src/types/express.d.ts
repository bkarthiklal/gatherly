import type { UserRole } from '@gatherly/types';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Read it through `getAuth(req)`, which throws if absent. */
      auth?: { userId: string; role: UserRole };
    }
  }
}

export {};
