import { DEFAULT_CAPTION_STYLE } from '../../model/property-values.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RpcError,
  type ApplicationRecord,
  type DocumentRecord,
  type EditOperation,
  type JobRecord,
  type PipelineCaptionsSummary,
  type Sequence,
  type TransactionReceipt,
  type VideoItem,
  type VideoSnapshot,
} from '@baocut/protocol';
import { useJobs } from '../../state/jobs-store.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import {
  awaitingDecision,
  bindTranscribe,
  decisionProblem,
  generateFromSpeech,
  mediaCandidates,
  patchSetup,
  resetTranscribe,
  startTranscribe,
  useSubtitleRun,
  type TranscribeDeps,
} from './transcribe-run.ts';

const item: VideoItem = {
  id: 'clip',
  trackId: 'v1',
  type: 'video',
  enabled: true,
  locked: false,
  paintOrder: 0,
  followPolicy: { kind: 'sequence-fixed' },
  span: { fromFrame: 0, durationFrames: 300 },
  place: {},
  mode: 'fullscreen',
  assetRef: { id: 'asset', revision: '1' },
  timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1000 }, rate: { num: 1, den: 1 } },
  fit: 'contain',
  embeddedAudio: { enabled: true, volume: 1 },
};

const sequence: Sequence = {
  id: 'seq',
  revision: '1',
  name: '主序列',
  fps: { num: 30, den: 1 },
  canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
  durationPolicy: { kind: 'derived' },
  tracks: [{ id: 'v1', order: 1, kind: 'visual', locked: false, visible: true, muted: false, solo: { enabled: false, group: 'visual' } }],
  items: [item],
  animationBindings: [],
  transitions: [],
  markers: [],
  ducking: [],
};

const speechRecord: DocumentRecord = { id: 'speech', kind: 'speech', name: '访谈 转写', sourceAssetId: 'asset', currentRevision: 'r1', revisions: {} };

const speechBody = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  speakers: [],
  sentences: null,
  words: [
    { id: 'w1', start: 0, end: 400, text: '你好' },
    { id: 'w2', start: 400, end: 900, text: '世界。' },
  ],
};

function open(videoId: string, documents: Record<string, DocumentRecord> = {}): void {
  const video = {
    id: videoId,
    revision: '1',
    rootSequenceId: 'seq',
    sequences: { seq: sequence },
    assets: { asset: { id: 'asset', kind: 'video', name: '访谈.mp4', currentRevision: '1', revisions: {} } },
    documents,
  } as unknown as VideoSnapshot;
  useVideo.setState({
    video: {
      target: { sourceKey: 'local', path: 'a.baocut' },
      videoId,
      ref: null,
      state: { video, eventSeq: 1 },
      status: 'ready',
      error: null,
      inFlight: 0,
      lastReceipt: null,
      lastChange: null,
      commandError: null,
      undo: {},
    } as unknown as OpenVideo,
  });
}

function job(state: JobRecord['state'], extra: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job1',
    kind: 'transcribe',
    state,
    phase: state === 'completed' ? 'done' : 'transcribing',
    progress: null,
    videoId: 'vid',
    assetId: 'asset',
    assetRevision: '1',
    contentHash: 'sha256:0',
    providerId: 'local',
    modelId: 'm',
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
    ...extra,
  };
}

function application(state: ApplicationRecord['state']): ApplicationRecord {
  return {
    applicationId: 'ap1',
    jobId: 'job1',
    artifactIds: ['a'],
    videoId: 'vid',
    targetRefs: [],
    baseVideoRevision: null,
    commandId: null,
    state,
    receipt: null,
    error: null,
    createdAt: '',
    updatedAt: '',
  } as ApplicationRecord;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const created: PipelineCaptionsSummary = { status: 'created', documentId: 'cap1', cueCount: 3, enabled: true, transactionId: 'tx-cap' };

/** 转录流程的父任务；`summary` 给了时是完成时的摘要（`captions` 之外的字段这里用不到）。 */
function pipeline(state: JobRecord['state'], summary: Record<string, unknown> | null = null, extra: Partial<JobRecord> = {}): JobRecord {
  return job(state, {
    jobId: 'p1',
    kind: 'pipeline',
    assetId: null,
    endedAt: state === 'running' || state === 'queued' ? null : 'e1',
    result: summary ? { documentId: 'speech', artifactId: 'a' } : null,
    pipeline: { name: 'transcribe', params: { videoId: 'vid', assetId: 'asset' }, steps: [], current: null, stoppedAt: null, summary },
    ...extra,
  });
}

function fake() {
  const applied: EditOperation[][] = [];
  const toasts: Array<[string, string, boolean]> = [];
  let next = 0;
  const deps: TranscribeDeps = {
    runtime: {
      startPipeline: vi.fn(async () => `p${++next}`),
      readDocument: vi.fn(async () => ({ document: speechRecord, revision: 'r1', body: speechBody })),
      cancelJob: vi.fn(async () => {}),
      videos: {
        apply: vi.fn(async (operations: EditOperation[]) => {
          applied.push(operations);
          return { transactionId: 'tx1', refs: { 'speech-caption': 'cap1' } } as unknown as TransactionReceipt;
        }),
        undo: vi.fn(async () => null),
      },
    },
    toast: (kind, message, undo) => toasts.push([kind, message, !!undo]),
  };
  return { deps, applied, toasts };
}

beforeEach(() => {
  resetTranscribe();
  useJobs.setState({ ready: true, jobs: [] });
  open('vid');
});
afterEach(() => resetTranscribe());

describe('生成字幕', () => {
  it('候选素材：只取放在时间线上的音视频，带上最新的那份转写', () => {
    const asset = (id: string, kind: string) => ({ id, kind, name: `${id}.mp4`, currentRevision: '1', revisions: {} }) as never;
    const speech = (id: string, at: string): DocumentRecord => ({
      id,
      kind: 'speech',
      name: id,
      sourceAssetId: 'asset',
      currentRevision: 'r',
      revisions: { r: { revision: 'r', contentHash: '', byteLength: 0, createdAt: at, createdBy: 'tx' } },
    });
    const candidates = mediaCandidates(
      sequence,
      { asset: asset('asset', 'video'), loose: asset('loose', 'audio'), pic: asset('pic', 'image') },
      { old: speech('old', '2026-01-01'), fresh: speech('fresh', '2026-02-01') },
    );
    expect(candidates.map((c) => [c.asset.id, c.speech?.id])).toEqual([['asset', 'fresh']]);
  });

  it('没有配置转录：提交被拒，就地给出原因、提示与去模型页的补救，不留运行态', async () => {
    const { deps } = fake();
    deps.runtime.startPipeline = vi.fn(async () => {
      throw new RpcError('conflict', '没有可用的转录服务', {
        code: 'CAPABILITY_NOT_CONFIGURED',
        capability: 'transcribe',
        reason: 'no-default',
        remedy: { action: 'set-default', capability: 'transcribe', hint: '在模型页选一个转录模型。' },
      });
    });
    bindTranscribe(deps);
    await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
    const state = useSubtitleRun.getState();
    expect(state.runs.vid).toBeUndefined();
    expect(state.problems.vid).toMatchObject({
      kind: 'not-configured',
      title: '还不能转录 · 还没有选转录用的模型',
      message: '在模型页选一个转录模型。',
      remedy: { target: { tab: 'models' } },
    });
  });

  it('转录设置：按视频记；提交转录流程时把选项带上，videoId / assetId 不被盖掉', async () => {
    const { deps } = fake();
    bindTranscribe(deps);
    const base = { language: '', model: null, prompt: '' };
    patchSetup('vid', base, { language: 'en' });
    patchSetup('vid', base, { prompt: '播客' });
    expect(useSubtitleRun.getState().setups).toEqual({ vid: { language: 'en', model: null, prompt: '播客' } });
    await startTranscribe(
      'vid',
      { id: 'asset', name: '访谈.mp4' },
      { provider: 'openai', model: 'whisper-1', language: 'en', hint: '播客' },
    );
    expect(deps.runtime.startPipeline).toHaveBeenCalledWith('transcribe', {
      captionStyle: DEFAULT_CAPTION_STYLE,
      provider: 'openai',
      model: 'whisper-1',
      language: 'en',
      hint: '播客',
      videoId: 'vid',
      assetId: 'asset',
    });
    resetTranscribe();
    expect(useSubtitleRun.getState().setups).toEqual({});
  });

  it('流程完成：照 summary.captions 选中新的那层、提示带撤销（撤流程建字幕层的那笔）；编辑器不再自己写；后面的事件不会再收一次', async () => {
    const { deps, applied, toasts } = fake();
    bindTranscribe(deps);
    await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
    expect(useSubtitleRun.getState().runs.vid).toMatchObject({ jobId: 'p1', status: 'running' });

    // 转写一步在跑：这一轮还在。
    useJobs.setState({ jobs: [pipeline('running'), job('running', { submitter: { kind: 'pipeline', id: 'p1' } })] });
    await flush();
    expect(useSubtitleRun.getState().runs.vid?.status).toBe('running');

    useJobs.setState({ jobs: [pipeline('completed', { captions: created })] });
    await flush();
    useJobs.setState({ jobs: [pipeline('completed', { captions: created }, { updatedAt: 'later' })] });
    await flush();

    expect(applied).toEqual([]);
    expect(deps.runtime.readDocument).not.toHaveBeenCalled();
    expect(useSubtitleRun.getState().runs.vid).toBeUndefined();
    expect(useSubtitleRun.getState().problems.vid).toBeUndefined();
    expect(useSubtitleRun.getState().focus.vid).toBe('cap1');
    expect(toasts).toEqual([['positive', '已生成 3 条字幕', true]]);
  });

  it('新的一层停用着放上去时如实说；投不到画面上、没有字幕条、流程没建时各自收尾', async () => {
    const { deps, toasts } = fake();
    bindTranscribe(deps);
    await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
    useJobs.setState({ jobs: [pipeline('completed', { captions: { ...created, enabled: false } })] });
    await flush();
    expect(toasts.at(-1)?.[1]).toContain('新的一层先没放上画面');

    const cases: Array<[PipelineCaptionsSummary | undefined, Record<string, unknown>]> = [
      [
        { status: 'not-on-timeline', documentId: null, cueCount: null, enabled: null },
        { kind: 'empty', title: '识别出的话都不在时间线上' },
      ],
      [
        { status: 'empty', documentId: null, cueCount: null, enabled: null },
        { kind: 'empty', title: '没有识别出语音' },
      ],
      [
        { status: 'disabled', documentId: null, cueCount: null, enabled: null },
        { kind: 'pending', title: '转写已完成，字幕还没生成' },
      ],
      [undefined, { kind: 'pending' }],
    ];
    for (const [n, [captions, problem]] of cases.entries()) {
      await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
      useJobs.setState({ jobs: [pipeline('completed', captions ? { captions } : {}, { jobId: `p${n + 2}` })] });
      await flush();
      expect(useSubtitleRun.getState().runs.vid).toBeUndefined();
      expect(useSubtitleRun.getState().problems.vid).toMatchObject(problem);
    }
  });

  it('没有音轨、取消、失败：如实收尾', async () => {
    const { deps, toasts } = fake();
    bindTranscribe(deps);
    await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
    // 转写做完了、没写出文档：流程的转写一步记为失败，原因看那个转写 Job。
    useJobs.setState({
      jobs: [
        pipeline('failed', null, { error: { code: 'APPLY_FAILED', message: '转写完成了，但没有写进视频' } }),
        job('completed', {
          submitter: { kind: 'pipeline', id: 'p1' },
          result: { documentId: null, artifactId: 'a' },
          warnings: [{ code: 'no-audio-track' }],
        }),
      ],
    });
    await flush();
    expect(useSubtitleRun.getState().problems.vid).toMatchObject({ kind: 'empty', title: '这段素材没有音轨' });

    await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
    expect(useSubtitleRun.getState().problems.vid).toBeUndefined();
    useJobs.setState({ jobs: [pipeline('cancelled', null, { jobId: 'p2' })] });
    await flush();
    expect(useSubtitleRun.getState().runs.vid).toBeUndefined();
    expect(toasts.at(-1)).toEqual(['neutral', '已取消转录', false]);

    await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
    useJobs.setState({ jobs: [pipeline('failed', null, { jobId: 'p3', error: { code: 'MODEL_LOAD_FAILED', message: '模型加载失败' } })] });
    await flush();
    expect(useSubtitleRun.getState().problems.vid).toMatchObject({
      kind: 'failed',
      title: '转录失败',
      message: '模型加载失败',
      remedy: { target: { tab: 'models', page: 'local' } },
    });
  });

  it('转写 Job 要用户拿主意（结果不明、识别结果在没写进视频）：流程失败，指到那个转写 Job', async () => {
    const result = { documentId: 'speech', artifactId: 'a' };
    const ended = { endedAt: '2026-10-03T00:00:00.000Z', result };
    const unapplied = job('failed', { ...ended, error: { code: 'STALE_JOB_INPUT', message: '视频已经改过' }, applications: [application('stale-input')] });
    expect(awaitingDecision(unapplied)).toBe(true);
    expect(decisionProblem(unapplied)).toMatchObject({ title: '转写没有写进视频', message: expect.stringContaining('视频已经改过。') });
    expect(awaitingDecision(job('failed', { ...ended, applications: [application('committed')] }))).toBe(false);
    expect(awaitingDecision(job('cancelled', { ...ended, applications: [application('cancelled')] }))).toBe(false);
    // 崩溃后正在自动重跑的不算；流程的父任务也不算。
    expect(awaitingDecision(job('interrupted'))).toBe(false);
    expect(awaitingDecision(pipeline('failed'))).toBe(false);

    const { deps, applied } = fake();
    bindTranscribe(deps);
    for (const [n, step] of [job('needs-reconciliation', { endedAt: ended.endedAt }), unapplied].entries()) {
      await startTranscribe('vid', { id: 'asset', name: '访谈.mp4' });
      const parent = pipeline('failed', null, { jobId: `p${n + 1}`, error: { code: 'TRANSCRIBE_FAILED', message: '转写没有完成' } });
      useJobs.setState({ jobs: [parent, { ...step, jobId: `t${n + 1}`, submitter: { kind: 'pipeline', id: `p${n + 1}` } }] });
      await flush();
      expect(useSubtitleRun.getState().runs.vid).toBeUndefined();
      expect(useSubtitleRun.getState().problems.vid).toMatchObject({
        kind: 'decide',
        title: n === 0 ? '转录结果不明' : '转写没有写进视频',
        remedy: { label: '去后台任务处理', target: { tab: 'tasks', taskId: `t${n + 1}` } },
      });
    }
    expect(applied).toEqual([]);
  });

  it('用已有转写生成；用户换了视频时不往别的视频里写', async () => {
    const { deps, applied, toasts } = fake();
    bindTranscribe(deps);
    open('vid', { speech: speechRecord });
    await generateFromSpeech('vid', { id: 'asset', name: '访谈.mp4' }, 'speech');
    expect(applied).toHaveLength(1);
    expect(deps.runtime.startPipeline).not.toHaveBeenCalled();

    open('other');
    vi.useFakeTimers();
    try {
      const pending = generateFromSpeech('vid', { id: 'asset', name: '访谈.mp4' }, 'speech');
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
    expect(applied).toHaveLength(1);
    expect(useSubtitleRun.getState().problems.vid).toMatchObject({ kind: 'pending' });
    expect(toasts.at(-1)).toEqual(['neutral', '「访谈.mp4」转写完成 · 回到那个视频点「生成字幕」', false]);
  });
});
