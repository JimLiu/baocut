import { describe, expect, it } from 'vitest';
import type { JobRecord, SpaceEntry } from '@baocut/protocol';
import { entryLocation, rerunOf, toolOfOrigin, toolOfTask, toolsForEntry } from './tool-rerun.ts';

type JobLike = Pick<JobRecord, 'kind' | 'pipeline' | 'submitter' | 'videoId' | 'state'>;

const job = (patch: Partial<JobLike> = {}): JobLike => ({
  kind: 'synthesizeSpeech',
  pipeline: undefined,
  submitter: { kind: 'connection' } as JobRecord['submitter'],
  videoId: null,
  state: 'completed',
  ...patch,
});

const pipeline = (name: string, params: Record<string, unknown> = {}) =>
  ({ kind: 'pipeline', pipeline: { name, params } }) as unknown as Partial<JobLike>;

const entry = (patch: Partial<SpaceEntry> = {}, trashedAt: string | null = null): SpaceEntry => ({
  id: 'e1',
  kind: 'subtitle',
  name: 'talk.srt',
  fileName: 'talk.srt',
  source: { projectId: null, conversationId: null },
  relPath: 'talk.srt',
  size: 2048,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  status: null,
  file: { path: '/Users/me/Movies/BaoCut/talk.srt' },
  ...patch,
  user: { favorite: false, displayName: null, trashedAt },
});

describe('任务是哪个工具的', () => {
  it('工具页的直接任务与流程；Agent、编辑器面板发起的不算', () => {
    expect(toolOfTask(job())).toBe('synthesize-speech');
    expect(toolOfTask(job({ kind: 'generateImage' }))).toBe('generate-image');
    expect(toolOfTask(job({ kind: 'generateText' }))).toBe('generate-text');
    expect(toolOfTask(job(pipeline('translate-subtitles')))).toBe('translate-subtitles');
    expect(toolOfTask(job({ submitter: { kind: 'agent' } as JobRecord['submitter'] }))).toBeNull();
    expect(toolOfTask(job({ videoId: 'v1' }))).toBeNull();
  });

  it('只有条目来源时按任务种类或流程名推断；会话里做的、转码分不出的不算', () => {
    expect(toolOfOrigin({ capability: 'generateImage', conversationId: undefined })).toBe('generate-image');
    expect(toolOfOrigin({ capability: 'transcribe', conversationId: undefined })).toBe('transcribe');
    expect(toolOfOrigin({ capability: 'transcode', conversationId: undefined })).toBeNull();
    expect(toolOfOrigin({ capability: 'synthesizeSpeech', conversationId: 'c1' })).toBeNull();
    expect(toolOfOrigin(undefined)).toBeNull();
  });
});

describe('重试与再做一次', () => {
  it('直接任务回到填好的表单：失败、中断叫「重试」，做完叫「再做一次」', () => {
    expect(rerunOf(job({ state: 'failed' }))).toEqual({ tool: 'synthesize-speech', label: '重试', mode: 'refill' });
    expect(rerunOf(job({ state: 'interrupted' }))?.label).toBe('重试');
    expect(rerunOf(job())).toEqual({ tool: 'synthesize-speech', label: '再做一次', mode: 'refill' });
  });

  it('视频工具打开这次运行；还在跑、排队、等对账与不是工具页的不给', () => {
    expect(rerunOf(job({ ...pipeline('dub'), state: 'failed' }))).toEqual({ tool: 'dub', label: '再做一次', mode: 'view' });
    expect(rerunOf(job({ state: 'running' }))).toBeNull();
    expect(rerunOf(job({ state: 'queued' }))).toBeNull();
    expect(rerunOf(job({ state: 'needs-reconciliation' }))).toBeNull();
    expect(rerunOf(job({ videoId: 'v1', state: 'failed' }))).toBeNull();
  });
});

describe('用工具处理条目', () => {
  it('列收这种条目的工具；回收站、生成中、失败与找不到文件的不列', () => {
    expect(toolsForEntry(entry()).map((t) => t.id)).toEqual(['translate-subtitles', 'synthesize-speech', 'generate-text']);
    expect(toolsForEntry(entry({ kind: 'audio' })).map((t) => t.id)).toEqual(['transcribe', 'extract-audio']);
    expect(toolsForEntry(entry({ kind: 'image' }))).toEqual([]);
    expect(toolsForEntry(entry({}, '2026-10-02T00:00:00.000Z'))).toEqual([]);
    for (const status of ['generating', 'failed', 'missing'] as const) expect(toolsForEntry(entry({ status }))).toEqual([]);
  });

  it('条目所在目录，标出是不是默认保存位置；视频与没有路径的不给', () => {
    expect(entryLocation(entry(), '/Users/me/Movies/BaoCut/')).toEqual({ label: '~/Movies/BaoCut', isSaveDir: true });
    expect(entryLocation(entry(), '/Users/me/Desktop')).toEqual({ label: '~/Movies/BaoCut', isSaveDir: false });
    expect(entryLocation(entry(), null)?.isSaveDir).toBe(false);
    expect(entryLocation(entry({ kind: 'video' }), null)).toBeNull();
    expect(entryLocation(entry({ file: undefined }), null)).toBeNull();
  });
});
