import { AI_TOOL_PIPELINE, type DocumentRecord, type JobRecord } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { aiToolJobFacts, aiToolRowState, pendingCutCount, type AiToolRowFacts } from './ai-tool-row-state.ts';

describe('aiToolRowState', () => {
  it('什么都没有时不出状态', () => {
    expect(aiToolRowState('polish', {})).toBeNull();
    expect(aiToolRowState('cleanup', { pendingCuts: 0, staleSentences: 0, chapters: 0, last: null, running: null })).toBeNull();
  });

  it('在跑：带百分比；不知道百分比时 null（列表写「在跑」）', () => {
    expect(aiToolRowState('polish', { running: { percent: 40 } })).toEqual({ kind: 'running', percent: 40 });
    expect(aiToolRowState('polish', { running: { percent: null } })).toEqual({ kind: 'running', percent: null });
  });

  it('结果没看完与说话人提案', () => {
    expect(aiToolRowState('summary', { result: true })).toEqual({ kind: 'result' });
    expect(aiToolRowState('speakers', { review: true })).toEqual({ kind: 'review' });
  });

  it('找可剪的口：待定的建议条数', () => {
    expect(aiToolRowState('cleanup', { pendingCuts: 3 })).toEqual({ kind: 'pending', count: 3 });
  });

  it('刷新过期译文：过期的句数', () => {
    expect(aiToolRowState('stale', { staleSentences: 5 })).toEqual({ kind: 'stale', count: 5 });
  });

  it('生成章节：时间线上的章节数', () => {
    expect(aiToolRowState('chapters', { chapters: 4 })).toEqual({ kind: 'chapters', count: 4 });
  });

  it('上次跑完的时间；那一笔撤销了就是已撤销', () => {
    expect(aiToolRowState('title', { last: { at: '2026-10-09T08:00:00Z', undone: false } })).toEqual({ kind: 'last', at: '2026-10-09T08:00:00Z' });
    expect(aiToolRowState('polish', { last: { at: '2026-10-09T08:00:00Z', undone: true } })).toEqual({ kind: 'undone' });
  });

  it('待定、过期、章节只算各自的工具', () => {
    const facts: AiToolRowFacts = { pendingCuts: 3, staleSentences: 5, chapters: 4 };
    expect(aiToolRowState('polish', facts)).toBeNull();
    expect(aiToolRowState('summary', facts)).toBeNull();
    expect(aiToolRowState('cleanup', facts)?.kind).toBe('pending');
    expect(aiToolRowState('stale', facts)?.kind).toBe('stale');
    expect(aiToolRowState('chapters', facts)?.kind).toBe('chapters');
  });

  describe('优先级：在跑 > 待处理 > 过期 > 章节 > 上次跑过', () => {
    const last = { at: '2026-10-09T08:00:00Z', undone: false };
    it('在跑压过一切', () => {
      const all: AiToolRowFacts = { running: { percent: 10 }, result: true, review: true, pendingCuts: 2, staleSentences: 2, chapters: 2, last };
      for (const tool of ['cleanup', 'stale', 'chapters', 'speakers', 'polish'] as const) expect(aiToolRowState(tool, all)?.kind).toBe('running');
    });
    it('结果没看完压过章节与上次', () => {
      expect(aiToolRowState('chapters', { result: true, chapters: 3, last })?.kind).toBe('result');
    });
    it('待定压过上次', () => {
      expect(aiToolRowState('cleanup', { pendingCuts: 2, last })?.kind).toBe('pending');
    });
    it('过期压过上次', () => {
      expect(aiToolRowState('stale', { staleSentences: 2, last })?.kind).toBe('stale');
    });
    it('章节压过上次与已撤销', () => {
      expect(aiToolRowState('chapters', { chapters: 3, last })?.kind).toBe('chapters');
      expect(aiToolRowState('chapters', { chapters: 3, last: { ...last, undone: true } })?.kind).toBe('chapters');
    });
  });
});

const job = (over: Partial<JobRecord> & { tool?: string; video?: string }): JobRecord =>
  ({
    jobId: over.jobId ?? 'job_1',
    kind: 'pipeline',
    state: 'completed',
    phase: 'done',
    progress: null,
    videoId: over.video ?? 'video_1',
    endedAt: '2026-10-09T08:00:00Z',
    updatedAt: '2026-10-09T08:00:00Z',
    pipeline: { name: AI_TOOL_PIPELINE, params: { videoId: over.video ?? 'video_1', tool: over.tool ?? 'polish' }, steps: [], current: null, stoppedAt: null, summary: null },
    ...over,
  }) as JobRecord;

describe('aiToolJobFacts', () => {
  it('按工具分：在跑的带百分比、完成的取最近一次；别的视频、别的流程、失败的不算', () => {
    const facts = aiToolJobFacts(
      [
        job({ jobId: 'a', tool: 'polish', endedAt: '2026-10-09T07:00:00Z' }),
        job({ jobId: 'b', tool: 'polish', endedAt: '2026-10-09T09:00:00Z' }),
        job({ jobId: 'c', tool: 'polish', state: 'failed', endedAt: '2026-10-09T10:00:00Z' }),
        job({ jobId: 'd', tool: 'summary', state: 'running', endedAt: null, progress: { done: 1, total: 4, unit: 'steps' } }),
        job({ jobId: 'e', tool: 'title', video: 'video_2' }),
        job({ jobId: 'f', tool: 'blog', pipeline: { name: 'dub', params: { videoId: 'video_1', tool: 'blog' }, steps: [], current: null, stoppedAt: null, summary: null } }),
      ],
      'video_1',
    );
    expect(facts.polish).toEqual({ running: null, last: { jobId: 'b', at: '2026-10-09T09:00:00Z' } });
    expect(facts.summary).toEqual({ running: { percent: 25 }, last: null });
    expect(facts.title).toBeUndefined();
    expect(facts.blog).toBeUndefined();
  });
});

const doc = (id: string, kind: string, revision = 'r1'): DocumentRecord => ({ id, kind, name: id, currentRevision: revision, revisions: {} });

describe('pendingCutCount', () => {
  const documents = { sp: doc('sp', 'speech', 'r2'), pr: doc('pr', 'editorial-proposal') };
  const body = (revision: string) => ({
    schema: 'baocut.editorial-proposal/1',
    speechRef: { id: 'sp', revision },
    suggestions: [{ status: 'pending' }, { status: 'pending' }, { status: 'accepted' }],
  });
  it('只数还没定的建议', () => {
    expect(pendingCutCount([{ record: documents.pr, body: body('r2') }], documents)).toBe(2);
  });
  it('转写改过、提案过期了不算；正文没到或认不出来不算', () => {
    expect(pendingCutCount([{ record: documents.pr, body: body('r1') }], documents)).toBe(0);
    expect(pendingCutCount([{ record: documents.pr, body: undefined }], documents)).toBe(0);
    expect(pendingCutCount([{ record: documents.pr, body: { schema: 'other' } }], documents)).toBe(0);
  });
});
