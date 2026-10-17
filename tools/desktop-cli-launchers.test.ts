import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Keep the adjacent node:test packaging regressions in the normal cross-platform CI suite.
it('runs the desktop CLI launcher regression suite', () => {
  const file = fileURLToPath(new URL('../apps/desktop/tools/desktop-cli.test.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--test', file], {encoding: 'utf8', timeout: 30_000});
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 35_000);
