/**
 * Acceptance tests for T1: Add missing CI gates
 * Covers all Acceptance Criteria for issue #11.
 * These tests MUST fail until the implementation is merged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ciPath = path.resolve('.github/workflows/ci.yml');
const ciContent = (() => {
  try {
    return fs.readFileSync(ciPath, 'utf8');
  } catch {
    return '';
  }
})();

// Helper: extract job names from YAML (lines like "  jobname:")
function extractJobNames(yaml) {
  const jobsMatch = yaml.match(/^jobs:\s*$([\s\S]*)/m);
  if (!jobsMatch) return [];
  const body = jobsMatch[1];
  const names = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (m) names.push(m[1]);
  }
  return names;
}

const jobNames = extractJobNames(ciContent);

// AC1: job named exactly "unit"
test('ci.yml contains a job named exactly "unit"', () => {
  assert.ok(jobNames.includes('unit'), `Expected job "unit" in ci.yml. Found jobs: ${jobNames.join(', ')}`);
});

// AC1 (behavior): unit job runs node --test tests/
test('ci.yml "unit" job runs node --test tests/', () => {
  const unitMatch = ciContent.match(/unit:\s*\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\s*\n|\Z)/);
  const unitSection = unitMatch ? unitMatch[0] : ciContent;
  assert.ok(
    unitSection.includes('node --test tests/') || unitSection.includes("node --test 'tests/'"),
    '"unit" job must run "node --test tests/"'
  );
});

// AC2: job named exactly "integration"
test('ci.yml contains a job named exactly "integration"', () => {
  assert.ok(jobNames.includes('integration'), `Expected job "integration" in ci.yml. Found jobs: ${jobNames.join(', ')}`);
});

// AC2 (behavior): integration job runs node --test tests/integration/
test('ci.yml "integration" job runs node --test tests/integration/', () => {
  const idx = ciContent.indexOf('\n  integration:');
  assert.ok(idx !== -1, 'integration job not found');
  const section = ciContent.slice(idx, idx + 800);
  assert.ok(
    section.includes('node --test tests/integration/') || section.includes("node --test 'tests/integration/'"),
    '"integration" job must run "node --test tests/integration/"'
  );
});

// AC3: job named exactly "coverage"
test('ci.yml contains a job named exactly "coverage"', () => {
  assert.ok(jobNames.includes('coverage'), `Expected job "coverage" in ci.yml. Found jobs: ${jobNames.join(', ')}`);
});

// AC3 (behavior): coverage job runs node --test --experimental-test-coverage
test('ci.yml "coverage" job runs node --test --experimental-test-coverage tests/', () => {
  const idx = ciContent.indexOf('\n  coverage:');
  assert.ok(idx !== -1, 'coverage job not found');
  const section = ciContent.slice(idx, idx + 800);
  assert.ok(
    section.includes('--experimental-test-coverage'),
    '"coverage" job must use --experimental-test-coverage'
  );
  assert.ok(
    section.includes('tests/'),
    '"coverage" job must reference tests/'
  );
});

// AC4: job named exactly "lint"
test('ci.yml contains a job named exactly "lint"', () => {
  assert.ok(jobNames.includes('lint'), `Expected job "lint" in ci.yml. Found jobs: ${jobNames.join(', ')}`);
});

// AC4 (behavior): lint job uses node --check on games/ and lib/
test('ci.yml "lint" job runs node --check on games/ and lib/', () => {
  const idx = ciContent.indexOf('\n  lint:');
  assert.ok(idx !== -1, 'lint job not found');
  const section = ciContent.slice(idx, idx + 800);
  assert.ok(section.includes('node --check'), '"lint" job must use "node --check"');
  assert.ok(section.includes('games/') || section.includes('games'), '"lint" job must cover games/');
  assert.ok(section.includes('lib/') || section.includes('lib'), '"lint" job must cover lib/');
});

// AC5: job named exactly "typecheck"
test('ci.yml contains a job named exactly "typecheck"', () => {
  assert.ok(jobNames.includes('typecheck'), `Expected job "typecheck" in ci.yml. Found jobs: ${jobNames.join(', ')}`);
});

// AC5 (behavior): typecheck job uses node --check on games/ and lib/
test('ci.yml "typecheck" job runs node --check on games/ and lib/', () => {
  const idx = ciContent.indexOf('\n  typecheck:');
  assert.ok(idx !== -1, 'typecheck job not found');
  const section = ciContent.slice(idx, idx + 800);
  assert.ok(section.includes('node --check'), '"typecheck" job must use "node --check"');
  assert.ok(section.includes('games/') || section.includes('games'), '"typecheck" job must cover games/');
  assert.ok(section.includes('lib/') || section.includes('lib'), '"typecheck" job must cover lib/');
});

// AC6: all 9 required jobs are present
test('ci.yml contains all 9 required check jobs', () => {
  const required = ['unit', 'integration', 'coverage', 'lint', 'typecheck',
                    'tests-guard', 'secret-scan', 'dependency-gate', 'migration-gate'];
  const missing = required.filter(j => !jobNames.includes(j));
  assert.deepEqual(missing, [], `Missing jobs: ${missing.join(', ')}`);
});

// AC7: tests/placeholder.test.js exists
test('tests/placeholder.test.js exists', () => {
  const placeholderPath = path.resolve('tests/placeholder.test.js');
  assert.ok(
    fs.existsSync(placeholderPath),
    'tests/placeholder.test.js must exist'
  );
});

// AC7 (content): placeholder test file has at least one test
test('tests/placeholder.test.js contains at least one node:test test', () => {
  const placeholderPath = path.resolve('tests/placeholder.test.js');
  assert.ok(fs.existsSync(placeholderPath), 'tests/placeholder.test.js must exist');
  const content = fs.readFileSync(placeholderPath, 'utf8');
  assert.ok(
    content.includes('node:test') || content.includes("from 'node:test'"),
    'placeholder test must import from node:test'
  );
  assert.ok(
    content.includes('test('),
    'placeholder test must contain at least one test() call'
  );
});

// AC9: existing jobs not modified (still present)
test('ci.yml still contains all original jobs', () => {
  const original = ['validate', 'tests-guard', 'secret-scan', 'dependency-gate', 'migration-gate'];
  const missing = original.filter(j => !jobNames.includes(j));
  assert.deepEqual(missing, [], `Original jobs missing: ${missing.join(', ')}`);
});
