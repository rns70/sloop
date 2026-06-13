'use strict';
const test = require('node:test');
const assert = require('node:assert');
const kit = require('../src/index.js');

// Held-out (hidden from agents). FAILS at base (sum([]) throws); PASSES after the
// requirement change, and preserves existing behavior (sum([1,2,3]) === 6).
test('sum of an empty array is 0 (adr-031 requirement change)', () => {
  assert.strictEqual(kit.sum([]), 0);
  assert.strictEqual(kit.sum([1, 2, 3]), 6);
});
