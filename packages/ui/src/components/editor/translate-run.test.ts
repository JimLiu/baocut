import { DEFAULT_CAPTION_STYLE } from '../../model/property-values.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RpcError,
  type DocumentRecord,
  type EditOperation,
  type JobRecord,
  type PipelineCaptionsSummary,
  type PipelineStepState,
  type Sequence,
  type TransactionReceipt,
  type VideoItem,
  type VideoSnapshot,
} from '@baocut/protocol';
import type { HostBridge } from '../../host.ts';
import { readSpeechWords } from '../../model/speech-cues.ts';
import { pairRows, readTranslation, speechSentences } from '../../model/translation-doc.ts';
import { RuntimeSession } from '../../runtime/session.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import { resetTranscribe, useSubtitleRun } from './transcribe-run.ts';
import {
  bindTranslate,
  editTranslation,
  putOnScreen,
  resetTranslate,
  retryTranslate,
  startTranslate,
  undoReceipt,
  useTranslateRun,
  type TranslateDeps,
  type TranslateProblem,
} from './translate-run.ts';

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

const speechRecord: DocumentRecord = {
  id: 'speech',
  kind: 'speech',
  name: '访谈 转写',
  language: 'zh',
  sourceAssetId: 'asset',
  currentRevision: 'r1',
  revisions: {},
};
const speechBody = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  speakers: [],
  sentences: null,
  words: [
    { id: 'w1', start: 0, end: 400, text: '你好' },
    { id: 'w2', start: 400, end: 900, text: '世界。' },
    { id: 'w3', start: 3000, end: 3500, text: '再见。' },
  ],
};

const unit = (id: string, sentence: string, words: string[], text: string) => ({
  id,
  sourceSentenceId: sentence,
  sourceFingerprint: 'sha256:x',
  naturalText: text,
  alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: words, textHash: 'sha256:y' },
  status: 'draft',
});
const translationBody = {
  schema: 'baocut.translation/2',
  language: 'en',
  sourceBasis: { speechRef: { id: 'speech', revision: 'r1' }, sequenceId: 'seq', scopeLineage: [], editViewHash: '' },
  units: [unit('t-s-w1', 's-w1', ['w1', 'w2'], 'Hello world.'), unit('t-s-w3', 's-w3', ['w3'], 'Goodbye.')],
};
const translationRecord: DocumentRecord = {
  id: 'tr',
  kind: 'translation',
  name: '译文 en',
  language: 'en',
  sourceDocumentId: 'speech',
  currentRevision: '1',
  revisions: { '1': { revision: '1', contentHash: '', byteLength: 0, createdAt: '', createdBy: 'tx', summary: { unitCount: 2, sourceRevision: 'r1' } } },
} as DocumentRecord;

function open(videoId: string, documents: Record<string, DocumentRecord> = {}, items: Sequence['items'] = sequence.items): void {
  const video = {
    id: videoId,
    revision: '1',
    rootSequenceId: 'seq',
    sequences: { seq: { ...sequence, items } },
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

const step = (name: string, status: PipelineStepState['status']): PipelineStepState => ({
  name,
  label: name,
  status,
  jobId: null,
  attempts: 1,
  output: null,
});

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
    providerId: 'openai',
    modelId: 'gpt-5',
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
      name: 'translate',
      params: { videoId: 'vid', documentId: 'speech', targetLanguage: 'en' },
      steps: [step('freeze-source', 'completed'), step('translate', stoppedAt === 'translate' ? 'failed' : 'completed'), step('assemble', 'completed'), step('write', 'completed')],
      current: null,
      stoppedAt,
      summary: null,
    },
    ...rest,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const created: PipelineCaptionsSummary = {
  status: 'created',
  documentId: 'cap-en',
  cueCount: 2,
  enabled: true,
  bilingual: true,
  transactionId: 'tx-cap',
};

/** 翻译流程完成时的摘要；`captions` 不给时是没有这一步的旧记录。 */
const summary = (captions?: PipelineCaptionsSummary) =>
  ({
    videoId: 'vid',
    documentId: 'tr',
    source: { documentId: 'speech', revision: 'r1' },
    targetLanguage: 'en',
    unitCount: 2,
    providerId: 'openai',
    modelId: 'gpt-5',
    ...(captions ? { captions } : {}),
  }) as unknown as Record<string, unknown>;

function fake() {
  const applied: EditOperation[][] = [];
  const toasts: Array<[string, string, boolean]> = [];
  const bodies: Record<string, { document: DocumentRecord; revision: string; body: unknown }> = {
    tr: { document: translationRecord, revision: '1', body: translationBody },
    speech: { document: speechRecord, revision: 'r1', body: speechBody },
  };
  let next = 0;
  const deps: TranslateDeps = {
    runtime: {
      startTranslate: vi.fn(async () => `p${++next}`),
      retryPipeline: vi.fn(async () => {}),
      cancelJob: vi.fn(async () => {}),
      readDocument: vi.fn(async (_videoId: string, documentId: string) => {
        const found = bodies[documentId];
        if (!found) throw new Error(`没有 ${documentId}`);
        return found;
      }),
      videos: {
        apply: vi.fn(async (operations: EditOperation[]) => {
          applied.push(operations);
          return { transactionId: `tx${applied.length}`, refs: { 'translation-caption': 'cap-en' } } as unknown as TransactionReceipt;
        }),
        undo: vi.fn(async () => ({ transactionId: 'undo' }) as unknown as TransactionReceipt),
      },
    },
    toast: (kind, message, undo) => toasts.push([kind, message, !!undo]),
  };
  return { deps, applied, toasts, bodies };
}

const setup = {
  videoId: 'vid',
  speechDocumentId: 'speech',
  targetLanguage: 'en',
  style: '',
  model: { providerId: 'openai', modelId: 'gpt-5' },
  bilingual: true,
};

beforeEach(() => {
  resetTranslate();
  resetTranscribe();
  useJobs.setState({ ready: true, jobs: [] });
  open('vid', { speech: speechRecord });
});
afterEach(() => {
  resetTranslate();
  resetTranscribe();
});

describe('提交翻译', () => {
  it('走真的会话：pipelines.start 收到流程名、只含流程认得的键的参数与 commandId', async () => {
    const session = new RuntimeSession({} as HostBridge);
    const calls: Array<[string, unknown]> = [];
    vi.spyOn(session.client, 'request').mockImplementation((async (method: string, params: unknown) => {
      calls.push([method, params]);
      return { jobId: 'p1' };
    }) as never);
    bindTranslate({ runtime: session, toast: () => {} });
    expect(await startTranslate({ ...setup, style: ' 口语 ' })).toBe(true);
    expect(calls).toHaveLength(1);
    const [method, params] = calls[0]!;
    expect(method).toBe('pipelines.start');
    expect(params).toEqual({
      pipeline: 'translate',
      params: {
        videoId: 'vid',
        documentId: 'speech',
        targetLanguage: 'en',
        style: '口语',
        provider: 'openai',
        model: 'gpt-5',
        // 字幕层由流程建，双语照用户选的。
        captions: true,
        bilingual: true,
        captionStyle: DEFAULT_CAPTION_STYLE,
      },
      commandId: expect.stringMatching(/^cmd_/),
    });
    expect(useTranslateRun.getState().runs.vid).toMatchObject({ jobId: 'p1', status: 'running', targetLanguage: 'en' });
    // 同一个视频同时只翻一门。
    expect(await startTranslate({ ...setup, targetLanguage: 'ja' })).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('没有配置文本模型：提交被拒，就地给原因、提示与去模型页的路，不留运行态', async () => {
    const { deps } = fake();
    deps.runtime.startTranslate = vi.fn(async () => {
      throw new RpcError('conflict', '没有可用的文本模型', {
        code: 'CAPABILITY_NOT_CONFIGURED',
        capability: 'generateText',
        reason: 'missing-credential',
        providerId: 'openai',
        remedy: { action: 'configure-provider', capability: 'generateText', providerId: 'openai', hint: '在模型页填 OpenAI 的密钥。' },
      });
    });
    bindTranslate(deps);
    expect(await startTranslate(setup)).toBe(false);
    const state = useTranslateRun.getState();
    expect(state.runs.vid).toBeUndefined();
    expect(state.problems.vid).toMatchObject({
      kind: 'not-configured',
      title: '还不能翻译 · 文本模型的服务商还没有填密钥',
      message: '在模型页填 OpenAI 的密钥。',
      remedy: { target: { tab: 'models' } },
      retry: null,
    });
  });
});

describe('翻译完成', () => {
  it('流程建了字幕层：照 summary.captions 留收据（撤销按那笔事务），列表对照它、选中新的那层；编辑器不再自己写；后面的事件不会再收一次', async () => {
    const { deps, applied } = fake();
    bindTranslate(deps);
    await startTranslate(setup);

    const done = (updatedAt: string) =>
      job('completed', {
        result: { documentId: 'tr', artifactId: 'a' },
        updatedAt,
        pipeline: { ...job('completed').pipeline!, summary: summary(created) },
      });
    useJobs.setState({ jobs: [done('u1')] });
    await flush();
    useJobs.setState({ jobs: [done('later')] });
    await flush();

    expect(applied).toEqual([]);
    expect(deps.runtime.readDocument).not.toHaveBeenCalled();
    const state = useTranslateRun.getState();
    expect(state.runs.vid).toBeUndefined();
    expect(state.problems.vid).toBeUndefined();
    expect(state.receipts.vid).toEqual({
      transactionId: 'tx-cap',
      language: 'English',
      translationDocumentId: 'tr',
      count: 2,
      bilingual: true,
      undone: false,
    });
    expect(state.compare.vid).toEqual({ mode: 'bi', documentId: 'tr' });
    expect(useSubtitleRun.getState().focus.vid).toBe('cap-en');

    await undoReceipt('vid');
    expect(deps.runtime.videos.undo).toHaveBeenCalledWith({ transaction: 'tx-cap' });
  });

  it('没建字幕层：投不到画面上、流程没建时留一句去对照列表放；没有可显示的句子如实说', async () => {
    const { deps, applied } = fake();
    bindTranslate(deps);
    const cases: Array<[PipelineCaptionsSummary | undefined, Partial<TranslateProblem>]> = [
      [
        { status: 'not-on-timeline', documentId: null, cueCount: null, enabled: null },
        { kind: 'pending', message: expect.stringContaining('时间线上没有') },
      ],
      [undefined, { kind: 'pending', title: '译文已完成，还没放到画面上' }],
      [
        { status: 'empty', documentId: null, cueCount: null, enabled: null },
        { kind: 'empty', title: '译文没有可以放到画面上的句子' },
      ],
    ];
    for (const [n, [captions, problem]] of cases.entries()) {
      await startTranslate(setup);
      const jobId = `p${n + 1}`;
      useJobs.setState({
        jobs: [
          job('completed', {
            jobId,
            result: { documentId: 'tr', artifactId: 'a' },
            pipeline: { ...job('completed').pipeline!, summary: summary(captions) },
          }),
        ],
      });
      await flush();
      expect(useTranslateRun.getState().runs.vid).toBeUndefined();
      expect(useTranslateRun.getState().receipts.vid).toBeUndefined();
      expect(useTranslateRun.getState().problems.vid).toMatchObject(problem);
    }
    expect(applied).toEqual([]);
  });

  it('收据上的撤销：撤掉放到画面上的那一笔；撤不了时如实说', async () => {
    const { deps, toasts } = fake();
    bindTranslate(deps);
    useTranslateRun.setState({
      receipts: { vid: { transactionId: 'tx9', language: 'English', translationDocumentId: 'tr', count: 2, bilingual: true, undone: false } },
    });
    await undoReceipt('vid');
    expect(deps.runtime.videos.undo).toHaveBeenCalledWith({ transaction: 'tx9' });
    expect(useTranslateRun.getState().receipts.vid?.undone).toBe(true);

    useTranslateRun.setState({
      receipts: { vid: { transactionId: 'tx10', language: 'English', translationDocumentId: 'tr', count: 2, bilingual: true, undone: false } },
    });
    deps.runtime.videos.undo = vi.fn(async () => null);
    await undoReceipt('vid');
    expect(useTranslateRun.getState().receipts.vid?.undone).toBe(false);
    expect(toasts.at(-1)?.[0]).toBe('negative');
  });

  it('已经在视频里的译文：放到画面上，提示带撤销', async () => {
    const { deps, applied, toasts } = fake();
    bindTranslate(deps);
    open('vid', { speech: speechRecord, tr: translationRecord });
    await putOnScreen('vid', 'tr', false);
    expect(applied).toHaveLength(1);
    expect(toasts).toEqual([['positive', '已把English译文放到画面上 · 2 条字幕', true]]);
    expect(useSubtitleRun.getState().focus.vid).toBe('cap-en');
  });
});

describe('失败、中断与重试', () => {
  it('停在翻译这一步：给原因与重试，说明会再计费；重试同一个任务，旧记录不会被当成结果再收一次', async () => {
    const { deps, applied } = fake();
    bindTranslate(deps);
    await startTranslate(setup);
    const failed = job('failed', { stoppedAt: 'translate', error: { code: 'MODEL_OUTPUT_INVALID', message: '模型回的不是合法的 JSON' } });
    useJobs.setState({ jobs: [failed] });
    await flush();
    expect(useTranslateRun.getState().runs.vid).toBeUndefined();
    expect(useTranslateRun.getState().problems.vid).toMatchObject({
      kind: 'failed',
      title: '翻译失败',
      message: '模型回的不是合法的 JSON',
      retry: { jobId: 'p1', note: 'charges', intent: { targetLanguage: 'en', bilingual: true } },
    });

    await retryTranslate('vid');
    expect(deps.runtime.retryPipeline).toHaveBeenCalledWith('p1');
    expect(useTranslateRun.getState().runs.vid).toMatchObject({ jobId: 'p1', status: 'running', retriedAt: 'u1' });
    expect(useTranslateRun.getState().problems.vid).toBeUndefined();
    // 别的任务的事件进来，镜像里还是那条失败的旧记录：不收尾。
    useJobs.setState({ jobs: [failed, job('running', { jobId: 'other', kind: 'transcribe', pipeline: undefined })] });
    await flush();
    expect(useTranslateRun.getState().runs.vid?.status).toBe('running');
    expect(useTranslateRun.getState().problems.vid).toBeUndefined();

    // 重跑起来、做完了（字幕层由流程建）：留收据。
    useJobs.setState({ jobs: [job('running', { updatedAt: 'u2' })] });
    await flush();
    useJobs.setState({
      jobs: [
        job('completed', {
          updatedAt: 'u3',
          result: { documentId: 'tr', artifactId: 'a' },
          pipeline: { ...job('completed').pipeline!, summary: summary(created) },
        }),
      ],
    });
    await flush();
    expect(applied).toEqual([]);
    expect(useTranslateRun.getState().receipts.vid).toMatchObject({ translationDocumentId: 'tr', transactionId: 'tx-cap' });
  });

  it('中断与取消：中断的给重试（停在翻译之后不再调模型）；取消的只提示一句', async () => {
    const { deps, toasts } = fake();
    bindTranslate(deps);
    await startTranslate(setup);
    useJobs.setState({ jobs: [job('interrupted', { stoppedAt: 'write', error: { code: 'INTERRUPTED', message: 'Runtime 重启了' } })] });
    await flush();
    expect(useTranslateRun.getState().problems.vid).toMatchObject({ title: '翻译中断了', retry: { note: 'free' } });

    await startTranslate(setup);
    expect(useTranslateRun.getState().problems.vid).toBeUndefined();
    useJobs.setState({ jobs: [job('cancelled', { jobId: 'p2' })] });
    await flush();
    expect(useTranslateRun.getState().runs.vid).toBeUndefined();
    expect(useTranslateRun.getState().problems.vid).toBeUndefined();
    expect(toasts.at(-1)).toEqual(['neutral', '已取消翻译', false]);
  });
});

describe('改一句译文', () => {
  it('一笔事务：译文文档的新版本连同从它生成的字幕里这一句的几条；别的条不动', async () => {
    const { deps, applied, toasts, bodies } = fake();
    bindTranslate(deps);
    const captionRecord = {
      id: 'cap-en',
      kind: 'caption',
      name: 'English',
      language: 'en',
      sourceDocumentId: 'tr',
      currentRevision: '1',
      revisions: { '1': { revision: '1', contentHash: '', byteLength: 0, createdAt: '', createdBy: 'tx', summary: { cueCount: 2 } } },
      extensions: { 'baocut.translationCues': { translationDocumentId: 'tr' } },
    } as unknown as DocumentRecord;
    bodies['cap-en'] = {
      document: captionRecord,
      revision: '1',
      body: {
        schema: 'baocut.caption/1',
        clock: 'source-asset',
        timescale: 1000,
        cues: [
          { id: 'q-t-s-w1', start: 0, end: 900, text: 'Hello world.' },
          { id: 'q-t-s-w3', start: 3000, end: 3500, text: '手改过的 Goodbye.' },
        ],
      },
    };
    const sentences = speechSentences(speechBody)!;
    const body = readTranslation(translationBody)!;
    // 指纹对上现在的原句，配对出来是正常的两句。
    body.units = body.units.map((u, i) => ({ ...u, sourceFingerprint: sentences[i]!.fingerprint }));
    const rows = pairRows(sentences, body);
    const documents = { speech: speechRecord, tr: translationRecord, 'cap-en': captionRecord };

    const next = await editTranslation({
      videoId: 'vid',
      record: translationRecord,
      body,
      sentences,
      row: rows[0]!,
      text: 'Hi there, world.',
      speech: readSpeechWords(speechBody)!,
      documents,
    });
    expect(next?.units[0]).toMatchObject({ naturalText: 'Hi there, world.', status: 'reviewed' });
    expect(applied).toHaveLength(1);
    const [translationPut, captionPut] = applied[0]! as Array<Extract<EditOperation, { type: 'putDocument' }>>;
    expect(translationPut).toMatchObject({ documentId: 'tr', kind: 'translation', summary: { unitCount: 2, sourceRevision: 'r1' } });
    expect(captionPut).toMatchObject({
      documentId: 'cap-en',
      kind: 'caption',
      summary: { cueCount: 2 },
      body: {
        cues: [
          { id: 'q-t-s-w1', start: 0, end: 900, text: 'Hi there, world.' },
          { id: 'q-t-s-w3', text: '手改过的 Goodbye.' },
        ],
      },
    });
    expect(toasts).toEqual([['positive', '已改写这一句译文', true]]);

    // 文字没变：不写。
    expect(
      await editTranslation({
        videoId: 'vid',
        record: translationRecord,
        body,
        sentences,
        row: rows[1]!,
        text: ' Goodbye. ',
        speech: readSpeechWords(speechBody)!,
        documents,
      }),
    ).toBeNull();
    expect(applied).toHaveLength(1);
  });
});
