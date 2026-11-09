import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import { catalogMethods, cliCommand, cliNext, renderForCli } from './catalog-methods.ts';
import type { ToolCatalog } from './tool-catalog.ts';

const names = ['videos_inspect', 'videos_import_package', 'models_install', 'jobs_wait', 'transcribe', 'export'];

describe('next 按主体渲染（给 CLI）', () => {
  it('工具名换成 baocut 命令，多词动词用 -；一级动词与普通词不动', () => {
    expect(cliCommand('videos_import_package')).toBe('videos import-package');
    expect(cliCommand('export')).toBe('export');
    expect(cliNext('用 videos_inspect 重新读取，再 export；models_install 之后用 jobs_wait 等', names)).toBe(
      '用 baocut videos inspect 重新读取，再 export；baocut models install 之后用 baocut jobs wait 等',
    );
    expect(cliNext('my_videos_inspect_x 与 videos_import_package', names)).toBe('my_videos_inspect_x 与 baocut videos import-package');
  });

  it('只改结果与错误顶层的 next', () => {
    expect(renderForCli({ ok: true, result: { next: '用 videos_inspect', nested: { next: 'videos_inspect' } } }, names)).toEqual({
      ok: true,
      result: { next: '用 baocut videos inspect', nested: { next: 'videos_inspect' } },
    });
    expect(renderForCli({ ok: false, error: { code: 'X', message: 'videos_inspect', next: 'models_install' } }, names)).toEqual({
      ok: false,
      error: { code: 'X', message: 'videos_inspect', next: 'baocut models install' },
    });
    const plain = { ok: true as const, result: [1, 2] };
    expect(renderForCli(plain, names)).toBe(plain);
  });
});

describe('cliEntry.* 的权限', () => {
  const principal = (kind: TrustedPrincipal['kind']): TrustedPrincipal => ({ connectionId: 'c1', kind, name: kind });

  it('状态给 cli、desktop 与浏览器；装与移除只给 cli 与 desktop', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-entry-methods-')));
    try {
      const methods = catalogMethods({} as ToolCatalog, { home: path.join(dir, 'home'), userHome: dir, env: { SHELL: '/nonexistent/shell' } });
      for (const kind of ['cli', 'desktop', 'web'] as const) {
        expect((await methods['cliEntry.status']({}, principal(kind))).state).toBe('none');
      }
      for (const method of ['cliEntry.install', 'cliEntry.remove'] as const) {
        for (const kind of ['web', 'agent', 'service'] as const) {
          const error = await Promise.resolve()
            .then(() => methods[method]({}, principal(kind)))
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(RpcError);
          expect((error as RpcError).code).toBe('forbidden');
        }
      }
      const unavailable = await Promise.resolve()
        .then(() => methods['cliEntry.install']({}, principal('cli')))
        .catch((e: unknown) => e);
      expect((unavailable as RpcError).details).toMatchObject({ code: 'CLI_ENTRY_UNAVAILABLE' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
