import { describe, expect, it } from 'vitest';
import { job, task } from '../testing/task-records.ts';
import { agentRow, clip, jobPercent, jobRow, runsOnLabel, taskGroups, taskRows, type TaskContext } from './task-list.ts';

const ctx: TaskContext = {
  projects: [{ id: 'p1', name: '产品发布会' }],
  conversations: [
    { id: 'c1', projectId: 'p1', activity: 'idle' },
    { id: 'c2', projectId: 'p1', activity: 'awaiting-approval' },
  ],
  video: { videoId: 'v1', name: '主视频', projectId: 'p1', assets: { a1: { name: 'interview.mp4' } } },
};

describe('jobPercent', () => {
  it('总量已知时按 done/total 向下取整，夹在 0–100', () => {
    expect(jobPercent({ progress: { done: 45, total: 100, unit: 'seconds' } })).toBe(45);
    expect(jobPercent({ progress: { done: 99.9, total: 100, unit: 'seconds' } })).toBe(99);
    expect(jobPercent({ progress: { done: 120, total: 100, unit: 'seconds' } })).toBe(100);
  });
  it('总量未知、为 0 或没有进度时为 null（不伪造百分比）', () => {
    expect(jobPercent({ progress: { done: 3, total: null, unit: 'segments' } })).toBeNull();
    expect(jobPercent({ progress: { done: 0, total: 0, unit: 'outputs' } })).toBeNull();
    expect(jobPercent({ progress: null })).toBeNull();
  });
});

describe('runsOnLabel', () => {
  it('本机、远端节点、本机的智能体、云端', () => {
    expect(runsOnLabel('local')).toBe('本机');
    expect(runsOnLabel('node:studio')).toBe('远端节点');
    expect(runsOnLabel('agent:codex')).toBe('本机 · Codex');
    expect(runsOnLabel('openai')).toBe('云端');
    expect(runsOnLabel('custom:my-gateway')).toBe('云端');
  });
});

describe('clip', () => {
  it('按码点截断并补省略号', () => {
    expect(clip('  一只橘猫  ', 40)).toBe('一只橘猫');
    expect(clip('一二三四五', 3)).toBe('一二三…');
  });
});

describe('jobRow', () => {
  it('在跑的转录：阶段 · 百分比、确定进度、取消动作；打开的视频给出标题', () => {
    const row = jobRow(job({ jobId: 'j1', progress: { done: 45, total: 100, unit: 'seconds' } }), ctx);
    expect(row).toMatchObject({
      kind: 'transcribe',
      title: '转录 · 主视频 · interview.mp4',
      where: 'whisper-large-v3 · 本机',
      label: '识别中 · 45%',
      tone: 'accent',
      phase: '识别中',
      pct: 45,
      progress: 45,
      live: true,
      action: { type: 'cancel', jobId: 'j1' },
      chip: 'cli',
      projectId: 'p1',
    });
  });

  it('总量未知时只念阶段，进度条转圈', () => {
    const row = jobRow(job({ jobId: 'j1', phase: 'loading', progress: { done: 0, total: null, unit: 'seconds' } }), ctx);
    expect(row.label).toBe('加载模型');
    expect(row.progress).toBe('indet');
  });

  it('排队：念「排队中」、转圈、可取消；开始时间用提交时间', () => {
    const row = jobRow(job({ jobId: 'j2', state: 'queued', phase: 'queued', startedAt: null, createdAt: '2026-10-01T08:00:00Z' }), ctx);
    expect(row).toMatchObject({ label: '排队中', tone: 'info', queued: true, progress: 'indet', startedAt: '2026-10-01T08:00:00Z' });
    expect(row.action).toEqual({ type: 'cancel', jobId: 'j2' });
  });

  it('排队在等资源：详情那一行写 Runtime 记着的原因', () => {
    const wait = { reason: 'resources' as const, dimensions: ['memory' as const], detail: '等待资源：内存不够', since: '2026-10-01T08:00:00Z' };
    expect(jobRow(job({ jobId: 'j3', state: 'queued', phase: 'queued', startedAt: null, wait }), ctx).phase).toBe('等待资源：内存不够');
    expect(jobRow(job({ jobId: 'j4', state: 'queued', phase: 'queued', startedAt: null }), ctx).phase).toBeNull();
  });

  it('结束了的：已完成 / 失败 / 已取消 / 已中断，不再有动作与进度条', () => {
    const states = ['completed', 'failed', 'cancelled', 'interrupted'] as const;
    const rows = states.map((state) => jobRow(job({ jobId: state, state, phase: 'done', endedAt: '2026-10-01T09:10:00Z' }), ctx));
    expect(rows.map((r) => [r.label, r.tone])).toEqual([
      ['已完成', 'positive'],
      ['失败', 'negative'],
      ['已取消', 'neutral'],
      ['已中断', 'neutral'],
    ]);
    expect(rows.every((r) => r.action === null && r.progress === null && !r.live)).toBe(true);
  });

  it('崩溃后正在自动重跑的（interrupted、没有 endedAt）仍在进行：可以取消、不确定进度', () => {
    const row = jobRow(job({ jobId: 'r', state: 'interrupted', phase: 'transcribing', endedAt: null }), ctx);
    expect(row).toMatchObject({ label: '出错后自动重试', tone: 'accent', live: true, progress: 'indet' });
    expect(row.action).toEqual({ type: 'cancel', jobId: 'r' });
  });

  it('来源 chip：智能体 →「Agent」并指回会话；连接 →「命令行」；system 与 node 不显示', () => {
    const agent = jobRow(job({ jobId: 'j', submitter: { kind: 'agent', id: 'c2', taskId: 't9' }, videoId: null }), ctx);
    expect(agent).toMatchObject({ chip: 'agent', conversationId: 'c2', projectId: 'p1' });
    expect(jobRow(job({ jobId: 'j', submitter: { kind: 'connection', id: 'x' } }), ctx).chip).toBe('cli');
    expect(jobRow(job({ jobId: 'j', submitter: { kind: 'system', id: 'runtime' } }), ctx).chip).toBeNull();
    expect(jobRow(job({ jobId: 'j', submitter: { kind: 'node', id: 'peer' } }), ctx).chip).toBeNull();
  });

  it('生成任务的标题取提示词或原文的前 40 个字；不在打开的视频里的转录只念种类', () => {
    const prompt = '一只橘猫趴在老城区的窗台上晒太阳，窗外是层层叠叠的灰瓦屋顶，水彩风格，暖色调，笔触松弛，留白多一些';
    const image = jobRow(
      job({
        jobId: 'g',
        kind: 'generateImage',
        generation: { capability: 'generateImage', prompt, size: null, aspectRatio: '1:1', count: 1, format: 'png', seed: null },
      }),
      ctx,
    );
    expect(image.title).toBe(`${Array.from(prompt).slice(0, 40).join('')}…`);
    const speech = jobRow(
      job({
        jobId: 's',
        kind: 'synthesizeSpeech',
        generation: { capability: 'synthesizeSpeech', text: '大家好', voice: 'alloy', language: 'zh', format: 'mp3', instructions: null, speed: null, seed: null },
      }),
      ctx,
    );
    expect(speech.title).toBe('大家好');
    expect(jobRow(job({ jobId: 't', videoId: 'other' }), ctx).title).toBe('转录');
  });

  it('导出：标题念种类与格式加视频名，位置是导出目录，阶段按种类说', () => {
    const row = jobRow(
      job({
        jobId: 'x1',
        kind: 'export',
        phase: 'generating',
        modelId: 'export:video',
        progress: { done: 1200, total: 3600, unit: 'frames' },
        export: {
          settings: { kind: 'video', format: 'mp4' },
          snapshotArtifactId: 'snap',
          videoRevision: '3',
          sequenceId: 'seq',
          destination: { dir: '/Users/me/Movies/发布会/exports', files: ['主视频.mp4'], overwrite: false },
        },
      }),
      ctx,
    );
    expect(row).toMatchObject({
      kind: 'export',
      title: '导出视频 · MP4 · 主视频',
      where: '~/Movies/发布会/exports · 本机',
      phase: '编码中',
      label: '编码中 · 33%',
    });
  });

  it('从链接导入：标题写解析出的视频标题，还没解析时写网站', () => {
    const pipeline = {
      name: 'link-import',
      params: { url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com' },
      steps: [],
      current: 0,
      stoppedAt: null,
      summary: null,
    };
    const early = job({ jobId: 'j9', kind: 'pipeline', videoId: null, assetId: null, pipeline });
    expect(jobRow(early, ctx).title).toBe('从链接导入 · youtube.com');
    const summary = { title: '访谈第一集', files: { media: '/m.mp4', subtitles: [] } };
    const done = job({ jobId: 'j9', kind: 'pipeline', videoId: null, assetId: null, pipeline: { ...pipeline, summary } });
    expect(jobRow(done, ctx).title).toBe('从链接导入 · 访谈第一集');
  });

  it('从链接导入与工具、字体任务在本机跑：位置写工具与版本 · 本机，不念「云端」；导入的阶段按流程的说法', () => {
    const pipeline = {
      name: 'link-import',
      params: { url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com' },
      steps: [],
      current: 0,
      stoppedAt: null,
      summary: null,
    };
    const link = jobRow(
      job({ jobId: 'j9', kind: 'pipeline', providerId: 'yt-dlp', modelId: '2026.08.19', phase: 'transcribing', pipeline }),
      ctx,
    );
    expect(link).toMatchObject({ where: 'yt-dlp 2026.08.19 · 本机', phase: '提交转录' });
    expect(jobRow(job({ jobId: 't1', kind: 'toolInstall', providerId: 'yt-dlp', modelId: '2026.09.01' }), ctx).where).toBe(
      'yt-dlp 2026.09.01 · 本机',
    );
    expect(jobRow(job({ jobId: 't2', kind: 'toolUpdate', providerId: 'ffmpeg', modelId: '7.1' }), ctx).where).toBe('ffmpeg 7.1 · 本机');
    expect(jobRow(job({ jobId: 'f1', kind: 'fontDownload', providerId: 'google-fonts', modelId: 'Inter' }), ctx).where).toBe(
      'Inter · 本机',
    );
  });
});

describe('agentRow', () => {
  it('在跑：沿用任务状态的字，转圈，可以停止', () => {
    const row = agentRow(task({ taskId: 't1', projectId: 'p1', conversationTitle: '剪口播' }), ctx);
    expect(row).toMatchObject({
      kind: 'agent',
      label: '正在工作',
      tone: 'accent',
      progress: 'indet',
      action: { type: 'stop', taskId: 't1' },
      where: '产品发布会 › 剪口播',
      videoId: null,
      chip: null,
    });
  });

  it('会话在等批准：念「需要你确认」，不画进度条', () => {
    const row = agentRow(task({ taskId: 't2', conversationId: 'c2' }), ctx);
    expect(row).toMatchObject({ waiting: true, label: '需要你确认', tone: 'notice', progress: null, live: true });
  });

  it('正在停止仍算进行中但不能再停；会话标题与目标相同时只写项目', () => {
    const row = agentRow(task({ taskId: 't3', status: 'stopping', goal: '剪口播', conversationTitle: '剪口播' }), ctx);
    expect(row).toMatchObject({ live: true, label: '正在停止', action: null, where: '不属于任何项目' });
  });

  it('结束了的：已完成 / 已停止 / 失败', () => {
    const tones = (['completed', 'stopped', 'failed'] as const).map((status) => agentRow(task({ taskId: status, status }), ctx));
    expect(tones.map((r) => [r.label, r.tone, r.live])).toEqual([
      ['已完成', 'positive', false],
      ['已停止', 'neutral', false],
      ['失败', 'negative', false],
    ]);
  });
});

describe('taskRows / taskGroups', () => {
  it('Agent 任务与 Job 合成一张表，后起的在前；进行中含排队与正在停止', () => {
    const rows = taskRows(
      [task({ taskId: 'a', status: 'completed', startedAt: '2026-10-01T08:00:00Z' }), task({ taskId: 'c', status: 'stopping', startedAt: '2026-10-01T10:00:00Z' })],
      [
        job({ jobId: 'b', state: 'queued', startedAt: null, createdAt: '2026-10-01T09:00:00Z' }),
        job({ jobId: 'd', state: 'failed', startedAt: '2026-10-01T11:00:00Z' }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
    const [active, history] = taskGroups(rows);
    expect(active.items.map((r) => r.id)).toEqual(['c', 'b']);
    expect(history.items.map((r) => r.id)).toEqual(['d', 'a']);
    expect([active.label, history.label]).toEqual(['进行中', '历史']);
  });

  it('固定流程的步骤折叠在父任务下，不单独成行；别的流程提交的转录仍是自己一行', () => {
    const rows = taskRows(
      [],
      [
        job({ jobId: 'parent', kind: 'pipeline' }),
        job({ jobId: 'step', kind: 'pipeline-step', parentJobId: 'parent' }),
        job({ jobId: 'asr', kind: 'transcribe', submitter: { kind: 'pipeline', id: 'parent' } }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(['asr', 'parent']);
  });

  it('从链接导入走到转录：与它的转录合成一行，沿用导入的 ID、标题与取消，念转录的阶段、进度与模型 · 本机', () => {
    const pipeline = { name: 'link-import', params: { host: 'youtube.com' }, steps: [], current: 0, stoppedAt: null, summary: null };
    const parent = job({ jobId: 'imp', kind: 'pipeline', providerId: 'yt-dlp', modelId: '2026.08.19', phase: 'transcribing', pipeline });
    const asr = job({
      jobId: 'asr',
      kind: 'transcribe',
      modelId: 'qwen3-asr',
      progress: { done: 62, total: 100, unit: 'seconds' },
      submitter: { kind: 'pipeline', id: 'imp' },
    });
    const [row, ...rest] = taskRows([], [parent, asr], ctx);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      id: 'imp',
      title: '从链接导入 · youtube.com',
      kind: 'transcribe',
      kindText: '转录',
      where: 'qwen3-asr · 本机',
      phase: '识别中',
      pct: 62,
      action: { type: 'cancel', jobId: 'imp' },
    });
    // 任务详情按 ID 找原样的行；转录结束后（或导入已经结束）各是各的。
    expect(
      taskRows([], [parent, asr], ctx, { fold: false })
        .map((r) => r.id)
        .sort(),
    ).toEqual(['asr', 'imp']);
    const ended = taskRows([], [parent, { ...asr, state: 'completed' }], ctx);
    expect(ended.find((r) => r.id === 'imp')).toMatchObject({
      kind: 'pipeline',
      kindText: '从链接导入',
      where: 'yt-dlp 2026.08.19 · 本机',
    });
    expect(ended.map((r) => r.id).sort()).toEqual(['asr', 'imp']);
  });

  it('从链接导入建字幕层那一步念「生成字幕」，不念导入视频', () => {
    const steps = [
      { name: 'import', label: '导入', status: 'completed' as const, jobId: null, attempts: 1, output: null },
      { name: 'captions', label: '字幕层', status: 'running' as const, jobId: null, attempts: 1, output: null },
    ];
    const pipeline = { name: 'link-import', params: { host: 'youtube.com' }, steps, current: 1, stoppedAt: null, summary: null };
    expect(jobRow(job({ jobId: 'cap', kind: 'pipeline', phase: 'applying', pipeline }), ctx).phase).toBe('生成字幕');
  });
});
