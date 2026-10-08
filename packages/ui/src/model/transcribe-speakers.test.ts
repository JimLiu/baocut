import { describe, expect, it } from 'vitest';
import type { JobRecord, ModelCapabilitiesView } from '@baocut/protocol';
import { bundle, fixtureView, transcribeModel } from './models-test-fixtures.ts';
import {
  diarizeStepOf,
  speakerCopy,
  speakerGateLine,
  speakerPackFacts,
  speakerPackId,
  speakerPackInstalled,
  speakerSwitch,
  transcribeJobOf,
} from './transcribe-speakers.ts';

const PACK = 'speaker-diarization@mlx';
const moss = transcribeModel('moss-transcribe@mlx', { speakers: 'native' });
const qwen = transcribeModel('qwen3-asr-0.6b@mlx-4bit', { speakers: 'none', diarizationPack: PACK });
const qwenWithPack = { ...qwen, speakers: 'pack' as const };
const online = transcribeModel('gpt-4o-transcribe');
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

describe('识别说话人的开关', () => {
  it('模型自带区分时开着锁住、不单列一步；不区分的关着锁住', () => {
    expect(speakerSwitch(moss, false, false)).toEqual({ kind: 'builtin', on: true, locked: true, missing: false, step: false });
    expect(speakerSwitch(online, true, true)).toEqual({ kind: 'none', on: false, locked: true, missing: false, step: false });
    expect(speakerSwitch(null, null, false).kind).toBe('none');
    expect(speakerPackId(moss)).toBeNull();
    expect(speakerPackId(online)).toBeNull();
    expect(speakerPackId(qwen)).toBe(PACK);
  });

  it('要模型包的：装了默认开，没装默认关；用户拨过的值优先，开着没装要先下载', () => {
    expect(speakerSwitch(qwenWithPack, null, true)).toEqual({ kind: 'pack', on: true, locked: false, missing: false, step: true });
    expect(speakerSwitch(qwen, null, false)).toEqual({ kind: 'pack', on: false, locked: false, missing: false, step: false });
    expect(speakerSwitch(qwen, true, false)).toEqual({ kind: 'pack', on: true, locked: false, missing: true, step: true });
    expect(speakerSwitch(qwenWithPack, false, true)).toEqual({ kind: 'pack', on: false, locked: false, missing: false, step: false });
  });

  it('装没装看模型包的组件；这台电脑没列出模型包时看模型描述', () => {
    const installed = bundle(PACK, {
      capability: 'diarize',
      components: [{ component: 'segmentation', repo: 'a/b', revision: 'r', state: 'installed', bytes: 1, sharedWith: [] }],
    });
    const missing = bundle(PACK, {
      capability: 'diarize',
      state: 'not-installed',
      components: [{ component: 'segmentation', repo: 'a/b', revision: 'r', state: 'missing', bytes: null, sharedWith: [] }],
    });
    expect(speakerPackInstalled(qwen, installed)).toBe(true);
    expect(speakerPackInstalled(qwenWithPack, missing)).toBe(false);
    expect(speakerPackInstalled(qwenWithPack, null)).toBe(true);
    expect(speakerPackInstalled(qwen, null)).toBe(false);
  });

  it('开关下面那一句与折叠标题上的状态；体积只在知道时写', () => {
    const pack = speakerPackFacts(
      bundle(PACK, {
        capability: 'diarize',
        label: '说话人区分',
        install: { jobId: null, state: 'paused', receivedBytes: 0, totalBytes: 34 * 1024 * 1024 },
      }),
      mb,
    );
    expect(pack).toEqual({ name: '说话人区分', size: '34 MB' });
    expect(speakerPackFacts(null, mb)).toEqual({ name: '说话人区分', size: null });
    // 没有下载计划时用随附清单估的体积。
    const estimated = bundle(PACK, { capability: 'diarize', label: '说话人区分', estimatedBytes: 31 * 1024 * 1024 });
    expect(speakerPackFacts(estimated, mb).size).toBe('31 MB');
    // 有组件信息时只算缺的（权重在、缺公共组件的只写缺的那一件）。
    const half = bundle(PACK, {
      capability: 'diarize',
      state: 'not-installed',
      estimatedBytes: 31 * 1024 * 1024,
      components: [
        { component: 'speaker', repo: 'pyannote/embedding', revision: 'r', state: 'installed', bytes: 28 * 1024 * 1024, sharedWith: [] },
        { component: 'segmentation', repo: 'pyannote/seg', revision: 'r', state: 'missing', bytes: null, estimatedBytes: 3 * 1024 * 1024, sharedWith: [] },
      ],
    });
    expect(speakerPackFacts(half, mb).size).toBe('3 MB');
    expect(speakerCopy(speakerSwitch(moss, null, false), 'MOSS Transcribe', pack)).toEqual({
      note: 'MOSS Transcribe 自带说话人区分，转录时一起完成',
      summary: '识别说话人 · 模型自带',
    });
    expect(speakerCopy(speakerSwitch(online, null, false), 'gpt-4o-transcribe', pack).summary).toBe('不识别说话人');
    expect(speakerCopy(speakerSwitch(qwen, true, false), 'Qwen3-ASR', pack)).toEqual({
      note: '要先下载「说话人区分」（34 MB），下完才能区分说话人',
      summary: '识别说话人 · 要先下载模型',
    });
    expect(speakerCopy(speakerSwitch(qwen, true, false), 'Qwen3-ASR', { name: '说话人区分', size: null }).note).toBe(
      '要先下载「说话人区分」，下完才能区分说话人',
    );
    expect(speakerCopy(speakerSwitch(qwenWithPack, null, true), 'Qwen3-ASR', pack).summary).toBe('识别说话人');
    expect(speakerCopy(speakerSwitch(qwenWithPack, false, true), 'Qwen3-ASR', pack)).toEqual({
      note: '不区分说话人，字幕与文稿不标名字',
      summary: '不识别说话人',
    });
    expect(speakerGateLine(pack, undefined)).toBe('说话人区分 · 34 MB');
    expect(speakerGateLine({ name: '说话人区分', size: null }, undefined)).toBe('说话人区分');
    expect(speakerGateLine(pack, 40)).toBe('正在下载「说话人区分」· 40%');
    expect(speakerGateLine(pack, null)).toBe('正在下载「说话人区分」…');
  });
});

describe('运行里的「识别说话人」一步', () => {
  const view = (): ModelCapabilitiesView => {
    const v = fixtureView();
    v.transcribe.providers[0]!.models = [qwen, moss];
    return v;
  };
  const run = (params: Record<string, unknown>, name = 'transcribe') =>
    ({
      jobId: 'job_1',
      kind: 'pipeline',
      pipeline: { name, params, steps: [], current: null, stoppedAt: null, summary: null },
    }) as unknown as JobRecord;
  const asr = (modelId: string, createdAt = '2026-10-01T00:00:00Z', jobId = 'job_t') =>
    ({ jobId, kind: 'transcribe', providerId: 'local', modelId, createdAt, submitter: { kind: 'pipeline', id: 'job_1' } }) as JobRecord;

  it('只在 diarize: true 且由模型包来区分时单列', () => {
    const v = view();
    expect(diarizeStepOf(run({ diarize: true, provider: 'local', model: qwen.modelId }), [], v)).toBe(true);
    expect(diarizeStepOf(run({ diarize: true, provider: 'local', model: moss.modelId }), [], v)).toBe(false);
    expect(diarizeStepOf(run({ diarize: false, provider: 'local', model: qwen.modelId }), [], v)).toBe(false);
    expect(diarizeStepOf(run({ provider: 'local', model: qwen.modelId }), [], v)).toBe(false);
    expect(diarizeStepOf(run({ diarize: true, provider: 'local', model: qwen.modelId }, 'translate'), [], v)).toBe(false);
    expect(diarizeStepOf(run({ diarize: true, provider: 'local', model: qwen.modelId }), [], null)).toBe(false);
  });

  it('模型先看转写任务记下的，再看冻结的参数，最后是生效的默认值', () => {
    const v = view();
    expect(diarizeStepOf(run({ diarize: true, provider: 'local', model: qwen.modelId }), [asr(moss.modelId)], v)).toBe(false);
    expect(diarizeStepOf(run({ diarize: true }), [], v)).toBe(true);
    const jobs = [asr(moss.modelId, '2026-10-01T00:00:00Z', 'a'), asr(qwen.modelId, '2026-10-02T00:00:00Z', 'b')];
    expect(transcribeJobOf('job_1', jobs)?.jobId).toBe('b');
    expect(transcribeJobOf('job_2', jobs)).toBeNull();
  });
});
