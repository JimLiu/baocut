import { describe, expect, it } from 'vitest';
import { mapCodexItem, unwrapShell } from './map-item.ts';

describe('unwrapShell', () => {
  it('去掉登录 shell 的外壳', () => {
    expect(unwrapShell(`/bin/zsh -lc 'ls -la'`)).toBe('ls -la');
    expect(unwrapShell(`/bin/bash -lc 'echo '\\''hi'\\'''`)).toBe(`echo 'hi'`);
    expect(unwrapShell(`/bin/zsh -lc "echo \\"x\\""`)).toBe('echo "x"');
  });

  it('不是一整段被包住的命令原样返回', () => {
    expect(unwrapShell('ls -la')).toBe('ls -la');
    expect(unwrapShell(`bash -c 'a' && 'b'`)).toBe(`bash -c 'a' && 'b'`);
  });
});

describe('mapCodexItem', () => {
  it('命令的标题是里面那条命令，详情保留原文与目录', () => {
    const item = mapCodexItem({
      type: 'commandExecution',
      id: 'i1',
      command: `/bin/zsh -lc 'cat README.md'`,
      cwd: '/tmp/demo',
      status: 'completed',
      aggregatedOutput: '# Demo',
      exitCode: 0,
      durationMs: 12,
    } as never);
    expect(item).toMatchObject({
      kind: 'tool-call',
      tool: 'command',
      title: 'cat README.md',
      detail: `/bin/zsh -lc 'cat README.md'\ncwd: /tmp/demo`,
      status: 'completed',
      exitCode: 0,
    });
  });
});
