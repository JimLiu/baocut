import { describe, expect, it } from 'vitest';
import type { JobRecord, SpaceEntry, TimelineItem, VideoItem, VideoSnapshot } from '@baocut/protocol';
import {
  conversationOutputs,
  outputSourceMissing,
  outputsByMessage,
  posterFrame,
  type ConversationOutput,
} from './conversation-outputs.ts';

const reply = (id: string, taskId: string, text: string): TimelineItem => ({
  kind: 'agent-message',
  id,
  createdAt: '2026-10-02T00:00:00.000Z',
  taskId,
  text,
  streaming: false,
});

const fileChange = (id: string, taskId: string, detail: string): TimelineItem => ({
  kind: 'tool-call',
  id,
  createdAt: '2026-10-02T00:00:00.000Z',
  taskId,
  tool: 'file-change',
  title: '修改文件',
  detail,
  output: '',
  status: 'completed',
  exitCode: null,
  durationMs: null,
});

const entry = (id: string, patch: Partial<SpaceEntry> = {}, trashedAt: string | null = null): SpaceEntry => ({
  id,
  kind: 'video-file',
  name: `${id}.mp4`,
  fileName: `${id}.mp4`,
  source: { projectId: 'p1', conversationId: null },
  relPath: `${id}.mp4`,
  size: 1024,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  status: null,
  ...patch,
  user: { favorite: false, displayName: null, trashedAt },
});

const change = (
  id: string,
  videoId: string,
  createdAt: string,
  target: { projectId: string; path: string } | { conversationId: string; path: string },
): TimelineItem => ({
  kind: 'video-change',
  id,
  createdAt,
  taskId: 't1',
  videoId,
  videoName: `旧名 ${videoId}`,
  target,
  transactionId: id,
  label: '剪短开头',
  previousRevision: '1',
  videoRevision: '2',
  createdIds: [],
  updatedIds: [],
  deletedIds: [],
  durationSeconds: { before: 12, after: Number(id.slice(-1)) },
  undoOf: null,
});

describe('conversationOutputs', () => {
  it('内部检查导出不从普通文件扫描绕回产物列表；按来源记录或真实路径匹配，不按名字与时长猜测', () => {
    for (const cwd of ['/work/c1', 'C:\\work\\c1']) {
      const source = { projectId: null, conversationId: 'c1' };
      const preview = {
        jobId: 'preview', kind: 'export', videoId: 'm1', createdAt: '2026-10-02T00:00:00.000Z',
        submitter: { kind: 'agent', id: 'c1', taskId: 't1' },
        export: { settings: { kind: 'video', format: 'mp4', purpose: 'preview' } },
        result: { outputs: [{ path: `${cwd}/exports/sample.part1.mp4` }] },
      } as unknown as JobRecord;
      const entries = [
        entry('path', { source, relPath: 'exports/sample.part1.mp4' }),
        entry('origin', { source, origin: { source: 'exported', jobId: 'preview' } }),
        entry('file', { source, file: { path: `${cwd}/exports/sample.part1.mp4` } }),
        entry('real', { source, relPath: 'elsewhere/sample.part1.mp4', media: { durationSec: 1 } }),
      ];
      const outputs = conversationOutputs({ id: 'c1', projectId: null, cwd }, [], entries, Infinity, [preview]);
      expect(outputs.map((o) => o.id)).toEqual(['real']);
      const delivered = {
        ...preview, jobId: 'delivery', createdAt: '2026-10-02T00:01:00.000Z',
        export: { settings: { kind: 'video', format: 'mp4', purpose: 'deliverable' } },
      } as JobRecord;
      const replaced = conversationOutputs({ id: 'c1', projectId: null, cwd }, [], entries, Infinity, [delivered, preview]);
      expect(replaced.map((o) => o.id)).toEqual(['m1', 'path', 'file', 'real']);
      const legacy = { ...preview, export: { settings: { kind: 'video', format: 'mp4' } } } as JobRecord;
      expect(conversationOutputs({ id: 'c1', projectId: null, cwd }, [], entries, Infinity, [legacy]).map((o) => o.id))
        .toEqual(['m1', 'path', 'origin', 'file', 'real']);
    }
  });

  it('项目会话：同一个视频改几次只列一项，取最近一次的时长；名字以 Space 里的为准', () => {
    const items = [
      change('x1', 'm1', '2026-10-02T01:00:00.000Z', { projectId: 'p1', path: '预告' }),
      change('x2', 'm2', '2026-10-02T02:00:00.000Z', { projectId: 'p1', path: '花絮' }),
      change('x3', 'm1', '2026-10-02T03:00:00.000Z', { projectId: 'p1', path: '预告' }),
    ];
    const entries = [entry('e1', { kind: 'video', name: '发布会预告', relPath: '预告' }), entry('loose')];
    const outputs = conversationOutputs({ id: 'c1', projectId: 'p1' }, items, entries);
    expect(outputs.map((o) => [o.id, o.name, o.durationSeconds])).toEqual([
      ['m1', '发布会预告', 3],
      ['m2', '旧名 m2', 2],
    ]);
    expect(outputs[0]!.video).toEqual({ projectId: 'p1', path: '预告' });
  });

  it('进了回收站的视频不列', () => {
    const items = [change('x1', 'm1', '2026-10-02T01:00:00.000Z', { projectId: 'p1', path: '预告' })];
    const entries = [entry('e1', { kind: 'video', relPath: '预告' }, '2026-10-02T02:00:00.000Z')];
    expect(conversationOutputs({ id: 'c1', projectId: 'p1' }, items, entries)).toEqual([]);
  });

  it('不属于项目的会话：再加上自己工作目录里的文件，视频不重复', () => {
    const source = { projectId: null, conversationId: 'c1' };
    const items = [change('x1', 'm1', '2026-10-02T03:00:00.000Z', { conversationId: 'c1', path: '样片' })];
    const entries = [
      entry('video', { kind: 'video', source, relPath: '样片', lastActivityAt: '2026-10-02T03:00:00.000Z' }),
      entry('clip', { source, lastActivityAt: '2026-10-02T02:00:00.000Z' }),
      entry('old', { source }, '2026-10-02T00:00:00.000Z'),
      entry('other', { source: { projectId: null, conversationId: 'c2' } }),
    ];
    const outputs = conversationOutputs({ id: 'c1', projectId: null }, items, entries);
    expect(outputs.map((o) => o.id)).toEqual(['m1', 'clip']);
    expect(outputs[1]!.video).toBeNull();
  });

  it('记下产生它的任务：视频取最近一次修改，文件取改到它的文件改动步骤（绝对路径或相对路径都认）', () => {
    const source = { projectId: null, conversationId: 'c1' };
    const items: TimelineItem[] = [
      { ...change('x1', 'm1', '2026-10-02T01:00:00.000Z', { conversationId: 'c1', path: '样片' }), taskId: 't1' },
      { ...change('x2', 'm1', '2026-10-02T02:00:00.000Z', { conversationId: 'c1', path: '样片' }), taskId: 't2' },
      fileChange('f1', 't1', 'add /work/c1/out/a.srt'),
      fileChange('f2', 't2', 'Edit ./b.md\ndelete gone.txt'),
    ];
    const entries = [
      entry('a', { source, relPath: 'out/a.srt', kind: 'subtitle' }),
      entry('b', { source, relPath: 'b.md', kind: 'document' }),
      entry('gone', { source, relPath: 'gone.txt', kind: 'document' }),
    ];
    const outputs = conversationOutputs({ id: 'c1', projectId: null, cwd: '/work/c1/' }, items, entries);
    expect(Object.fromEntries(outputs.map((o) => [o.id, o.taskId]))).toEqual({ m1: 't2', a: 't1', b: 't2', gone: null });
  });

  it('智能体新建的视频（video-created）与它提交的 Job 指向的视频也列；别的会话的 Job 不算', () => {
    const items: TimelineItem[] = [
      {
        kind: 'video-created',
        id: 'created/m1',
        createdAt: '2026-10-02T01:00:00.000Z',
        taskId: 't1',
        videoId: 'm1',
        videoName: '新视频',
        target: { projectId: 'p1', path: '新视频' },
        videoRevision: '1',
      },
    ];
    const job = (videoId: string, conversationId: string, createdAt: string) =>
      ({
        jobId: `job_${videoId}_${conversationId}`,
        kind: 'transcribe',
        videoId,
        parentJobId: null,
        submitter: { kind: 'agent', id: conversationId, taskId: 't2' },
        createdAt,
      }) as unknown as JobRecord;
    const entries = [entry('e2', { kind: 'video', name: '访谈', relPath: 'videos/访谈', ref: { videoId: 'm2' } } as Partial<SpaceEntry>)];
    const jobs = [job('m2', 'c1', '2026-10-02T02:00:00.000Z'), job('m3', 'c2', '2026-10-02T03:00:00.000Z')];
    const outputs = conversationOutputs({ id: 'c1', projectId: 'p1' }, items, entries, undefined, jobs);
    expect(outputs.map((o) => [o.id, o.name, o.video])).toEqual([
      ['m2', '访谈', { projectId: 'p1', path: 'videos/访谈' }],
      ['m1', '新视频', { projectId: 'p1', path: '新视频' }],
    ]);
  });

  it('limit：会话头最多 30 项，按回复分组时可以不截断', () => {
    const source = { projectId: null, conversationId: 'c1' };
    const entries = Array.from({ length: 35 }, (_, i) => entry(`e${i}`, { source }));
    expect(conversationOutputs({ id: 'c1', projectId: null }, [], entries)).toHaveLength(30);
    expect(conversationOutputs({ id: 'c1', projectId: null }, [], entries, Infinity)).toHaveLength(35);
  });
});

describe('outputsByMessage', () => {
  const output = (id: string, taskId: string | null, at: string): ConversationOutput => ({
    id,
    kind: 'document',
    name: id,
    video: null,
    entry: null,
    durationSeconds: null,
    at,
    taskId,
  });

  it('归到任务最后一条显示出来的回复下面，按先后排；没有回复的任务、认不出任务的不挂', () => {
    const items: TimelineItem[] = [
      reply('r1', 't1', '先看看'),
      reply('r2', 't1', '改好了'),
      reply('r3', 't1', '   '),
      reply('r4', 't2', '第二轮'),
    ];
    const outputs = [
      output('late', 't1', '2026-10-02T03:00:00.000Z'),
      output('early', 't1', '2026-10-02T01:00:00.000Z'),
      output('second', 't2', '2026-10-02T02:00:00.000Z'),
      output('silent', 't3', '2026-10-02T02:00:00.000Z'),
      output('unknown', null, '2026-10-02T02:00:00.000Z'),
    ];
    const byMessage = outputsByMessage(items, outputs);
    expect([...byMessage.keys()]).toEqual(['r2', 'r4']);
    expect(byMessage.get('r2')!.map((o) => o.id)).toEqual(['early', 'late']);
    expect(byMessage.get('r4')!.map((o) => o.id)).toEqual(['second']);
  });

  it('流式中的空回复也算（回复写完前产物先挂在它下面）', () => {
    const streaming: TimelineItem = { kind: 'agent-message', id: 'r2', createdAt: '2026-10-02T00:00:00.000Z', taskId: 't1', text: '', streaming: true };
    const items: TimelineItem[] = [reply('r1', 't1', '好'), streaming];
    expect([...outputsByMessage(items, [output('a', 't1', '2026-10-02T01:00:00.000Z')]).keys()]).toEqual(['r2']);
  });
});

describe('outputSourceMissing', () => {
  const video = (patch: Partial<ConversationOutput> = {}): ConversationOutput => ({
    id: 'm1',
    kind: 'video',
    name: '样片',
    video: { projectId: 'p1', path: '样片' },
    entry: null,
    durationSeconds: 3,
    at: '2026-10-02T01:00:00.000Z',
    taskId: 't1',
    ...patch,
  });
  const space = { ready: true, scanning: false, issues: [] };

  it('Space 扫完、来源扫描完整、却没有这个视频的条目：找不到源文件', () => {
    expect(outputSourceMissing(video(), space)).toBe(true);
    expect(outputSourceMissing(video({ video: { conversationId: 'c1', path: '样片' } }), space)).toBe(true);
  });

  it('有条目、还在扫、扫描不完整、不是视频时都不下结论', () => {
    expect(outputSourceMissing(video({ entry: entry('e1', { kind: 'video' }) }), space)).toBe(false);
    expect(outputSourceMissing(video(), { ...space, ready: false })).toBe(false);
    expect(outputSourceMissing(video(), { ...space, scanning: true })).toBe(false);
    const issues = [{ sourceKey: 'project:p1', kind: 'truncated' as const, detail: '' }];
    expect(outputSourceMissing(video(), { ...space, issues })).toBe(false);
    expect(outputSourceMissing(video({ video: { conversationId: 'c1', path: '样片' } }), { ...space, issues })).toBe(true);
    expect(outputSourceMissing(video({ kind: 'document', video: null }), space)).toBe(false);
  });
});

describe('posterFrame', () => {
  const clip = (id: string, trackId: string, fromFrame: number, assetId: string, timeMap: VideoItem['timeMap'], enabled = true) =>
    ({
      id,
      type: 'video',
      trackId,
      enabled,
      span: { fromFrame, durationFrames: 30 },
      assetRef: { id: assetId, revision: '1' },
      timeMap,
    }) as unknown as VideoItem;
  const snapshot = (items: VideoItem[], hiddenTracks: string[] = []): VideoSnapshot =>
    ({
      rootSequenceId: 's1',
      sequences: {
        s1: {
          id: 's1',
          tracks: ['v1', 'v2'].map((id) => ({ id, visible: !hiddenTracks.includes(id) })),
          items,
        },
      },
      assets: {
        movie: { revisions: { '1': { video: { displayWidth: 1920 } } } },
        sound: { revisions: { '1': {} } },
      },
    }) as unknown as VideoSnapshot;
  const linear = (seconds: number): VideoItem['timeMap'] => ({
    kind: 'linear',
    sourceIn: { ticks: String(seconds * 1000), timescale: 1000 },
    rate: { num: 1, den: 1 },
  });

  it('取根序列上最早、轨道可见、启用着、有画面的视频片段开头那一帧', () => {
    const items = [
      clip('later', 'v1', 60, 'movie', linear(9)),
      clip('noVideo', 'v1', 0, 'sound', linear(1)),
      clip('disabled', 'v1', 0, 'movie', linear(2), false),
      clip('hidden', 'v2', 0, 'movie', linear(3)),
      clip('first', 'v1', 10, 'movie', linear(4)),
    ];
    expect(posterFrame(snapshot(items, ['v2']))).toEqual({ asset: { id: 'movie', revision: '1' }, at: 4 });
  });

  it('没有视频片段时为 null', () => {
    expect(posterFrame(snapshot([]))).toBeNull();
  });
});
