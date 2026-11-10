import bcrypt from "bcryptjs";

const ROUNDS = 10;

// Phase 1.3: async bcrypt everywhere — sync variants block the event loop
// for the full hash cost on every login/register/verify-password call.
export async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
