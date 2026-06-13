'use strict';

/** Capitalize the first character of a string. */
function capitalize(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/** Sum an array of numbers. NOTE: throws on an empty array (see adr-031). */
function sum(nums) {
  return nums.reduce((a, b) => a + b);
}

module.exports = { capitalize, sum };
