'use strict';
const test = require('node:test');
const assert = require('node:assert');
const kit = require('../src/index.js');

// Held-out (hidden from agents). FAILS at base (no slugify); PASSES after the fix.
test('slugify lowercases, trims, hyphenates, strips punctuation', () => {
  assert.strictEqual(typeof kit.slugify, 'function');
  assert.strictEqual(kit.slugify('Hello, World!'), 'hello-world');
  assert.strictEqual(kit.slugify('  Multiple   spaces  '), 'multiple-spaces');
});
