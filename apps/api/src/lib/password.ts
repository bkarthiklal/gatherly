import argon2 from 'argon2';

/**
 * Argon2id at the OWASP baseline: 19 MiB memory, 2 passes, 1 lane.
 *
 * Argon2id is used instead of bcrypt because it is memory-hard: each guess
 * costs an attacker 19 MiB of RAM, which is what makes GPU and ASIC cracking
 * rigs uneconomical. bcrypt uses about 4 KiB, so it parallelises cheaply.
 * The salt is generated per hash and stored inside the encoded output.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed stored hash is a data problem, not a reason to let someone in.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same CPU and memory as a real verification. Called on the login
 * path when the email does not exist, so response time does not reveal which
 * addresses have accounts.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-constant-time-login');
  await verifyPassword(await dummyHash, plain);
}
