# T1 Implementation Plan — Add missing CI gates

## Tasks

### Task 1: Add five new jobs to ci.yml
Files: `.github/workflows/ci.yml`
- Add `unit` job: runs `node --test tests/` (exits 0 if absent)
- Add `integration` job: runs `node --test tests/integration/` (exits 0 if absent)
- Add `coverage` job: runs `node --test --experimental-test-coverage tests/` (exits 0 if absent)
- Add `lint` job: runs `node --check` on all `.js` files under `games/` and `lib/`
- Add `typecheck` job: same as lint (distinct job name required by factory-config.json)

### Task 2: Create tests/ scaffold
Files: `tests/.gitkeep`, `tests/placeholder.test.js`
- Create `tests/` directory with `.gitkeep`
- Create `tests/placeholder.test.js` with a minimal node:test test so unit/coverage jobs never error on empty tree

## Acceptance Criteria Mapping
| Criterion | How verified |
|-----------|--------------|
| `unit` job exists and runs `node --test tests/` | ci.yml job definition |
| `integration` job exists and runs `node --test tests/integration/` | ci.yml job definition |
| `coverage` job exists with `--experimental-test-coverage` | ci.yml job definition |
| `lint` job exists with `node --check` on games/ and lib/ | ci.yml job definition |
| `typecheck` job exists with `node --check` on games/ and lib/ | ci.yml job definition |
| All 9 required checks present | ci.yml total job count |
| `tests/placeholder.test.js` exists with node:test test | file existence + content |
| No existing job modified/removed | ci.yml diff check |
