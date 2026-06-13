// Tiny zero-dependency test runner for the demo target repo.
//
// sloop's executor runs each ADR-007 acceptance criterion as a verify command:
//   npm test -- rotation          → runs the "rotation" suite
//   npm test -- reuse-detection    → runs the "reuse-detection" suite
// The trailing arg (after `--`) is a filter; with no filter every suite runs.
// Exit 0 = all matching assertions passed (the criterion is satisfied).

import assert from 'node:assert/strict';
import { createTokenStore } from '../src/tokens.mjs';

const suites = {
  rotation() {
    // A fixed clock so the test is deterministic.
    let t = 1_000;
    const store = createTokenStore({ now: () => t });

    const a = store.startSession();
    const b = store.refresh(a);
    assert.notEqual(a, b, 'refresh must issue a new token (rotation)');

    // The rotated-away token is dead; using it is reuse, not a valid refresh.
    assert.throws(() => store.refresh(a), /reuse/, 'old token must not refresh again');

    // Lifetime is capped at <= 15 minutes.
    assert.ok(store.ttlMs <= 15 * 60 * 1000, 'token TTL must be <= 15 minutes');
  },

  'reuse-detection'() {
    let t = 1_000;
    const store = createTokenStore({ now: () => t });

    const a = store.startSession();
    const b = store.refresh(a); // a is now rotated away

    // Presenting the reused token revokes the family...
    assert.throws(() => store.refresh(a), /reuse|revoked/, 'reuse must be rejected');
    // ...so even the current valid token can no longer refresh.
    assert.throws(() => store.refresh(b), /revoked/, 'family must be revoked after reuse');
  },
};

const filter = process.argv[2];
const names = Object.keys(suites).filter((n) => !filter || n.includes(filter));

if (names.length === 0) {
  console.error(`no test suite matches "${filter}". Known: ${Object.keys(suites).join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const name of names) {
  try {
    suites[name]();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`not ok - ${name}: ${err.message}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
