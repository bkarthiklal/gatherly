import { Schema, model, type Types } from 'mongoose';

/**
 * One row per issued refresh token.
 *
 * A token is never stored — only its SHA-256 digest. Plain SHA-256 is right
 * here (unlike passwords) because the token is 256 random bits: there is
 * nothing to brute-force, so a slow hash would only add latency.
 *
 * `familyId` links every token descended from one login. Rotation revokes
 * the old row and inserts a new one in the same family. If a revoked token is
 * ever presented again, someone has a copy of it, so the whole family is
 * revoked — the thief and the real user are both logged out, and the real
 * user signs in again with their password.
 */
export interface Session {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
}

const sessionSchema = new Schema<Session>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// MongoDB deletes expired sessions itself, so the collection cannot grow forever.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = model<Session>('Session', sessionSchema);
