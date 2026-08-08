#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['packages', 'tests'];

const BANNED = [
  { re: /\b(describe|it|test)\.only\s*\(/, why: 'silently reduces the suite to one test' },
  { re: /\b(describe|it|test)\.skip\s*\(/, why: 'disables a test unconditionally' },
  { re: /\b(describe|it|test)\.todo\s*\(/, why: 'disables a test unconditionally' },
  { re: /\bx(describe|it)\s*\(/, why: 'disables a test unconditionally' },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (path.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

const findings = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const { re, why } of BANNED) {
        if (re.test(line)) {
          findings.push({
            file: file.replace(/\\/g, '/'),
            line: index + 1,
            text: line.trim(),
            why,
          });
        }
      }
    });
  }
}

if (findings.length === 0) {
  process.stdout.write('test integrity: no disabled or exclusive tests\n');
  process.exit(0);
}

process.stderr.write('Disabled or exclusive tests found. CI green would be meaningless here.\n\n');
for (const finding of findings) {
  process.stderr.write(`  ${finding.file}:${finding.line}  ${finding.why}\n`);
  process.stderr.write(`    ${finding.text}\n\n`);
}
process.stderr.write(
  'Fix: delete the test, or make the skip conditional with .skipIf(...) / .runIf(...) so it\n' +
    'states what it depends on. testing.md forbids weakening, skipping, or deleting the four\n' +
    'invariant tests (MNE-51 / 63 / 69 / 50) outright.\n',
);
process.exit(1);
