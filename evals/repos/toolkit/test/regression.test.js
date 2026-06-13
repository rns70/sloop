'use strict';
const test = require('node:test');
const assert = require('node:assert');
const kit = require('../src/index.js');

// Regression guard (PASS_TO_PASS analog) — passes at base; every task's held-out
// includes this so a fix that breaks existing behavior is caught.
test('capitalize works', () => {
  assert.strictEqual(kit.capitalize('hello'), 'Hello');
  assert.strictEqual(kit.capitalize(''), '');
});

test('sum of a non-empty array works', () => {
  assert.strictEqual(kit.sum([1, 2, 3]), 6);
});
