import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { EXIT, Output, exitCodeFor, exitCodeForJob, renderHuman } from './envelope.ts';

function capture(json: boolean) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (chunk) => (out += String(chunk)));
  stderr.on('data', (chunk) => (err += String(chunk)));
  return { output: new Output({ json, stdout, stderr }), out: () => out, err: () => err };
}

describe('信封与退出码', () => {
  it('错误码 → 退出码只有一张表', () => {
    expect(exitCodeFor('CAPABILITY_NOT_CONFIGURED')).toBe(EXIT.actionRequired);
    expect(exitCodeFor('GRANT_REQUIRED')).toBe(EXIT.actionRequired);
    expect(exitCodeFor('TOOL_CONSENT_REQUIRED')).toBe(EXIT.actionRequired);
    expect(exitCodeFor('LINK_TOOL_UPDATE_REQUIRED')).toBe(EXIT.actionRequired);
    expect(exitCodeFor('RUNTIME_IN_USE')).toBe(EXIT.failed);
    expect(exitCodeFor('RUNTIME_NOT_OWNED')).toBe(EXIT.failed);
    expect(exitCodeFor('RUNTIME_UNAVAILABLE')).toBe(EXIT.runtimeUnavailable);
    expect(exitCodeFor('INTERFACE_VERSION_MISMATCH')).toBe(EXIT.runtimeUnavailable);
    expect(exitCodeFor('INVALID_ARGUMENTS')).toBe(EXIT.invalidArguments);
    expect(exitCodeFor('CONFIRMATION_REQUIRED')).toBe(EXIT.invalidArguments);
    expect(exitCodeFor('VIDEO_NOT_FOUND')).toBe(EXIT.failed);
    // 任务的错误码：要用户做事的仍是 2，其余至少是 1。
    expect(exitCodeForJob('TOOL_CONSENT_REQUIRED')).toBe(EXIT.actionRequired);
    expect(exitCodeForJob('INVALID_ARGUMENTS')).toBe(EXIT.failed);
    expect(exitCodeForJob(null)).toBe(EXIT.failed);
  });

  it('--json：成功 { ok, result, next }，失败 { ok: false, error }，都写 stdout', () => {
    const ok = capture(true);
    expect(ok.output.success({ videoId: 'v1', next: '用 baocut videos inspect 看看' })).toBe(0);
    expect(JSON.parse(ok.out())).toEqual({
      ok: true,
      result: { videoId: 'v1' },
      next: '用 baocut videos inspect 看看',
    });

    const started = capture(true);
    started.output.runtimeStarted = true;
    started.output.success({ a: 1 });
    expect(JSON.parse(started.out())).toEqual({ ok: true, result: { a: 1 }, runtime: { started: true } });

    const failed = capture(true);
    expect(
      failed.output.failure({ code: 'GRANT_REQUIRED', message: '要授权', remedy: { hint: '去授权', commands: ['baocut grants create'] } }),
    ).toBe(2);
    expect(JSON.parse(failed.out())).toEqual({
      ok: false,
      error: { code: 'GRANT_REQUIRED', message: '要授权', remedy: { hint: '去授权', commands: ['baocut grants create'] } },
    });
    expect(failed.err()).toBe('');
  });

  it('人读：结果按缩进写 stdout，next 单独一行；失败写 stderr', () => {
    const ok = capture(false);
    ok.output.success({ videoId: 'v1', tracks: [{ id: 't1', kind: 'video' }], tags: ['a', 'b'], next: '下一步' });
    expect(ok.out()).toBe('videoId: v1\ntracks:\n  - id: t1\n    kind: video\ntags: a, b\n下一步: 下一步\n');

    const failed = capture(false);
    failed.output.failure({ code: 'INVALID_ARGUMENTS', message: '缺少 --video', next: 'baocut help videos inspect' });
    expect(failed.out()).toBe('');
    expect(failed.err()).toContain('INVALID_ARGUMENTS: 缺少 --video');
    expect(failed.err()).toContain('下一步: baocut help videos inspect');
  });

  it('多行文本缩进成块', () => {
    expect(renderHuman({ text: '第一行\n第二行' })).toBe('text: |\n  第一行\n  第二行');
  });
});
