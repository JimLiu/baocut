import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeItemMapper, claudeToolKind, splitMcpTool, summarizeToolInput } from './claude-items.ts';

const stream = (event: Record<string, unknown>) => ({ type: 'stream_event', event, parent_tool_use_id: null }) as unknown as SDKMessage;
const assistant = (id: string, content: unknown[]) =>
  ({ type: 'assistant', message: { id, role: 'assistant', content }, parent_tool_use_id: null }) as unknown as SDKMessage;
const toolResult = (id: string, content: unknown, isError = false, toolUseResult?: unknown) =>
  ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    parent_tool_use_id: null,
    tool_use_result: toolUseResult,
  }) as unknown as SDKMessage;
/** 会话线程判定工具输出是不是 unified diff 的规则（有 `@@ … @@` 块头，或同时有 `---` 与 `+++` 文件头）。 */
const looksLikeDiff = (text: string) => /^@@ .* @@/m.test(text) || (/^--- \S/m.test(text) && /^\+\+\+ \S/m.test(text));

describe('ClaudeItemMapper', () => {
  it('同一条 API 消息里的多个文字块按先后认领流式时的 id', () => {
    const mapper = new ClaudeItemMapper('turn_1');
    const events = [
      stream({ type: 'message_start', message: { id: 'msg_1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '第一' } }),
      stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' } }),
      stream({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '第二' } }),
      // CLI 每个块结束后发一条 assistant 消息，id 相同。
      assistant('msg_1', [{ type: 'text', text: '第一' }]),
      assistant('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
      assistant('msg_1', [{ type: 'text', text: '第二' }]),
    ].flatMap((m) => mapper.map(m));
    const deltas = events.filter((e) => e.type === 'item.delta');
    const completed = events.filter((e) => e.type === 'item.completed');
    expect(deltas.map((d) => d.itemId)).toEqual(completed.map((c) => c.item.id));
    expect(completed.map((c) => (c.item.kind === 'agent-message' ? c.item.text : ''))).toEqual(['第一', '第二']);
    expect(events.filter((e) => e.type === 'item.started').map((e) => e.item.id)).toEqual(['toolu_1']);
    expect(mapper.openTools().map((t) => t.id)).toEqual(['toolu_1']);
  });

  it('省略了内容的思考不留空条目；没流式过的文字也照样成条', () => {
    const mapper = new ClaudeItemMapper('turn_1');
    expect(mapper.map(assistant('msg_1', [{ type: 'thinking', thinking: '', signature: 's' }]))).toEqual([]);
    expect(mapper.map(assistant('msg_2', [{ type: 'text', text: '直接给全文' }]))).toMatchObject([
      { type: 'item.completed', item: { kind: 'agent-message', text: '直接给全文' } },
    ]);
  });

  it('工具结果：拒绝过的记 declined，中断中出错的记 interrupted；不认识的 tool_use_id 忽略', () => {
    const mapper = new ClaudeItemMapper('turn_1');
    mapper.map(assistant('m', [
      { type: 'tool_use', id: 'a', name: 'Write', input: { file_path: '/w/a' } },
      { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'sleep 9' } },
    ]));
    mapper.declined('a');
    expect(mapper.map(toolResult('a', 'denied', true))).toMatchObject([{ item: { id: 'a', status: 'declined', exitCode: null } }]);
    mapper.interrupting();
    expect(mapper.map(toolResult('b', [{ type: 'text', text: 'Interrupted' }, { type: 'image' }], true))).toMatchObject([
      { item: { id: 'b', status: 'interrupted', exitCode: null, output: 'Interrupted\n[图片]' } },
    ]);
    expect(mapper.map(toolResult('zzz', 'x'))).toEqual([]);
  });

  describe('改文件的工具：成功时 output 是从输入合成的 unified diff', () => {
    const run = (name: string, input: Record<string, unknown>, result: unknown, isError = false, toolUseResult?: unknown) => {
      const mapper = new ClaudeItemMapper('turn_1', Date.now, '/work/video');
      const started = mapper.map(assistant('m', [{ type: 'tool_use', id: 't1', name, input }]));
      const [done] = mapper.map(toolResult('t1', result, isError, toolUseResult));
      if (done?.type !== 'item.completed' || done.item.kind !== 'tool-call') throw new Error('没有完成的工具调用');
      return { started: started[0], item: done.item };
    };

    it('Edit：一个块，旧文本记 -、新文本记 +；路径相对工作目录，detail 不变', () => {
      const { started, item } = run(
        'Edit',
        { file_path: '/work/video/notes/plan.md', old_string: '标题\n旧的一行\n', new_string: '标题\n新的一行\n补一行\n' },
        'The file /work/video/notes/plan.md has been updated successfully.',
      );
      expect(item.output).toBe(
        ['--- a/notes/plan.md', '+++ b/notes/plan.md', '@@ -0,0 +0,0 @@', '-标题', '-旧的一行', '+标题', '+新的一行', '+补一行'].join('\n'),
      );
      expect(looksLikeDiff(item.output!)).toBe(true);
      expect(item).toMatchObject({ tool: 'file-change', status: 'completed', detail: 'Edit /work/video/notes/plan.md' });
      expect(started).toMatchObject({ type: 'item.started', item: { output: null, detail: 'Edit /work/video/notes/plan.md' } });
    });

    it('结构化结果带补丁时按它拼：真实行号与上下文', () => {
      const input = { file_path: '/work/video/notes/plan.md', old_string: '旧的一行', new_string: '新的一行' };
      const structuredPatch = [
        { oldStart: 3, oldLines: 3, newStart: 3, newLines: 4, lines: [' 标题', '-旧的一行', '+新的一行', '+补一行', ' 结尾'] },
      ];
      const { item } = run('Edit', input, 'The file has been updated successfully.', false, { filePath: input.file_path, structuredPatch });
      expect(item.output).toBe(
        ['--- a/notes/plan.md', '+++ b/notes/plan.md', '@@ -3,3 +3,4 @@', ' 标题', '-旧的一行', '+新的一行', '+补一行', ' 结尾'].join('\n'),
      );
      expect(looksLikeDiff(item.output!)).toBe(true);
    });

    it('Write 覆盖带补丁时有完整的 ---/+++ 头', () => {
      const structuredPatch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }];
      const input = { file_path: '/work/video/a.txt', content: 'new\n' };
      const { item } = run('Write', input, 'updated', false, { type: 'update', structuredPatch });
      expect(item.output).toBe(['--- a/a.txt', '+++ b/a.txt', '@@ -1,1 +1,1 @@', '-old', '+new'].join('\n'));
    });

    it('补丁为空、形状不对或指向别的文件时，回退到从输入合成', () => {
      const input = { file_path: '/work/video/a.txt', old_string: 'x', new_string: 'y' };
      const fallback = ['--- a/a.txt', '+++ b/a.txt', '@@ -0,0 +0,0 @@', '-x', '+y'].join('\n');
      const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] };
      for (const result of [
        { structuredPatch: [] },
        { structuredPatch: [{ ...hunk, oldStart: '1' }] },
        { structuredPatch: [{ ...hunk, lines: ['x', '+y'] }] },
        { structuredPatch: 'nope' },
        { filePath: '/work/video/other.txt', structuredPatch: [hunk] },
      ]) {
        expect(run('Edit', input, 'ok', false, result).item.output).toBe(fallback);
      }
    });

    it('Write 新建：旧侧是 /dev/null，全是 + 行', () => {
      const { item } = run(
        'Write',
        { file_path: '/work/video/a.txt', content: 'one\ntwo\n' },
        'File created successfully at: /work/video/a.txt',
      );
      expect(item.output).toBe(['--- /dev/null', '+++ b/a.txt', '@@ -0,0 +1,2 @@', '+one', '+two'].join('\n'));
      expect(looksLikeDiff(item.output!)).toBe(true);
    });

    it('Write 覆盖已有文件：拿不到旧内容，只有 +++ 头与新内容；结构化结果优先于确认文字', () => {
      const input = { file_path: '/elsewhere/b.txt', content: 'x' };
      const { item } = run('Write', input, 'File created successfully at: /elsewhere/b.txt', false, { type: 'update' });
      expect(item.output).toBe(['+++ /elsewhere/b.txt', '@@ -0,0 +1,1 @@', '+x'].join('\n'));
      expect(looksLikeDiff(item.output!)).toBe(true);
    });

    it('MultiEdit：每个 edit 一个块', () => {
      const { item } = run(
        'MultiEdit',
        {
          file_path: '/work/video/c.ts',
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'c', new_string: 'd', replace_all: true },
          ],
        },
        'Applied 2 edits to /work/video/c.ts',
      );
      expect(item.output).toBe(['--- a/c.ts', '+++ b/c.ts', '@@ -0,0 +0,0 @@', '-a', '+b', '@@ -0,0 +0,0 @@', '-c', '+d'].join('\n'));
      expect(item.output!.match(/^@@ /gm)).toHaveLength(2);
    });

    it('没有工作目录时文件头用原路径', () => {
      const mapper = new ClaudeItemMapper('turn_1');
      const input = { file_path: '/w/a', old_string: 'x', new_string: 'y' };
      mapper.map(assistant('m', [{ type: 'tool_use', id: 't1', name: 'Edit', input }]));
      expect(mapper.map(toolResult('t1', 'ok'))).toMatchObject([{ item: { output: '--- /w/a\n+++ /w/a\n@@ -0,0 +0,0 @@\n-x\n+y' } }]);
    });

    it('失败时 output 是错误原文，不是 diff', () => {
      const error = '<tool_use_error>String to replace not found in file.</tool_use_error>';
      const { item } = run('Edit', { file_path: '/work/video/a.txt', old_string: 'nope', new_string: 'x' }, error, true);
      expect(item).toMatchObject({ status: 'failed', output: error });
      expect(looksLikeDiff(item.output!)).toBe(false);
    });
  });

  it('工具种类与简述', () => {
    expect(['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'mcp__x__y', 'WebSearch', 'WebFetch', 'Task', 'Read'].map(claudeToolKind)).toEqual([
      'command', 'file-change', 'file-change', 'file-change', 'mcp', 'web-search', 'web-search', 'other', 'other',
    ]);
    expect(splitMcpTool('mcp__baocut__timeline_apply')).toEqual({ server: 'baocut', tool: 'timeline_apply' });
    expect(splitMcpTool('Bash')).toBeNull();
    expect(summarizeToolInput('Grep', { pattern: 'TODO', path: 'src' })).toBe('TODO · src');
    expect(summarizeToolInput('TodoWrite', {})).toBe('TodoWrite');
    expect(summarizeToolInput('Skill', { skill: 'pdf' })).toBe('Skill pdf');
  });
});
