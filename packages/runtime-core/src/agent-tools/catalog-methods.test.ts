import { describe, expect, it } from 'vitest';
import { cliCommand, cliNext, renderForCli } from './catalog-methods.ts';

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
