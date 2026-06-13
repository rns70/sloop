// Minimal refresh-token store implementing ADR-007 (Refresh-token rotation).
// Deliberately tiny — just enough behaviour for the demo's verify commands to test.

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * An in-memory token store with rotation + reuse detection.
 *
 *  - Every refresh issues a NEW token and invalidates the previous one (rotation).
 *  - Tokens expire within 15 minutes.
 *  - Presenting an already-rotated (used) token revokes the whole session family
 *    (reuse detection).
 */
export function createTokenStore({ now = () => Date.now(), ttlMs = FIFTEEN_MINUTES_MS } = {}) {
  let counter = 0;
  // token -> { family, active, expiresAt }
  const tokens = new Map();
  const revokedFamilies = new Set();

  function issue(family) {
    counter += 1;
    const token = `tok_${family}_${counter}`;
    tokens.set(token, { family, active: true, expiresAt: now() + ttlMs });
    return token;
  }

  function startSession() {
    const family = `fam_${counter + 1}`;
    return issue(family);
  }

  function refresh(token) {
    const record = tokens.get(token);
    if (!record) throw new Error('unknown token');
    if (revokedFamilies.has(record.family)) throw new Error('session revoked');

    if (!record.active) {
      // Reuse of a rotated token — revoke the entire family.
      revokedFamilies.add(record.family);
      throw new Error('token reuse detected: session revoked');
    }
    if (now() > record.expiresAt) throw new Error('token expired');

    record.active = false; // rotate: the old token is now dead
    return issue(record.family);
  }

  return { startSession, refresh, ttlMs };
}
