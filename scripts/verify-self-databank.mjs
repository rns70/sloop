// One-off: run every databank criterion's verify command and check that the
// recorded `passed` flag matches reality. Honest-snapshot guard for the self-databank.
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';

const dir = 'databank';
let mismatches = 0, total = 0, green = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
  const { data } = matter(readFileSync(`${dir}/${file}`, 'utf8'));
  for (const c of data.acceptanceCriteria ?? []) {
    total++;
    let actual = false;
    try {
      execSync(c.verify, { stdio: 'ignore', shell: '/bin/bash' });
      actual = true;
    } catch {
      actual = false;
    }
    if (actual) green++;
    const ok = actual === c.passed;
    if (!ok) mismatches++;
    console.log(`${ok ? 'OK ' : 'BAD'}  ${data.id}/${c.id}  passed=${c.passed} actual=${actual}  | ${c.verify}`);
  }
}
console.log(`\n${green}/${total} criteria green · ${mismatches} mismatch(es) between recorded passed and reality`);
process.exit(mismatches === 0 ? 0 : 1);
