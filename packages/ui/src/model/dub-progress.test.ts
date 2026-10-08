import { describe, expect, it } from 'vitest';
import type { DubSummary, JobRecord, PipelineStepState } from '@baocut/protocol';
import {
  dubFailureFacts,
  dubLadder,
  dubLanguageOf,
  dubProgress,
  dubRemedy,
  dubRetryNote,
  dubSummaryOf,
  dubUnitRows,
  dubWarnings,
  isDubJob,
  liveDubs,
  voiceFailures,
  voiceReasonText,
} from './dub-progress.ts';

const step = (name: string, status: PipelineStepState['status'], jobId: string | null = null, attempts?: number): PipelineStepState => ({
  name,
  label: name,
  status,
  jobId,
  attempts: attempts ?? (status === 'pending' || status === 'skipped' ? 0 : 1),
  output: null,
});

const STEPS = ['freeze-source', 'translate', 'assemble', 'write', 'check-translation', 'separate', 'synthesize', 'align', 'apply'];

function job(state: JobRecord['state'], extra: Partial<JobRecord> = {}, statuses: Record<string, PipelineStepState['status']> = {}): JobRecord {
  return {
    jobId: 'p1',
    kind: 'pipeline',
    state,
    phase: 'starting',
    progress: null,
    videoId: 'vid',
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:0',
    providerId: 'elevenlabs',
    modelId: 'eleven',
    bundleId: null,
    inputHash: 'sha256:0',
    submitter: { kind: 'connection' } as JobRecord['submitter'],
    attempt: 1,
    createdAt: '',
    updatedAt: '',
    startedAt: null,
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    pipeline: {
      name: 'dub',
      params: {
        videoId: 'vid',
        language: 'en',
        translationId: null,
        translate: { provider: 'openai', model: 'gpt' },
        voice: { providerId: 'elevenlabs', modelId: 'eleven', voice: 'v1' },
        separatorId: null,
      },
      steps: STEPS.map((name) => step(name, statuses[name] ?? 'pending', name === 'synthesize' && statuses[name] === 'running' ? 'c-syn' : null)),
      current: null,
      stoppedAt: null,
      summary: null,
    },
    ...extra,
  };
}

const child = (jobId: string, state: JobRecord['state'], extra: Partial<JobRecord> = {}): JobRecord =>
  job(state, { jobId, kind: 'pipeline-step', parentJobId: 'p1', pipeline: undefined, ...extra });

describe('翻译配音的进度', () => {
  it('认得这个视频的配音流程与配成的语言', () => {
    const running = job('running');
    expect(isDubJob(running, 'vid')).toBe(true);
    expect(isDubJob(running, 'other')).toBe(false);
    expect(isDubJob(job('running', { pipeline: { ...running.pipeline!, name: 'translate' } }), 'vid')).toBe(false);
    expect(liveDubs([running, job('completed', { jobId: 'p2' })], 'vid').map((j) => j.jobId)).toEqual(['p1']);
    expect(dubLanguageOf(running)).toBe('en');
  });

  it('跳过的、按参数一定跳过的步骤不计；合成那步按句报进度并数逐句子任务', () => {
    const parent = job(
      'running',
      {},
      {
        'freeze-source': 'completed',
        translate: 'completed',
        assemble: 'completed',
        write: 'completed',
        'check-translation': 'completed',
        synthesize: 'running',
      },
    );
    const synth = child('c-syn', 'running', {
      step: { pipeline: 'dub', name: 'synthesize', label: '逐句合成', index: 6 },
      progress: { done: 5, total: 10, unit: 'units' },
    });
    const sentence = (id: string, state: JobRecord['state'], attempt = 1) =>
      child(id, state, { attempt, step: { pipeline: 'dub', name: 'synthesize', label: '逐句合成：第 1 句', index: 6 } });
    const progress = dubProgress(parent, [
      synth,
      sentence('s1', 'running'),
      sentence('s2', 'failed'),
      sentence('s3', 'completed'),
      sentence('old', 'failed', 0),
    ]);
    // 九步去掉「分离」（没有执行者）：总份量 95，完成 38，合成走了一半 25。
    expect(progress.percent).toBe(Math.floor(((38 + 25) / 95) * 100));
    expect(progress.step).toEqual({ name: 'synthesize', label: 'synthesize' });
    expect(progress.units).toEqual({ step: 'synthesize', done: 5, total: 10 });
    expect(progress.sentences).toEqual({ running: 1, failed: 1 });
  });

  it('给了译文时翻译三步一开始就不计入，进度不跳；完成时 100', () => {
    const parent = job('running', {}, { 'freeze-source': 'running' });
    parent.pipeline!.params.translationId = 't-en';
    expect(dubProgress(parent, []).percent).toBe(0);
    expect(dubLadder(parent).map((s) => s.name)).toEqual(['freeze-source', 'check-translation', 'synthesize', 'align', 'apply']);
    expect(dubLadder(job('running')).map((s) => s.name)).toEqual(STEPS.filter((name) => name !== 'separate'));
    expect(dubProgress(job('completed'), []).percent).toBe(100);
    expect(dubProgress(job('queued'), []).queued).toBe(true);
  });

  it('重试会不会为做过的再花钱：翻译整步重跑、合成只补剩下的、之后的不再调用', () => {
    const stopped = (name: string) => job('failed', {}, { [name]: 'failed' });
    expect(dubRetryNote(stopped('translate'))).toBe('charges');
    const local = stopped('translate');
    (local.pipeline!.params.translate as { provider: string }).provider = 'local';
    expect(dubRetryNote(local)).toBeNull();
    expect(dubRetryNote(stopped('synthesize'))).toBe('partial');
    expect(dubRetryNote(stopped('apply'))).toBe('free');
    expect(dubRetryNote(stopped('freeze-source'))).toBeNull();
  });

  it('补救按停下的那一步：翻译用文本模型那家，合成用语音合成那家', () => {
    const auth = { code: 'PROVIDER_AUTH_FAILED', message: '凭据无效' };
    const atTranslate = job('failed', { error: auth }, { translate: 'failed' });
    expect(dubRemedy(atTranslate)?.target).toEqual({ tab: 'models', category: 'llm', page: 'cloud' });
    const atSynth = job('failed', { error: auth }, { synthesize: 'failed' });
    expect(dubRemedy(atSynth)?.target).toEqual({ tab: 'models', category: 'tts', page: 'cloud' });
  });
});

const summary = (extra: Partial<DubSummary> = {}): DubSummary => ({
  videoId: 'vid',
  language: 'en',
  translation: { documentId: 't-en', revision: 'r1', created: true },
  planDocumentId: 'plan',
  trackId: 'trk',
  groupId: 'dub_p1',
  units: { total: 12, placed: 8, stale: 1, offTimeline: 0, tempo: 2, extended: 1, overlong: 1, voiceUnavailable: 2 },
  staleUnits: ['u9'],
  voiceUnavailableUnits: [
    { unitId: 'u3', speakerId: 'S2', voice: 'library:a', code: 'VOICE_CLONE_REQUIRED', reason: 'stale' },
    { unitId: 'u7', speakerId: 'S2', voice: 'library:a', code: 'VOICE_CLONE_REQUIRED', reason: 'stale' },
  ],
  speakers: [],
  overlongUnits: [{ unitId: 'u5', overflowSeconds: 1.2 }],
  synthesis: { providerId: 'elevenlabs', modelId: 'eleven', voice: 'v1', calls: 9, retries: 0, failures: 0, reused: 0 },
  originalAudio: 'duck',
  separation: 'not-requested',
  ...extra,
});

describe('翻译配音的收据', () => {
  it('读摘要；各句的去向只列有句子的，放上的在前', () => {
    const done = job('completed');
    done.pipeline!.summary = summary() as unknown as Record<string, unknown>;
    expect(dubSummaryOf(done)?.planDocumentId).toBe('plan');
    expect(dubSummaryOf(job('completed'))).toBeNull();
    expect(dubUnitRows(summary()).map((r) => [r.key, r.count, r.placed])).toEqual([
      ['fit', 5, true],
      ['tempo', 2, true],
      ['extended', 1, true],
      ['overlong', 1, false],
      ['stale', 1, false],
      ['voiceUnavailable', 2, false],
    ]);
  });

  it('音色不可用的句子按说话人归拢，原因写成人话', () => {
    expect(voiceFailures(summary().voiceUnavailableUnits)).toEqual([
      { speakerId: 'S2', voice: 'library:a', code: 'VOICE_CLONE_REQUIRED', reason: 'stale', units: ['u3', 'u7'] },
    ]);
    expect(voiceReasonText('VOICE_CLONE_REQUIRED', 'stale')).toBe('克隆已过期，要在声音库里重新克隆');
    expect(voiceReasonText('VOICE_NOT_FOUND', 'invalid')).toBe('找不到这只音色');
    expect(voiceReasonText('LIBRARY_ENTRY_NOT_APPLICABLE', 'service-client')).toBe('对外服务的调用方不能用库里的音色');
  });

  it('失败里的逐句事实：全部不可用、合成失败的句子、已合成与还剩', () => {
    expect(
      dubFailureFacts({
        error: {
          code: 'VOICE_CONSENT_REQUIRED',
          message: 'x',
          details: { unavailable: [{ unitId: 'u1', speakerId: 'S1', voice: 'library:b', code: 'VOICE_CONSENT_REQUIRED', reason: 'no-consent' }] },
        },
      }).unavailable,
    ).toEqual([{ speakerId: 'S1', voice: 'library:b', code: 'VOICE_CONSENT_REQUIRED', reason: 'no-consent', units: ['u1'] }]);
    expect(
      dubFailureFacts({
        error: {
          code: 'DUB_SYNTHESIS_FAILED',
          message: 'x',
          details: { failed: [{ unitId: 'u2', code: 'PROVIDER_ERROR', message: '超时' }], synthesized: 3, remaining: 0 },
        },
      }),
    ).toEqual({ unavailable: [], failed: [{ unitId: 'u2', code: 'PROVIDER_ERROR', message: '超时' }], synthesized: 3, remaining: 0 });
    expect(dubFailureFacts({ error: null })).toEqual({ unavailable: [], failed: [], synthesized: null, remaining: null });
  });

  it('告警同一码只留一条，带 Runtime 的原话', () => {
    const warned = job('completed', {
      warnings: [
        { code: 'DUB_UNITS_STALE', detail: '1 句译文已经过期' },
        { code: 'DUB_UNITS_STALE', detail: '重复' },
        { code: 'DUB_SEPARATION_NOT_CONFIGURED', detail: '跳过' },
      ],
    });
    expect(dubWarnings(warned)).toEqual([
      { code: 'DUB_UNITS_STALE', title: '过期的译文没有合成', detail: '1 句译文已经过期' },
      { code: 'DUB_SEPARATION_NOT_CONFIGURED', title: '没有分离背景', detail: '跳过' },
    ]);
  });
});
