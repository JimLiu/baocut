import { describe, expect, it } from 'vitest';
import { fileChangeDiff, PiItemMapper, piToolItem, toolResult } from './pi-items.ts';

/** pi 工具结果的解析：形状取自 pi 1.0.4 的真实输出，另有旧式字段的退路。 */
describe('pi 工具条目', () => {
  it('bash：structuredContent 优先；没有时从文字里剥掉退出码那一行', () => {
    expect(
      toolResult(
        'bash',
        {
          content: [{ type: 'text', text: 'one\n\n\nCommand exited with code 3' }],
          structuredContent: { output: 'one\n', exit_code: 3 },
        },
        true,
      ),
    ).toEqual({ output: 'one\n', exitCode: 3 });
    expect(toolResult('bash', { content: [{ type: 'text', text: 'x\n\n\nCommand exited with code 2' }] }, true)).toEqual({
      output: 'x',
      exitCode: 2,
    });
    expect(toolResult('bash', { content: [{ type: 'text', text: 'ok' }] }, false)).toEqual({ output: 'ok', exitCode: 0 });
    expect(toolResult('bash', { stdout: 'legacy', code: 1 }, true)).toEqual({ output: 'legacy', exitCode: 1 });
    expect(toolResult('read', { content: [{ type: 'text', text: 'a' }, { type: 'image' }] }, false)).toEqual({
      output: 'a\n[图片]',
      exitCode: null,
    });
  });

  it('edit：没有 details.patch 时从 edits 或旧式 old_string / new_string 合成；工作目录里的绝对路径写相对路径', () => {
    expect(fileChangeDiff('edit', { path: '/w/src/a.ts', edits: [{ oldText: 'a\nb', newText: 'c' }] }, { content: [] }, '/w')).toBe(
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +0,0 @@\n-a\n-b\n+c',
    );
    expect(fileChangeDiff('edit', { path: 'a.ts', old_string: 'x', new_string: 'y' }, null, '/w')).toBe(
      '--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +0,0 @@\n-x\n+y',
    );
    expect(fileChangeDiff('write', { path: '/elsewhere/n.txt', content: '' }, null, '/w')).toBe('+++ /elsewhere/n.txt\n@@ -0,0 +1,0 @@');
  });

  it('标题：读、搜一类带工具名；未知工具取第一个字符串参数', () => {
    expect(piToolItem('1', 'grep', { pattern: 'foo', path: 'src' }, null).title).toBe('grep foo · src');
    expect(piToolItem('1', 'ls', {}, null).title).toBe('ls');
    expect(piToolItem('1', 'subagent', { task: 'look around\nmore' }, null)).toMatchObject({
      tool: 'other',
      title: 'subagent look around',
    });
  });

  it('回合在工具结束前收尾：工具记成 interrupted，开着的文字按已有内容收掉', () => {
    const mapper = new PiItemMapper('t', null, () => 0);
    mapper.map({ type: 'message_start', message: { role: 'assistant' } });
    mapper.map({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hal' } });
    mapper.map({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'bash', args: { command: 'sleep 1' } });
    const events = mapper.finish();
    expect(
      events.map((e) =>
        e.type === 'item.completed' ? [e.item.kind, 'status' in e.item ? e.item.status : (e.item as { text: string }).text] : null,
      ),
    ).toEqual([
      ['agent-message', 'hal'],
      ['tool-call', 'interrupted'],
    ]);
  });
});
