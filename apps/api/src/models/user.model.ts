import { USER_ROLES, type PublicUser, type UserRole } from '@gatherly/types';
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface User {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Incremented to invalidate every access token issued before the change. */
  tokenVersion: number;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /**
     * `select: false` means an ordinary query never loads the hash; the one
     * place that needs it (login) must ask for it explicitly with
     * `.select('+passwordHash')`. A forgotten projection therefore fails safe.
     */
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: 'attendee', required: true },
    tokenVersion: { type: Number, default: 0 },
    emailVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const UserModel = model<User>('User', userSchema);

/** The only way a user reaches an API response. */
export function toPublicUser(
  user: Pick<User, '_id' | 'name' | 'email' | 'role' | 'emailVerifiedAt' | 'createdAt'>,
): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}
