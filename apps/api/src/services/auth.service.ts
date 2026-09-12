import type { AuthResponse, LoginInput, RegisterInput } from '@gatherly/types';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/password.js';
import { SessionModel } from '../models/session.model.js';
import { UserModel, toPublicUser, type User } from '../models/user.model.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  newTokenFamily,
  refreshTokenExpiry,
  signAccessToken,
} from './token.service.js';

export interface ClientInfo {
  userAgent: string | null;
  ip: string | null;
}

export interface AuthResult {
  body: AuthResponse;
  refreshToken: string;
}

const MONGO_DUPLICATE_KEY = 11000;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === MONGO_DUPLICATE_KEY
  );
}

async function issueSession(
  user: User,
  client: ClientInfo,
  familyId = newTokenFamily(),
): Promise<AuthResult> {
  const refreshToken = generateRefreshToken();
  await SessionModel.create({
    userId: user._id,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiry(),
    userAgent: client.userAgent?.slice(0, 300) ?? null,
    ip: client.ip,
  });

  return {
    refreshToken,
    body: {
      user: toPublicUser(user),
      accessToken: signAccessToken({
        id: user._id.toString(),
        role: user.role,
        tokenVersion: user.tokenVersion,
      }),
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    },
  };
}

export async function register(input: RegisterInput, client: ClientInfo): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      passwordHash,
      // The schema already restricts this to attendee | organiser; admin is never self-assigned.
      role: input.role,
    });
    return await issueSession(user.toObject(), client);
  } catch (err) {
    // The unique index is the authority — a "check then insert" would race.
    if (isDuplicateKeyError(err))
      throw AppError.conflict('An account with this email already exists');
    throw err;
  }
}

const INVALID_CREDENTIALS = 'Invalid email or password';

export async function login(input: LoginInput, client: ClientInfo): Promise<AuthResult> {
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash').lean();

  if (!user) {
    await verifyAgainstDummy(input.password);
    throw AppError.unauthenticated(INVALID_CREDENTIALS);
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw AppError.unauthenticated(INVALID_CREDENTIALS);
  }
  return issueSession(user, client);
}

/**
 * Rotates a refresh token.
 *
 * The update that revokes the presented session is conditional on it not
 * already being revoked, so two concurrent refreshes with the same token
 * cannot both succeed: exactly one wins, and the other is treated as reuse.
 */
export async function refresh(
  presentedToken: string | undefined,
  client: ClientInfo,
): Promise<AuthResult> {
  if (!presentedToken) throw AppError.unauthenticated('No refresh token');
  const tokenHash = hashRefreshToken(presentedToken);
  const now = new Date();

  const session = await SessionModel.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
    { returnDocument: 'before' },
  ).lean();

  if (!session) {
    const known = await SessionModel.findOne({ tokenHash }).lean();
    if (known?.revokedAt) {
      // A token that was already rotated has come back: treat as stolen.
      await SessionModel.updateMany(
        { familyId: known.familyId, revokedAt: null },
        { $set: { revokedAt: now } },
      );
    }
    throw AppError.unauthenticated('Refresh token is invalid or expired');
  }

  const user = await UserModel.findById(session.userId).lean();
  if (!user) throw AppError.unauthenticated('Account no longer exists');

  return issueSession(user, client, session.familyId);
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  await SessionModel.updateOne(
    { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/** Signs the user out on every device: revokes all sessions and outdates every access token. */
export async function logoutEverywhere(userId: string): Promise<void> {
  await Promise.all([
    SessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }),
    UserModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }),
  ]);
}
