import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { macosGitUsable, resetDeveloperToolsProbe } from './git-probe.ts';
import { findOnPath } from './tool-probe.ts';

/** macOS 上没装开发者工具时的 `/usr/bin/git` 是会弹出安装窗口的占位程序（版本记录设计 §6）：不用它，PATH 里接着往后找。 */
describe('git 的查找', () => {
  afterEach(() => resetDeveloperToolsProbe());

  it('只有 macOS 上的 /usr/bin/git 要看 xcode-select', async () => {
    resetDeveloperToolsProbe(false);
    expect(await macosGitUsable('/usr/bin/git', 'darwin')).not.toBeNull();
    expect(await macosGitUsable('/opt/homebrew/bin/git', 'darwin')).toBeNull();
    expect(await macosGitUsable('/usr/bin/git', 'linux')).toBeNull();
    resetDeveloperToolsProbe(true);
    expect(await macosGitUsable('/usr/bin/git', 'darwin')).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('PATH 里不能用的跳过，接着往后找', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-git-path-'));
    try {
      for (const sub of ['a', 'b']) {
        await fs.mkdir(path.join(dir, sub));
        await fs.writeFile(path.join(dir, sub, 'git'), '#!/bin/sh\n', { mode: 0o755 });
      }
      const search = [path.join(dir, 'a'), path.join(dir, 'b')].join(path.delimiter);
      expect(await findOnPath('git', search)).toBe(path.join(dir, 'a', 'git'));
      expect(await findOnPath('git', search, process.platform, null, async (file) => !file.includes(`${path.sep}a${path.sep}`))).toBe(
        path.join(dir, 'b', 'git'),
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
