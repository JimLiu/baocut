import { describe, expect, it } from 'vitest';
import type { AgentQuestion, ApprovalRequest, HistoryEntry, TimelineItem } from '@baocut/protocol';
import {
  OTHER_OPTION,
  approvalDecidedLabel,
  approvalSummary,
  buildThread,
  changeUndoState,
  questionAnswerText,
  questionDecidedLabel,
  questionDraftAnswers,
  stepsSummary,
  toolStep,
  toolTitle,
} from './thread.ts';

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
  it('回执与步骤收进同一组，并标出之后被撤销的那一笔', () => {
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), change('tx1', 't1'), tool('c2', 't1'), change('tx2', 't1', 'tx1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps']);
    const steps = blocks[1]!;
    expect(steps.type === 'steps' && steps.items.map((i) => i.id)).toEqual(['c1', 'change/tx1', 'c2', 'change/tx2']);
    expect(steps.type === 'steps' && [...steps.undone]).toEqual(['tx1']);
  });

  it('没有步骤时回执自己成一组，被回复隔开的回执各成一组', () => {
    const blocks = buildThread([user('u1', 't1'), change('tx1', 't1'), agent('a1', 't1'), change('tx2', 't1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps', 'agent', 'steps']);
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
    expect(of('slides_check', { path: 'decks/talk/' })).toEqual(['检查幻灯片', 'talk', 'slides']);
    expect(of('slides_import_asset', { deck: 'talk', path: 'images/cover.png' })).toEqual(['导入幻灯片素材', 'cover.png', 'slides']);
    expect(of('design_check', { path: 'designs/landing' })).toEqual(['检查设计稿', 'landing', 'design']);
    expect(of('design_import_asset', { canvas: 'designs/landing', path: 'images/hero.png' })).toEqual(['导入设计稿素材', 'hero.png', 'design']);
    expect(of('design_system_check', { path: 'systems/brand/' })).toEqual(['检查设计系统', 'brand', 'design-system']);
    expect(of('design_system_import_asset', { system: 'systems/brand', path: 'assets/logo.svg', group: 'Logos' })).toEqual([
      '导入设计系统素材',
      'logo.svg · Logos',
      'design-system',
    ]);
    expect(of('design_system_import_asset', { system: 'systems/brand', path: 'fonts/Inter.woff2' })).toEqual([
      '导入设计系统素材',
      'Inter.woff2',
      'design-system',
    ]);
    // 协作文档：新建文档（docs_batch 带 container.create）写新文档的名字，其余写文档目录名；评论与正文分开念。
    expect(of('docs_batch', { doc: 'docs/plan', container: { kind: 'project', create: { name: '发布计划' } }, batch: [] })).toEqual([
      '新建协作文档',
      '发布计划',
      'docs',
    ]);
    expect(of('docs_batch', { doc: 'docs/plan/', container: { kind: 'project', id: 'd1' }, batch: [] })).toEqual(['编辑协作文档', 'plan', 'docs']);
    expect(of('docs_create', { doc: 'docs/plan', object: 'utterance', payload: {} })).toEqual(['在协作文档里评论', 'plan', 'docs']);
    expect(of('docs_create', { doc: 'docs/plan', object: 'file', payload: {} })).toEqual(['添加到协作文档', 'plan', 'docs']);
    expect(of('docs_read', { doc: 'docs/plan' })).toEqual(['读取协作文档', 'plan', 'docs']);
    expect(of('docs_update', { doc: 'docs/plan', ref: { object: 'node', id: 'n1' }, payload: {} })).toEqual(['编辑协作文档', 'plan', 'docs']);
    expect(of('docs_query', { doc: 'docs/plan', object: 'utterance', payload: {} })).toEqual(['读取协作文档评论', 'plan', 'docs']);
    expect(of('docs_delete', { doc: 'docs/plan', ref: { object: 'utterance', id: 'u1' } })).toEqual(['从协作文档删除', 'plan', 'docs']);
    expect(of('docs_upload', { doc: 'docs/plan', path: 'images/chart.png' })).toEqual(['上传到协作文档', 'plan · chart.png', 'docs']);
    expect(of('docs_export', { doc: 'docs/plan', to: 'out/plan.md' })).toEqual(['导出协作文档', 'plan · plan.md', 'docs']);
    expect(of('docs_export', { doc: 'docs/plan' })).toEqual(['导出协作文档', 'plan', 'docs']);
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

  it('幻灯片的记录同样不占块，也不打断步骤组', () => {
    const created: TimelineItem = {
      kind: 'slides-created',
      id: 'slides_1',
      createdAt: at,
      taskId: 't1',
      target: { conversationId: 'c', path: 'talk' },
      title: '季度回顾',
      slideCount: 3,
    };
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), created, tool('c2', 't1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps']);
  });

  it('设计稿的记录同样不占块，也不打断步骤组', () => {
    const created: TimelineItem = {
      kind: 'design-created',
      id: 'design_1',
      createdAt: at,
      taskId: 't1',
      target: { conversationId: 'c', path: 'designs/landing' },
      title: '课程落地页',
      boardCount: 3,
    };
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), created, tool('c2', 't1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps']);
  });

  it('设计系统的记录同样不占块，也不打断步骤组', () => {
    const created: TimelineItem = {
      kind: 'design-system-created',
      id: 'system_1',
      createdAt: at,
      taskId: 't1',
      target: { conversationId: 'c', path: 'systems/brand' },
      title: '品牌设计系统',
    };
    const blocks = buildThread([user('u1', 't1'), tool('c1', 't1'), created, tool('c2', 't1')]);
    expect(blocks.map((b) => b.type)).toEqual(['user', 'steps']);
  });

  it('协作文档的记录同样不占块，也不打断步骤组', () => {
    const created: TimelineItem = {
      kind: 'docs-created',
      id: 'docs_1',
      createdAt: at,
      taskId: 't1',
      target: { conversationId: 'c', path: 'docs/plan' },
      title: '发布计划',
      tabCount: 2,
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

  it('摘要按回执计视频修改的笔数：修改工具的调用本身算调用了工具', () => {
    const items = [
      call('baocut.videos_inspect', null),
      call('baocut.edits_apply', null),
      change('tx1', 't'),
      call('baocut.edits_undo', null),
      change('tx2', 't', 'tx1'),
    ] as Parameters<typeof stepsSummary>[0];
    expect(stepsSummary(items)).toBe('调用了工具、提交了 2 笔视频修改');
    expect(stepsSummary([call('baocut.edits_apply', null)])).toBe('调用了工具');
    expect(stepsSummary([change('tx1', 't')] as Parameters<typeof stepsSummary>[0])).toBe('提交了 1 笔视频修改');
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

  const questions: AgentQuestion[] = [
    {
      id: 'q1',
      header: 'Ratio',
      question: 'Which ratio?',
      options: [
        { label: '16:9', description: null },
        { label: '9:16', description: null },
      ],
      multiSelect: false,
      allowOther: true,
    },
    { id: 'q2', header: 'Tracks', question: 'Which tracks?', options: [{ label: 'Voice', description: null }], multiSelect: true, allowOther: false },
  ];
  const question: ApprovalRequest = { kind: 'question', questions, reason: null, rule: null };

  it('提问：标题按题数，摘要是题目；收起的一行分已回答、跳过、用消息回答、停止', () => {
    expect(approvalSummary(question)).toMatchObject({ title: 'Agent 有 2 个问题要问你', kind: '提问', subject: 'Which ratio?\nWhich tracks?' });
    expect(approvalSummary({ ...question, questions: questions.slice(0, 1) }).title).toBe('Agent 有个问题要问你');
    expect(questionDecidedLabel(approval({}, question))).toBe('已回答');
    expect(questionDecidedLabel(approval({ status: 'declined' }, question))).toBe('已跳过');
    expect(questionDecidedLabel(approval({ status: 'declined', answeredByMessage: true }, question))).toBe('已用消息回答');
    expect(questionDecidedLabel(approval({ status: 'cancelled' }, question))).toBe('已停止');
    expect(questionAnswerText({ q2: ['Voice', 'Music'] }, 'q2')).toBe('Voice和Music');
    expect(questionAnswerText(undefined, 'q1')).toBe('没有回答');
  });

  it('提问草稿：每题都答了才有答案；「其他」要写了字才算；单选只取一个', () => {
    expect(questionDraftAnswers(questions, { picked: { q1: ['16:9'] }, other: {} })).toBeNull();
    expect(questionDraftAnswers(questions, { picked: { q1: [OTHER_OPTION], q2: ['Voice'] }, other: { q1: '  ' } })).toBeNull();
    expect(questionDraftAnswers(questions, { picked: { q1: [OTHER_OPTION], q2: ['Voice'] }, other: { q1: ' 4:3 ' } })).toEqual({ q1: ['4:3'], q2: ['Voice'] });
    expect(questionDraftAnswers(questions, { picked: { q1: ['9:16', '16:9'], q2: ['Voice'] }, other: {} })).toEqual({ q1: ['9:16'], q2: ['Voice'] });
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
