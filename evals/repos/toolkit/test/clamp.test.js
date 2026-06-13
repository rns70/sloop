'use strict';
const test = require('node:test');
const assert = require('node:assert');
const kit = require('../src/index.js');

// Held-out (hidden from agents). FAILS at base (no clamp); PASSES after the fix.
test('clamp bounds a number to [min,max]', () => {
  assert.strictEqual(typeof kit.clamp, 'function');
  assert.strictEqual(kit.clamp(5, 0, 3), 3);
  assert.strictEqual(kit.clamp(-1, 0, 3), 0);
  assert.strictEqual(kit.clamp(2, 0, 3), 2);
});
