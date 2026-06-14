import { describe, it, expect } from 'vitest';
import { wordDiff, diffRows, diffStats } from './diff';

describe('wordDiff', () => {
  it('tags only the changed word, leaving surrounding words same', () => {
    const segs = wordDiff('the quick brown fox', 'the slow brown fox');
    const after = segs.filter((s) => s.op !== 'del').map((s) => s.text).join('');
    expect(after).toBe('the slow brown fox');
    expect(segs.some((s) => s.op === 'del' && s.text.includes('quick'))).toBe(true);
    expect(segs.some((s) => s.op === 'add' && s.text.includes('slow'))).toBe(true);
    expect(segs.some((s) => s.op === 'same' && s.text.includes('brown'))).toBe(true);
  });

  it('merges adjacent same-op segments', () => {
    const segs = wordDiff('a b c', 'a b c');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ op: 'same', text: 'a b c' });
  });
});

describe('diffRows', () => {
  it('pairs a remove+add run into a mod row with word segments', () => {
    const rows = diffRows('hello world', 'hello there');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('mod');
    if (rows[0].kind === 'mod') {
      expect(rows[0].text).toBe('hello there');
      expect(rows[0].segs.some((s) => s.op === 'add' && s.text.includes('there'))).toBe(true);
    }
  });

  it('emits pure add and pure del rows when only one side has a line', () => {
    const rows = diffRows('keep\n', 'keep\nadded');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'add']);
  });

  it('leaves leftover rows when del and add runs are uneven', () => {
    const rows = diffRows('a\nb', 'A');
    expect(rows.map((r) => r.kind)).toEqual(['mod', 'del']);
  });

  it('passes unchanged lines through as same rows', () => {
    const rows = diffRows('one\ntwo', 'one\ntwo');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same']);
  });
});

describe('diffStats', () => {
  it('counts add/del/mod lines (mod counts as both)', () => {
    expect(diffStats('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 });
  });

  it('reports zero for identical input', () => {
    expect(diffStats('same', 'same')).toEqual({ added: 0, removed: 0 });
  });
});
