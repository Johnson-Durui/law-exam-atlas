#!/usr/bin/env node
/* Zero-dependency Node test runner for law-exam-atlas. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const TESTS_DIR = __dirname;
const ORDERED_SUITES = [
  'test_model.cjs',
  'test_learning_model.cjs',
  'test_study_progress.cjs',
  'test_renderer.cjs',
  'test_dense_renderer.cjs',
  'test_logic_renderer.cjs',
  'test_learning_renderer.cjs',
  'test_app.cjs',
];

function discoverSuites() {
  const existing = new Set(
    fs.readdirSync(TESTS_DIR).filter(name => /^test_.*\.cjs$/.test(name))
  );
  const ordered = ORDERED_SUITES.filter(name => existing.has(name));
  const extras = [...existing].filter(name => !ORDERED_SUITES.includes(name)).sort();
  return [...ordered, ...extras];
}

function runSuite(fileName) {
  const fullPath = path.join(TESTS_DIR, fileName);
  const start = performance.now();
  const proc = spawnSync(process.execPath, [fullPath], {
    cwd: path.resolve(TESTS_DIR, '..'),
    encoding: 'utf8',
    timeout: 60000,
  });
  const elapsedMs = Math.round(performance.now() - start);
  const passed = proc.status === 0 && !proc.error;
  return {
    name: fileName,
    passed,
    status: proc.status,
    elapsedMs,
    stdout: (proc.stdout || '').trim(),
    stderr: (proc.stderr || '').trim(),
    error: proc.error ? proc.error.message : '',
  };
}

function main() {
  const filter = process.argv[2] ? process.argv[2].toLowerCase() : '';
  const suites = discoverSuites().filter(name => !filter || name.toLowerCase().includes(filter));
  if (!suites.length) {
    console.error('No matching JS test suites found in tests/.');
    process.exitCode = 1;
    return;
  }

  const totalStart = performance.now();
  const results = [];
  console.log(`Running ${suites.length} test suite(s) with Node ${process.version}...\n`);

  for (const suite of suites) {
    const res = runSuite(suite);
    results.push(res);
    const badge = res.passed ? '[PASS]' : '[FAIL]';
    console.log(`  ${badge} ${res.name.padEnd(28)} ${String(res.elapsedMs).padStart(5)} ms`);
    if (!res.passed) {
      if (res.error) console.error(`         Error: ${res.error}`);
      if (res.stderr) console.error(res.stderr.split('\n').map(l => `         ${l}`).join('\n'));
      else if (res.stdout) console.error(res.stdout.split('\n').map(l => `         ${l}`).join('\n'));
    }
  }

  const totalElapsedMs = Math.round(performance.now() - totalStart);
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;

  console.log('\n' + '-'.repeat(52));
  console.log(
    `Summary: ${passedCount}/${results.length} passed, ${failedCount} failed (${totalElapsedMs} ms)`
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main();
