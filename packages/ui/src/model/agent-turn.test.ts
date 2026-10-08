import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@baocut/protocol';
import {
  clockLabel,
  diffLines,
  elapsedLabel,
  footerLabel,
  gapBetween,
  looksLikeDiff,
  nextToolStatus,
  parsePathToken,
  pathTip,
  rowKind,
  showFooter,
  stepError,
  stepMeta,
  turns,
} from './agent-turn.ts';
import { buildThread } from './thread.ts';

const at = '2026-10-02T00:00:00.000Z';
const user = (id: string, taskId: string, text = '你好'): TimelineItem => ({ kind: 'user-message', id, createdAt: at, taskId, text });
const agent = (id: string, taskId: string, text: string): TimelineItem => ({
  kind: 'agent-message',
  id,
  createdAt: at,
  taskId,
  text,
  streaming: false,
});
const task = (id: string, status: 'running' | 'completed' | 'failed' = 'completed'): TimelineItem => ({
  kind: 'task',
  id,
  createdAt: at,
  taskId: id,
  goal: '你好',
  status,
  startedAt: at,
  endedAt: status === 'running' ? null : at,
  error: null,
});
const tool = (id: string, taskId: string): TimelineItem => ({
  kind: 'tool-call',
  id,
  createdAt: at,
  taskId,
  tool: 'command',
  title: 'ls',
  detail: null,
  output: '',
  status: 'completed',
  exitCode: null,
  durationMs: null,
});
const approval = (id: string, taskId: string): TimelineItem =>
  ({
    kind: 'approval',
    id,
    createdAt: at,
    taskId,
    approvalId: id,
    request: { kind: 'command', command: 'rm x', cwd: null, reason: null },
    status: 'pending',
    decidedAt: null,
  }) as unknown as TimelineItem;

describe('gapBetween', () => {
  it('相邻种类定间距', () => {
    expect(gapBetween('user', 'user')).toBe(4);
    expect(gapBetween('user', 'assistant')).toBe(0);
    expect(gapBetween('tool', 'tool')).toBe(0);
    expect(gapBetween('user', 'tool')).toBe(16);
    expect(gapBetween('assistant', 'tool')).toBe(4);
    expect(gapBetween('tool', 'assistant')).toBe(4);
    expect(gapBetween('block', 'block')).toBe(12);
    expect(gapBetween('assistant', 'approval')).toBe(16);
    expect(gapBetween('footer', 'user')).toBe(16);
    expect(gapBetween('approval', 'footer')).toBe(4);
    expect(gapBetween('user', 'footer')).toBe(4);
    expect(gapBetween(null, 'user')).toBe(0);
  });

  it('线程块的行种类', () => {
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), agent('a1', 't1', '好'), task('t1')]);
    expect(blocks.map(rowKind)).toEqual(['user', 'tool', 'assistant', 'footer']);
  });
});

describe('turns', () => {
  it('按用户消息切回合，正文用空行连接、不含工具；任务状态行只记成这一轮的任务', () => {
    const blocks = buildThread([
      user('u1', 't1'),
      task('t1'),
      agent('a1', 't1', '第一段'),
      tool('c1', 't1'),
      agent('a2', 't1', '第二段\n'),
      user('u2', 't2'),
      user('u3', 't3'),
      task('t3', 'running'),
      approval('p1', 't3'),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'agent', 'steps', 'agent', 'task', 'user', 'user', 'approval', 'task']);
    const t = turns(blocks);
    expect(t.map((x) => [x.start, x.end, x.replied])).toEqual([
      [0, 3, true],
      [5, 5, false],
      [6, 7, true],
    ]);
    expect(t[0]!.text).toBe('第一段\n\n第二段');
    expect(t[0]!.task?.id).toBe('t1');
    expect(t[1]!.task).toBeNull();
    expect(t[2]!.waiting).toBe(true);
    expect(t[2]!.text).toBe('');
    expect(turns([])).toEqual([]);
  });

  it('只有用户消息、没有回复的回合不显示页脚；进行中、停止与失败照常显示', () => {
    const [done, bare] = turns(buildThread([user('u1', 't1'), agent('a1', 't1', '好'), task('t1'), user('u2', 't2')]));
    expect(showFooter(done!, false)).toBe(true);
    expect(showFooter(bare!, false)).toBe(false);
    expect(showFooter(bare!, true)).toBe(true);
    const [failed] = turns(buildThread([user('u1', 't1'), task('t1', 'failed')]));
    expect(showFooter(failed!, false)).toBe(true);
  });
});

describe('页脚文案', () => {
  it('时长与结束时刻', () => {
    expect(elapsedLabel(42000)).toBe('0:42');
    expect(elapsedLabel(63000)).toBe('1:03');
    expect(elapsedLabel(3725000)).toBe('1:02:05');
    expect(elapsedLabel(-5)).toBe('0:00');
    expect(clockLabel(new Date(2026, 9, 5, 14, 32, 10).getTime())).toBe('14:32');
    expect(clockLabel(new Date(2026, 9, 5, 9, 5).getTime())).toBe('09:05');
  });

  it('进行中、等允许、完成、停止与失败', () => {
    expect(footerLabel({ status: 'running', startedAt: 1000, now: 43000 })).toBe('正在工作 · 0:42');
    expect(footerLabel({ status: null, now: 0 })).toBe('正在工作');
    expect(footerLabel({ status: 'running', waiting: true, startedAt: 1000, now: 61000 })).toBe('等你允许 · 1:00');
    expect(footerLabel({ status: 'stopping', startedAt: 0, now: 5000 })).toBe('正在停止 · 0:05');
    expect(footerLabel({ status: 'completed', startedAt: 1, endedAt: 63001, now: 99999 })).toBe('已工作 1:03');
    expect(footerLabel({ status: 'stopped', startedAt: 0, endedAt: 9000, now: 0 })).toBe('已停止 · 工作了 0:09');
    expect(footerLabel({ status: 'failed', startedAt: 0, endedAt: 9000, now: 0, error: '登录过期' })).toBe('失败 · 登录过期');
    expect(footerLabel({ status: 'failed', now: 0 })).toBe('失败 · 原因未知');
  });
});

describe('diffLines / looksLikeDiff', () => {
  it('按行归类，文件头不算增删', () => {
    const diff = '--- a/分镜.md\n+++ b/分镜.md\n@@ -1,2 +1,2 @@\n 标题\n-旧的一行\n+新的一行\n';
    expect(looksLikeDiff(diff)).toBe(true);
    expect(looksLikeDiff('duration 206s · 3 speakers')).toBe(false);
    expect(looksLikeDiff('- 列表项\n- 第二项')).toBe(false);
    expect(diffLines(diff).map((l) => l.type)).toEqual(['meta', 'meta', 'hunk', 'ctx', 'del', 'add']);
  });
});

describe('步骤行的元数据', () => {
  const call = (patch: Partial<Extract<TimelineItem, { kind: 'tool-call' }>>) => ({
    ...(tool('c', 't') as Extract<TimelineItem, { kind: 'tool-call' }>),
    ...patch,
  });

  it('非零退出码与耗时；拒绝与中断写在前面', () => {
    expect(stepMeta(call({ exitCode: 1, durationMs: 400 }), 'failed')).toEqual([{ text: '退出码 1', code: true }, { text: '0.4s' }]);
    expect(stepMeta(call({ exitCode: 0, durationMs: 12_300 }), 'completed')).toEqual([{ text: '12s' }]);
    expect(stepMeta(call({ durationMs: 63_000 }), 'completed')).toEqual([{ text: '1:03' }]);
    expect(stepMeta(call({}), 'interrupted')).toEqual([{ text: '已中断' }]);
    expect(stepMeta(call({}), 'completed')).toEqual([]);
  });

  it('错误一段的文字', () => {
    expect(stepError(call({ exitCode: 2 }), 'failed')).toBe('命令以退出码 2 结束');
    expect(stepError(call({}), 'failed')).toBe('这一步没有完成');
    expect(stepError(call({}), 'declined')).toBe('这一步被拒绝了');
  });
});

describe('nextToolStatus', () => {
  it('失败之后不再被改回', () => {
    expect(nextToolStatus('failed', 'completed')).toBe('failed');
    expect(nextToolStatus('running', 'completed')).toBe('completed');
    expect(nextToolStatus(null, 'running')).toBe('running');
  });
});

describe('parsePathToken', () => {
  it('前缀路径与多段路径', () => {
    expect(parsePathToken('./transcript.json')).toEqual({ path: './transcript.json', line: null, lineEnd: null, col: null });
    expect(parsePathToken('~/BaoCut/访谈/分镜.md')?.path).toBe('~/BaoCut/访谈/分镜.md');
    expect(parsePathToken('../a')?.path).toBe('../a');
    expect(parsePathToken('/tmp/x')?.path).toBe('/tmp/x');
    expect(parsePathToken('ai/reviews/cleanup.json')?.path).toBe('ai/reviews/cleanup.json');
    expect(parsePathToken('subs/en.SRT')?.path).toBe('subs/en.SRT');
    for (const extension of ['pdf', 'html', 'csv', 'tsv', 'json']) {
      const file = `out/report.${extension}`;
      expect(parsePathToken(file)?.path).toBe(file);
    }
  });

  it('行号后缀与 tooltip', () => {
    expect(parsePathToken('src/app.ts:12')).toEqual({ path: 'src/app.ts', line: 12, lineEnd: null, col: null });
    expect(parsePathToken('src/app.ts:12-20')).toEqual({ path: 'src/app.ts', line: 12, lineEnd: 20, col: null });
    expect(parsePathToken('./a.rs:12:5')).toEqual({ path: './a.rs', line: 12, lineEnd: null, col: 5 });
    expect(pathTip(parsePathToken('src/app.ts:12-20')!)).toBe('src/app.ts · 第 12–20 行');
    expect(pathTip(parsePathToken('./a.rs:12:5')!)).toBe('a.rs · 第 12 行第 5 列');
    expect(pathTip(parsePathToken('./a.rs:3')!)).toBe('a.rs · 第 3 行');
    expect(pathTip(parsePathToken('/work/proj/src/a.ts')!, '/work/proj')).toBe('src/a.ts');
    expect(pathTip(parsePathToken('/other/a.ts')!, '/work/proj')).toBe('/other/a.ts');
  });

  it('不像路径的不算', () => {
    for (const s of [
      'transcript.json',
      'bcut auto <文件>',
      'a/b.exe',
      'example.com/a.ts',
      'https://x.test/a.md',
      'a/b.md?x=1',
      '/',
      '//cdn/a.js',
      'render',
      '',
      'x/y',
      'a//b.ts',
    ])
      expect(parsePathToken(s), s).toBeNull();
  });
});
