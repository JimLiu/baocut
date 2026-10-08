import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RpcError,
  type DocumentRecord,
  type DubParams,
  type DubSummary,
  type EditOperation,
  type Grant,
  type JobRecord,
  type PipelineStepState,
  type Sequence,
  type TransactionReceipt,
  type VideoSnapshot,
} from '@baocut/protocol';
import type { HostBridge } from '../../host.ts';
import { RuntimeSession } from '../../runtime/session.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import { DUB_COPY } from './dub-copy.ts';
import {
  awaitDubInstall,
  bindDub,
  cancelDub,
  confirmGrant,
  dismissAsk,
  resetDub,
  retryDub,
  startDub,
  undoDub,
  useDubRun,
  type DubDeps,
  type DubIntent,
} from './dub-run.ts';

const sequence = {
  id: 'seq',
  revision: '1',
  tracks: [{ id: 'trk-dub' }],
  items: [
    { id: 'clip', type: 'video', embeddedAudio: { enabled: false, volume: 1 } },
    {
      id: 'd1',
      type: 'audio',
      mix: { volume: 1 },
      role: 'dub',
      extensions: { 'baocut.dub': { groupId: 'dub_p1', language: 'en', unitId: 'u1' } },
    },
  ],
  ducking: [],
} as unknown as Sequence;

const plan: DocumentRecord = {
  id: 'plan',
  kind: 'dubbing-plan',
  name: '配音计划（en）',
  currentRevision: '1',
  revisions: { '1': { revision: '1', contentHash: '', byteLength: 0, createdAt: '2026-10-03T10:00:00Z', createdBy: 'tx-apply' } },
};

function open(videoId: string, documents: Record<string, DocumentRecord> = {}): void {
  const video = { id: videoId, revision: '1', rootSequenceId: 'seq', sequences: { seq: sequence }, assets: {}, documents } as unknown as VideoSnapshot;
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

const step = (name: string, status: PipelineStepState['status']): PipelineStepState => ({ name, label: name, status, jobId: null, attempts: 1, output: null });

function job(state: JobRecord['state'], extra: Partial<JobRecord> & { stoppedAt?: string } = {}): JobRecord {
  const { stoppedAt = null, ...rest } = extra;
  return {
    jobId: 'p1',
    kind: 'pipeline',
    state,
    phase: state === 'completed' ? 'done' : 'starting',
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
    updatedAt: 'u1',
    startedAt: null,
    endedAt: state === 'running' || state === 'queued' ? null : 'e1',
    error: null,
    result: null,
    warnings: [],
    pipeline: {
      name: 'dub',
      params: {
        videoId: 'vid',
        language: 'en',
        translationId: 't-en',
        translate: { provider: 'openai', model: 'gpt' },
        voice: { providerId: 'elevenlabs', modelId: 'eleven', voice: 'v1' },
        duckDb: 12,
        separatorId: null,
      },
      steps: ['freeze-source', 'check-translation', 'synthesize', 'align', 'apply'].map((name) => step(name, stoppedAt === name ? 'failed' : 'completed')),
      current: null,
      stoppedAt,
      summary: null,
    },
    ...rest,
  };
}

const summary: DubSummary = {
  videoId: 'vid',
  language: 'en',
  translation: { documentId: 't-en', revision: 'r1', created: false },
  planDocumentId: 'plan',
  trackId: 'trk-dub',
  groupId: 'dub_p1',
  units: { total: 3, placed: 2, stale: 0, offTimeline: 0, tempo: 1, extended: 0, overlong: 0, voiceUnavailable: 1 },
  staleUnits: [],
  voiceUnavailableUnits: [{ unitId: 'u3', speakerId: 'S2', voice: 'library:a', code: 'VOICE_CLONE_REQUIRED', reason: 'stale' }],
  speakers: [],
  overlongUnits: [],
  synthesis: { providerId: 'elevenlabs', modelId: 'eleven', voice: 'v1', calls: 2, retries: 0, failures: 0, reused: 0 },
  originalAudio: 'mute',
  separation: 'not-requested',
};

const refused = (recipient: string, code = 'GRANT_REQUIRED') =>
  new RpcError('forbidden', `把文稿与译文交给 ${recipient} 需要用户授权`, {
    code,
    recipient,
    dataKinds: ['transcript'],
    videoId: 'vid',
    remedy: { action: 'create-grant', hint: '数据外发要用户授权', commands: [`baocut grants create --recipient ${recipient}`] },
  });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const params: DubParams = { videoId: 'vid', translationId: 't-en', provider: 'elevenlabs', model: 'eleven', originalAudio: 'mute' };
const intent: DubIntent = { videoId: 'vid', language: 'en', videoName: '访谈' };

function fake() {
  const applied: EditOperation[][] = [];
  const toasts: Array<[string, string, boolean]> = [];
  const deps: DubDeps = {
    runtime: {
      startDub: vi.fn(async () => 'p1'),
      createGrant: vi.fn(async () => ({ grantId: 'g1' }) as Grant),
      retryPipeline: vi.fn(async () => {}),
      cancelJob: vi.fn(async () => {}),
      readDocument: vi.fn(async () => ({ document: plan, revision: '1', body: { extensions: { 'baocut.dub': { mutedItemIds: ['clip'] } } } })),
      videos: {
        apply: vi.fn(async (operations: EditOperation[]) => {
          applied.push(operations);
          return { transactionId: `tx${applied.length}` } as unknown as TransactionReceipt;
        }),
        undo: vi.fn(async () => ({ transactionId: 'undo' }) as unknown as TransactionReceipt),
        clearError: vi.fn(),
      },
    },
    toast: (kind, message, undo) => toasts.push([kind, message, !!undo]),
  };
  return { deps, applied, toasts };
}

beforeEach(() => {
  resetDub();
  useJobs.setState({ ready: true, jobs: [] });
  open('vid', { plan });
});
afterEach(() => resetDub());

describe('开始配音与授权', () => {
  it('走真的会话：第一次被 GRANT_REQUIRED 拒绝 → 询问；确认后 grants.create 的形状对，再提交同一份 dub 参数', async () => {
    const session = new RuntimeSession({} as HostBridge);
    const calls: Array<[string, unknown]> = [];
    let starts = 0;
    vi.spyOn(session.client, 'request').mockImplementation((async (method: string, body: unknown) => {
      calls.push([method, body]);
      if (method === 'pipelines.start' && starts++ === 0) throw refused('elevenlabs');
      if (method === 'grants.create') return { grant: { grantId: 'g1' } };
      return { jobId: 'p1' };
    }) as never);
    bindDub({ runtime: session, toast: () => {} });

    expect(await startDub(params, intent)).toBeNull();
    expect(calls[0]).toEqual([
      'pipelines.start',
      {
        pipeline: 'dub',
        params: { videoId: 'vid', translationId: 't-en', provider: 'elevenlabs', model: 'eleven', originalAudio: 'mute' },
        commandId: expect.stringMatching(/^cmd_/),
      },
    ]);
    const asked = useDubRun.getState().asks.vid!;
    expect(asked).toMatchObject({
      status: 'asking',
      purpose: '翻译配音：把「访谈」配成英语',
      refusal: { recipient: 'elevenlabs', hint: '数据外发要用户授权' },
    });
    expect(useDubRun.getState().runs.vid).toBeUndefined();
    // 还没确认：没有发授权。
    expect(calls.map(([m]) => m)).toEqual(['pipelines.start']);

    expect(await confirmGrant('vid')).toBe('p1');
    expect(calls[1]).toEqual([
      'grants.create',
      {
        dataKinds: ['transcript'],
        recipient: 'elevenlabs',
        scope: { videoId: 'vid' },
        purpose: '翻译配音：把「访谈」配成英语',
        budgetMode: 'per-call-unknown-cost',
      },
    ]);
    expect(calls[1]![1]).not.toHaveProperty('budgetCap');
    expect(calls[2]![0]).toBe('pipelines.start');
    expect((calls[2]![1] as { params: unknown }).params).toEqual((calls[0]![1] as { params: unknown }).params);
    expect(useDubRun.getState().asks.vid).toBeUndefined();
    expect(useDubRun.getState().runs.vid).toMatchObject({ jobId: 'p1', status: 'running' });
  });

  it('翻译与合成交给不同服务商：连着问两轮；同一接收方发过还被拒时报错，不循环', async () => {
    const { deps } = fake();
    const answers = [refused('elevenlabs'), refused('openai'), refused('openai')];
    deps.runtime.startDub = vi.fn(async () => {
      throw answers.shift()!;
    });
    bindDub(deps);
    await startDub(params, intent);
    await confirmGrant('vid');
    expect(useDubRun.getState().asks.vid).toMatchObject({ refusal: { recipient: 'openai' }, granted: ['elevenlabs|transcript'] });
    await confirmGrant('vid');
    expect(deps.runtime.createGrant).toHaveBeenCalledTimes(2);
    expect(useDubRun.getState().asks.vid).toBeUndefined();
    expect(useDubRun.getState().problems.vid).toMatchObject({ kind: 'failed', title: '发放了授权仍被拒绝' });
    expect(deps.runtime.startDub).toHaveBeenCalledTimes(3);
  });

  it('发放失败：留在询问上写明原因，不重新提交', async () => {
    const { deps } = fake();
    deps.runtime.startDub = vi.fn(async () => {
      throw refused('elevenlabs');
    });
    deps.runtime.createGrant = vi.fn(async () => {
      throw new Error('写不进去');
    });
    bindDub(deps);
    await startDub(params, intent);
    expect(await confirmGrant('vid')).toBeNull();
    expect(useDubRun.getState().asks.vid).toMatchObject({ status: 'asking', error: '没能发放授权：写不进去' });
    expect(deps.runtime.startDub).toHaveBeenCalledTimes(1);
  });

  it('没有配置语音合成：就地给提示与去模型页的路', async () => {
    const { deps } = fake();
    deps.runtime.startDub = vi.fn(async () => {
      throw new RpcError('conflict', '没有可用的语音合成', {
        code: 'CAPABILITY_NOT_CONFIGURED',
        capability: 'synthesizeSpeech',
        reason: 'missing-credential',
        providerId: 'elevenlabs',
        remedy: { action: 'configure-provider', capability: 'synthesizeSpeech', providerId: 'elevenlabs', hint: '在模型页填密钥。' },
      });
    });
    bindDub(deps);
    expect(await startDub(params, intent)).toBeNull();
    expect(useDubRun.getState().problems.vid).toMatchObject({
      kind: 'not-configured',
      message: '在模型页填密钥。',
      remedy: { target: { tab: 'models', category: 'tts', page: 'cloud' } },
    });
  });
});

describe('收尾', () => {
  it('完成：读摘要留收据，提示带撤销；同一个视频同时只配一次', async () => {
    const { deps, toasts } = fake();
    bindDub(deps);
    expect(await startDub(params, intent)).toBe('p1');
    expect(await startDub(params, intent)).toBeNull();
    const done = job('completed', { warnings: [{ code: 'DUB_VOICE_UNAVAILABLE', detail: '1 句没合成' }] });
    done.pipeline!.summary = summary as unknown as Record<string, unknown>;
    useJobs.setState({ jobs: [done] });
    await flush();
    const receipt = useDubRun.getState().receipts.vid!;
    expect(receipt).toMatchObject({ jobId: 'p1', duckDb: 12, undone: null, summary: { planDocumentId: 'plan', units: { placed: 2 } } });
    expect(receipt.warnings.map((w) => w.code)).toEqual(['DUB_VOICE_UNAVAILABLE']);
    expect(useDubRun.getState().runs.vid).toBeUndefined();
    expect(toasts).toEqual([['positive', '已配成英语 · 2 句放上时间线', true]]);
  });

  it('合成失败：给逐句事实、补救与「重试」（已合成的复用）；重试被授权拒绝时同样询问，不发就留着重试', async () => {
    const { deps } = fake();
    bindDub(deps);
    await startDub(params, intent);
    const failed = job('failed', {
      stoppedAt: 'synthesize',
      error: {
        code: 'DUB_SYNTHESIS_FAILED',
        message: '1 句合成失败',
        details: { failed: [{ unitId: 'u2', code: 'PROVIDER_ERROR', message: '超时' }], synthesized: 2, remaining: 0 },
      },
    });
    useJobs.setState({ jobs: [failed] });
    await flush();
    expect(useDubRun.getState().problems.vid).toMatchObject({
      kind: 'failed',
      title: '配音失败',
      retry: { jobId: 'p1', note: 'partial' },
      facts: { failed: [{ unitId: 'u2' }], synthesized: 2 },
    });

    deps.runtime.retryPipeline = vi.fn(async () => {
      throw refused('elevenlabs', 'GRANT_REVOKED');
    });
    await retryDub('vid');
    expect(deps.runtime.retryPipeline).toHaveBeenCalledWith('p1');
    expect(useDubRun.getState().asks.vid).toMatchObject({ resume: { kind: 'retry', jobId: 'p1' }, refusal: { code: 'GRANT_REVOKED' } });
    dismissAsk('vid');
    expect(useDubRun.getState().asks.vid).toBeUndefined();
    expect(useDubRun.getState().problems.vid?.retry).toMatchObject({ jobId: 'p1', note: 'partial' });
  });

  it('跑到一半授权被撤销：失败的任务也出询问，确认后发授权并重试同一个任务', async () => {
    const { deps } = fake();
    bindDub(deps);
    await startDub(params, intent);
    const revoked = job('failed', {
      stoppedAt: 'synthesize',
      error: { code: 'GRANT_REVOKED', message: '授权已撤销', details: refused('elevenlabs', 'GRANT_REVOKED').details },
    });
    useJobs.setState({ jobs: [revoked] });
    await flush();
    expect(useDubRun.getState().asks.vid?.resume).toMatchObject({ kind: 'retry', jobId: 'p1' });
    expect(await confirmGrant('vid')).toBe('p1');
    expect(deps.runtime.createGrant).toHaveBeenCalledTimes(1);
    expect(deps.runtime.retryPipeline).toHaveBeenCalledWith('p1');
    expect(useDubRun.getState().runs.vid).toMatchObject({ status: 'running', retriedAt: 'u1' });
  });

  it('取消：不留问题，给一句提示', async () => {
    const { deps, toasts } = fake();
    bindDub(deps);
    await startDub(params, intent);
    await cancelDub('p1');
    expect(deps.runtime.cancelJob).toHaveBeenCalledWith('p1');
    useJobs.setState({ jobs: [job('cancelled')] });
    await flush();
    expect(useDubRun.getState().problems.vid).toBeUndefined();
    expect(toasts).toEqual([['neutral', '已取消配音', false]]);
  });
});

describe('撤销这组配音', () => {
  async function completed(deps: DubDeps) {
    bindDub(deps);
    await startDub(params, intent);
    const done = job('completed');
    done.pipeline!.summary = summary as unknown as Record<string, unknown>;
    useJobs.setState({ jobs: [done] });
    await flush();
  }

  it('撤掉应用配音的那一笔（配音计划最早版本的 createdBy）', async () => {
    const { deps, applied } = fake();
    await completed(deps);
    await undoDub('vid');
    expect(deps.runtime.videos.undo).toHaveBeenCalledWith({ transaction: 'tx-apply' });
    expect(applied).toEqual([]);
    expect(useDubRun.getState().receipts.vid).toMatchObject({ undone: 'full', undoing: false });
  });

  it('撤不了那一笔（之后又改过）：一笔事务删掉这一组的实例、恢复这次静音的，清掉撤销失败的错误', async () => {
    const { deps, applied } = fake();
    deps.runtime.videos.undo = vi.fn(async () => {
      useVideo.getState().update({ commandError: { message: '之后又改过', code: 'UNDO_CONFLICT' } });
      return null;
    });
    await completed(deps);
    await undoDub('vid');
    expect(deps.runtime.readDocument).toHaveBeenCalledWith('vid', 'plan');
    expect(applied).toEqual([
      [
        { type: 'deleteItems', sequenceId: 'seq', itemIds: ['d1'] },
        { type: 'setAudioMix', sequenceId: 'seq', itemId: 'clip', muted: false },
      ],
    ]);
    expect(deps.runtime.videos.clearError).toHaveBeenCalled();
    expect(useDubRun.getState().receipts.vid).toMatchObject({ undone: 'partial', undoing: false });
  });
});

describe('先下载分离模型再开始', () => {
  const install = (state: JobRecord['state'], jobId = 'inst1'): JobRecord => ({ ...job(state), jobId, kind: 'modelInstall', videoId: null });
  const separated: DubParams = { ...params, separateBackground: true };

  it('下载任务完成就用同一份参数开始；还在下时不动', async () => {
    const { deps } = fake();
    bindDub(deps);
    awaitDubInstall('inst1', separated, intent);
    expect(useDubRun.getState().installs.vid?.jobId).toBe('inst1');

    useJobs.setState({ jobs: [install('running')] });
    expect(deps.runtime.startDub).not.toHaveBeenCalled();
    useJobs.setState({ jobs: [install('completed')] });
    await flush();
    expect(deps.runtime.startDub).toHaveBeenCalledTimes(1);
    expect(deps.runtime.startDub).toHaveBeenCalledWith(separated);
    expect(useDubRun.getState().installs.vid).toBeUndefined();
    expect(useDubRun.getState().runs.vid?.jobId).toBe('p1');
  });

  it('下载失败或取消：不开始，提示一句（取消不报错）', async () => {
    const { deps, toasts } = fake();
    bindDub(deps);
    awaitDubInstall('inst1', separated, intent);
    useJobs.setState({ jobs: [install('failed')] });
    awaitDubInstall('inst2', separated, intent);
    useJobs.setState({ jobs: [install('failed'), install('cancelled', 'inst2')] });
    await flush();
    expect(deps.runtime.startDub).not.toHaveBeenCalled();
    expect(useDubRun.getState().installs).toEqual({});
    expect(toasts).toEqual([
      ['negative', DUB_COPY.separateDownloadStopped, false],
      ['neutral', DUB_COPY.separateDownloadStopped, false],
    ]);
  });
});
