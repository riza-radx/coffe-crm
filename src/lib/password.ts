import bcrypt from "bcryptjs";

const ROUNDS = 12;

/** Pre-computed hash of a value nobody uses, to keep failed logins constant-time. */
const DUMMY_HASH = "$2b$12$Q3vQ3sA6x9m0R1r5s7u9ZOa2b4c6d8e0f2g4h6i8j0k2l4m6n8o0q";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  // Always run a comparison so an unknown email costs the same as a wrong password.
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
