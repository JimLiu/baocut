import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, HistoryEntry, TimelineItem } from '@baocut/protocol';
import { approvalDecidedLabel, approvalSummary, buildThread, changeUndoState, stepsSummary, toolStep, toolTitle } from './thread.ts';

const at = '2026-10-02T00:00:00.000Z';
const user = (id: string, taskId: string): TimelineItem => ({ kind: 'user-message', id, createdAt: at, taskId, text: '你好' });
const task = (id: string, status: 'running' | 'completed' = 'running'): TimelineItem => ({
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
const agent = (id: string, taskId: string, text = '好的', streaming = false): TimelineItem => ({
  kind: 'agent-message',
  id,
  createdAt: at,
  taskId,
  text,
  streaming,
});
const tool = (id: string, taskId: string, status: 'running' | 'completed' = 'completed'): TimelineItem => ({
  kind: 'tool-call',
  id,
  createdAt: at,
  taskId,
  tool: 'command',
  title: 'ls',
  detail: null,
  output: '',
  status,
  exitCode: null,
  durationMs: null,
});
const reasoning = (id: string, taskId: string, text: string): TimelineItem => ({
  kind: 'reasoning',
  id,
  createdAt: at,
  taskId,
  text,
  streaming: false,
});

describe('buildThread', () => {
  it('把任务状态行放在这个任务的最后一个条目之后', () => {
    const blocks = buildThread([user('u1', 't1'), task('t1', 'completed'), agent('a1', 't1'), user('u2', 't2'), task('t2'), agent('a2', 't2')]);
    expect(blocks.map((b) => `${b.type}:${b.id}`)).toEqual([
      'user:u1',
      'agent:a1',
      'task:task-end/t1',
      'user:u2',
      'agent:a2',
      'task:task-end/t2',
    ]);
  });

  it('进行中的任务刚开始时，状态行紧跟在用户消息后面', () => {
    const blocks = buildThread([user('u1', 't1'), task('t1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'task']);
  });

  it('连续的推理与工具调用合并成一组；空推理与空回复不出现', () => {
    const blocks = buildThread([
      user('u1', 't1'),
      task('t1'),
      reasoning('r0', 't1', '  '),
      reasoning('r1', 't1', '先看看目录'),
      tool('c1', 't1'),
      tool('c2', 't1', 'running'),
      agent('a0', 't1', ''),
      agent('a1', 't1', '目录里只有 README'),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps', 'agent', 'task']);
    const steps = blocks[1]!;
    expect(steps.type === 'steps' && steps.items.map((i) => i.id)).toEqual(['r1', 'c1', 'c2']);
  });

  it('被回复隔开的步骤是两组', () => {
    const blocks = buildThread([user('u1', 't1'), task('t1'), tool('c1', 't1'), agent('a1', 't1'), tool('c2', 't1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps', 'agent', 'steps', 'task']);
  });
});

const change = (id: string, taskId: string, undoOf: string | null = null): TimelineItem => ({
  kind: 'video-change',
  id: `change/${id}`,
  createdAt: at,
  taskId,
  videoId: 'mov_1',
  videoName: '样片',
  target: { projectId: 'proj_1', path: '样片' },
  transactionId: id,
  label: '放入素材',
  previousRevision: '1',
  videoRevision: '2',
  createdIds: [],
  updatedIds: [],
  deletedIds: [],
  durationSeconds: { before: 0, after: 2 },
  undoOf,
});

describe('buildThread：变更卡', () => {
  it('打断步骤组，并标出之后被撤销的那一笔', () => {
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), change('tx1', 't1'), tool('c2', 't1'), change('tx2', 't1', 'tx1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps', 'change', 'steps', 'change']);
    expect(blocks.filter((b) => b.type === 'change').map((b) => (b.type === 'change' ? b.undone : null))).toEqual([true, false]);
  });
});

describe('工具步骤', () => {
  type ToolCall = Extract<TimelineItem, { kind: 'tool-call' }>;
  const step = (tool: ToolCall['tool'], title: string, detail: string | null = null): ToolCall => ({
    kind: 'tool-call',
    id: `${tool}:${title}`,
    createdAt: at,
    taskId: 't',
    tool,
    title,
    detail,
    output: '',
    status: 'completed',
    exitCode: null,
    durationMs: null,
  });
  const cwd = '/work/proj';

  it('类别由工具种类与标题推出，摘要是命令、相对路径或查询词', () => {
    expect(toolStep(step('command', 'npm test'), cwd)).toEqual({ kind: 'command', label: '运行命令', summary: 'npm test' });
    expect(toolStep(step('other', 'Read /work/proj/src/a.ts'), cwd)).toEqual({ kind: 'read', label: '读取文件', summary: 'src/a.ts' });
    expect(toolStep(step('other', 'Grep TODO · src'), cwd)).toEqual({ kind: 'search', label: '搜索', summary: 'TODO · src' });
    expect(toolStep(step('other', 'Glob **/*.md'), cwd).kind).toBe('search');
    expect(toolStep(step('web-search', '字幕规范'), cwd)).toEqual({ kind: 'search', label: '搜索', summary: '字幕规范' });
    // Claude：标题是路径，详情是「<工具名> <路径>」；Codex：详情每行「<类型> <路径>」。
    expect(toolStep(step('file-change', '/work/proj/a.md', 'Edit /work/proj/a.md'), cwd).summary).toBe('a.md');
    expect(toolStep(step('file-change', 'x', 'update /work/proj/a.md\nadd /work/proj/b.md'), cwd)).toEqual({
      kind: 'edit',
      label: '修改文件',
      summary: 'a.md, b.md',
    });
    expect(toolStep(step('other', 'Task 查资料'), cwd)).toEqual({ kind: 'other', label: '其他工具', summary: 'Task 查资料' });
    expect(toolStep(step('mcp', 'baocut.videos_inspect', '{"video":"访谈"}'), cwd)).toEqual({
      kind: 'other',
      label: '读取视频',
      summary: '访谈',
      tool: 'video-read',
    });
    expect(toolStep(step('mcp', 'github.search'), cwd)).toEqual({ kind: 'other', label: '其他工具', summary: 'github.search' });
  });

  it('BaoCut 自己的工具念类别名，摘要只取参数里有的字段', () => {
    const of = (title: string, args: unknown) => {
      const s = toolStep(step('mcp', `baocut.${title}`, JSON.stringify(args)), cwd);
      return [s.label, s.summary, s.tool];
    };
    expect(of('transcribe', { video: 'v', model: 'large-v3' })).toEqual(['转录', 'large-v3', 'transcribe']);
    expect(of('transcribe', { video: 'v' })).toEqual(['转录', '', 'transcribe']);
    expect(of('transcribe', { file: '/m/talk.mp4' })).toEqual(['转录', 'talk.mp4', 'transcribe']);
    expect(of('translate', { video: 'v', to: 'zh-CN' })).toEqual(['翻译', 'zh-CN', 'translate']);
    expect(of('dub', { video: 'v', to: 'en', voice: 'alloy' })).toEqual(['翻译配音', 'en · alloy', 'speech']);
    expect(of('transcode', { files: ['a.mp4', 'b.mp4'], merge: true })).toEqual(['合并文件', '2 个', 'export']);
    expect(of('image', { prompt: 'x', count: 4 })).toEqual(['生成图片', '4 张', 'image']);
    expect(of('export', { video: 'v', kind: 'video', format: 'mp4' })).toEqual(['导出', '成片 · MP4', 'export']);
    expect(of('download', { url: 'https://www.youtube.com/watch?v=1' })).toEqual(['下载视频', 'youtube.com', 'download']);
    expect(of('edits_apply', { video: 'v', operations: [{ type: 'putDocument', kind: 'translation', language: 'en' }] })).toEqual([
      '翻译',
      'en',
      'translate',
    ]);
    expect(
      of('edits_apply', {
        video: 'v',
        operations: [{ type: 'removeRange' }, { type: 'addCuts', cuts: [{}, {}] }],
      }),
    ).toEqual(['剪辑', '3 处', 'cut']);
    expect(of('edits_apply', { video: 'v', label: '调字幕样式', operations: [{ type: 'setStyle' }] })).toEqual([
      '修改视频',
      '调字幕样式',
      'edit-video',
    ]);
    // 参数不是 JSON：只给类别名。
    expect(toolStep(step('mcp', 'baocut.videos_create', 'oops'), cwd)).toMatchObject({ label: '新建视频', summary: '' });
    // 不认得的 BaoCut 工具照原来的写法。
    expect(toolStep(step('mcp', 'baocut.something_new'), cwd)).toEqual({
      kind: 'other',
      label: '其他工具',
      summary: 'baocut.something_new',
    });
  });

  it('新建视频的记录不占块，也不打断步骤组', () => {
    const created: TimelineItem = {
      kind: 'video-created',
      id: 'created/mov_1',
      createdAt: at,
      taskId: 't1',
      videoId: 'mov_1',
      videoName: '样片',
      target: { projectId: 'p', path: '样片' },
      videoRevision: '1',
    };
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), created, tool('c2', 't1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps']);
  });

  it('组头按种类首次出现的顺序归纳，文件按去重后的路径计数', () => {
    const items = [
      step('other', 'Read /work/proj/a.ts'),
      step('command', 'ls'),
      step('other', 'Read /work/proj/b.ts'),
      step('other', 'Read /work/proj/a.ts'),
      step('file-change', '/work/proj/a.ts', 'Edit /work/proj/a.ts'),
      step('command', 'npm test'),
    ];
    expect(stepsSummary(items, cwd)).toBe('读取了 2 个文件、运行了命令、修改了 1 个文件');
    expect(stepsSummary([reasoning('r', 't', '想想')] as never)).toBe('思考');
    expect(stepsSummary([tool('c1', 't'), reasoning('r', 't', '想想')] as never)).toBe('运行了命令');
  });
});

describe('视频工具', () => {
  const call = (title: string, detail: string | null): Extract<TimelineItem, { kind: 'tool-call' }> => ({
    kind: 'tool-call',
    id: title,
    createdAt: at,
    taskId: 't',
    tool: 'mcp',
    title,
    detail,
    output: '',
    status: 'completed',
    exitCode: null,
    durationMs: null,
  });

  it('步骤名写成中文动作，修改带上说明', () => {
    expect(toolTitle(call('baocut.edits_apply', JSON.stringify({ label: '放入素材', operations: [] })))).toBe('修改视频：放入素材');
    expect(toolTitle(call('baocut.videos_inspect', '{"video":"样片"}'))).toBe('读取视频');
    expect(toolTitle(call('baocut.edits_apply', 'not json'))).toBe('修改视频');
    expect(toolTitle(call('other.tool', null))).toBe('other.tool');
  });

  it('摘要单独计视频修改', () => {
    const items = [call('baocut.videos_inspect', null), call('baocut.edits_apply', null), call('baocut.edits_undo', null)];
    expect(stepsSummary(items)).toBe('调用了工具、提交了 2 笔视频修改');
  });
});

describe('审批卡', () => {
  type Approval = Extract<TimelineItem, { kind: 'approval' }>;
  const approval = (patch: Partial<Approval> = {}, request: ApprovalRequest = command): Approval => ({
    kind: 'approval',
    id: 'approval/a1',
    createdAt: at,
    taskId: 't1',
    approvalId: 'a1',
    request,
    status: 'accepted',
    decidedAt: at,
    decidedBy: 'user',
    ...patch,
  });
  const command: ApprovalRequest = { kind: 'command', command: 'npm test -- --run', cwd: null, reason: '跑测试', rule: 'npm test' };

  it('标题写「Agent 想要…」，文件改动显示短路径、复制全路径', () => {
    expect(approvalSummary(command)).toEqual({ title: 'Agent 想要运行命令', kind: '运行命令', subject: 'npm test -- --run', copyText: 'npm test -- --run' });
    const files = approvalSummary({ kind: 'file-change', reason: null, files: ['/a/b/c/d/e.ts', 'x.ts'], rule: null });
    expect(files.title).toBe('Agent 想要修改文件');
    expect(files.copyText).toBe('/a/b/c/d/e.ts\nx.ts');
    const risky: ApprovalRequest = { kind: 'tool', tool: 'X', server: 'baocut', reason: '删库', files: ['/a/b/c/d/e.mp4'], rule: null };
    expect(approvalSummary(risky, 'high').title).toBe('Agent 想要做一个高风险的操作');
    expect(approvalSummary(risky).title).toBe('Agent 想要使用工具');
    expect(approvalSummary(risky).copyText).toBe('X\n/a/b/c/d/e.mp4');
  });

  it('决定过的一行：用户点的、总是允许、规则、访问模式、拒绝、停止', () => {
    expect(approvalDecidedLabel(approval(), 'accept')).toBe('已允许');
    expect(approvalDecidedLabel(approval(), 'accept-always')).toBe('已允许 · 之后 npm test 不再问');
    // 时间线记着点的答案，重新加载之后也认得；早先的记录没有，退回「已允许」。
    expect(approvalDecidedLabel(approval({ decision: 'accept-always' }), undefined)).toBe('已允许 · 之后 npm test 不再问');
    expect(approvalDecidedLabel(approval({ decision: 'accept' }), undefined)).toBe('已允许');
    expect(approvalDecidedLabel(approval(), undefined)).toBe('已允许');
    expect(approvalDecidedLabel(approval({}, { ...command, rule: null }), 'accept-always')).toBe('已允许');
    expect(approvalDecidedLabel(approval({ decidedBy: 'rule' }), undefined)).toBe('自动允许 · 规则 npm test');
    expect(approvalDecidedLabel(approval({ decidedBy: 'auto' }), undefined)).toBe('自动允许 · 访问模式');
    expect(approvalDecidedLabel(approval({ status: 'declined' }), 'decline')).toBe('已拒绝');
    expect(approvalDecidedLabel(approval({ status: 'cancelled', decidedBy: undefined }), undefined)).toBe('已停止');
  });
});

describe('changeUndoState', () => {
  const entry = (transactionId: string, undoDepth: number, undoneBy?: string): HistoryEntry => ({
    transactionId,
    commandId: `cmd-${transactionId}`,
    label: transactionId,
    actor: { kind: 'user', id: 'user_local' } as HistoryEntry['actor'],
    videoRevision: '1',
    committedAt: at,
    undoDepth,
    undoAvailable: true,
    ...(undoneBy ? { undoneBy } : {}),
  });
  const base = { transactionId: 'X', undoneInThread: false, local: null, history: null, redo: null };

  it('有历史：被撤销奇数次是已撤销；撤销那一笔正是重做栈顶才给恢复', () => {
    const undone = [entry('X', 0, 'U'), entry('U', 1)];
    expect(changeUndoState({ ...base, history: undone })).toEqual({ state: 'undone', restore: null });
    expect(changeUndoState({ ...base, history: undone, redo: 'U' })).toEqual({ state: 'undone', restore: 'U' });
    expect(changeUndoState({ ...base, history: undone, redo: 'other' })).toEqual({ state: 'undone', restore: null });
    // 撤销之后又恢复了：生效中。
    expect(changeUndoState({ ...base, history: [entry('X', 0, 'U'), entry('U', 1, 'R'), entry('R', 2)] })).toEqual({ state: 'applied' });
    expect(changeUndoState({ ...base, history: [entry('X', 0)], undoneInThread: true })).toEqual({ state: 'applied' });
  });

  it('历史还没包含本窗口刚做的动作时按本窗口的动作；没有历史时再按会话里记下的撤销', () => {
    const stale = [entry('X', 0)];
    expect(changeUndoState({ ...base, history: stale, local: { kind: 'undo', transactionId: 'U' }, redo: 'U' })).toEqual({
      state: 'undone',
      restore: 'U',
    });
    expect(changeUndoState({ ...base, local: { kind: 'undo', transactionId: 'U' } })).toEqual({ state: 'undone', restore: null });
    expect(changeUndoState({ ...base, local: { kind: 'restore', transactionId: 'R' } })).toEqual({ state: 'applied' });
    expect(changeUndoState({ ...base, undoneInThread: true })).toEqual({ state: 'undone', restore: null });
    expect(changeUndoState(base)).toEqual({ state: 'applied' });
    // 历史窗口里没有这一笔（太早了）：同样退回。
    expect(changeUndoState({ ...base, history: [entry('Y', 0)], undoneInThread: true })).toEqual({ state: 'undone', restore: null });
  });
});
