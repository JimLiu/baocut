import { describe, expect, it } from 'vitest';
import {
  DUBBING_PLAN_SCHEMA,
  DUB_EXTENSION,
  audioStart,
  dubOperations,
  dubPipeline,
  parseDubParams,
  stemProblems,
  type DubDeps,
} from './dub.ts';
import { TRANSLATION_SCHEMA } from './translation-document.ts';

describe('翻译配音的参数', () => {
  it('targetLanguage 与 translationId 至少给一个；原声处理与压低的 dB 检查取值', () => {
    expect(parseDubParams({ videoId: 'vid_1', targetLanguage: 'en', voice: 'library:voice_1' })).toEqual({
      videoId: 'vid_1',
      targetLanguage: 'en',
      voice: 'library:voice_1',
    });
    expect(
      parseDubParams({ videoId: 'vid_1', translationId: 'doc_t', originalAudio: 'mute', duckDb: 20, separateBackground: true }),
    ).toMatchObject({ translationId: 'doc_t', originalAudio: 'mute', duckDb: 20, separateBackground: true });
    expect(() => parseDubParams({ videoId: 'vid_1' })).toThrow(/targetLanguage/);
    expect(() => parseDubParams({ videoId: 'vid_1', targetLanguage: 'en', originalAudio: 'loud' })).toThrow(/originalAudio/);
    expect(() => parseDubParams({ videoId: 'vid_1', targetLanguage: 'en', duckDb: 0 })).toThrow(/duckDb/);
    expect(() => parseDubParams({ videoId: 'vid_1', targetLanguage: 'en', separateBackground: 'yes' })).toThrow(/separateBackground/);
    expect(() => parseDubParams({ videoId: 'vid_1', targetLanguage: 'en', nope: 1 })).toThrow();
  });

  it('给了已有的译文时不翻译：翻译用的参数不适用', () => {
    expect(() => parseDubParams({ videoId: 'vid_1', translationId: 'doc_t', style: '口语' })).toThrow(/不翻译/);
    expect(() => parseDubParams({ videoId: 'vid_1', translationId: 'doc_t', textModel: 'gpt-x' })).toThrow(/不翻译/);
  });
});

describe('句级重配的参数（regroup）', () => {
  it('只要视频与 regroup：不要求 targetLanguage 或 translationId；种子可以是 new 或整数', () => {
    expect(parseDubParams({ videoId: 'vid_1', regroup: { groupId: 'dub_1', units: ['u1', 'u2'] } })).toEqual({
      videoId: 'vid_1',
      regroup: { groupId: 'dub_1', units: ['u1', 'u2'] },
    });
    expect(parseDubParams({ videoId: 'vid_1', regroup: { groupId: 'dub_1', units: ['u1'], seed: 'new' } }).regroup).toEqual({
      groupId: 'dub_1',
      units: ['u1'],
      seed: 'new',
    });
    expect(parseDubParams({ videoId: 'vid_1', regroup: { groupId: 'dub_1', units: ['u1'], seed: 0 } }).regroup?.seed).toBe(0);
    expect(parseDubParams({ videoId: 'vid_1', regroup: { groupId: 'dub_1', units: ['u1'], seed: 4_294_967_295 } }).regroup?.seed).toBe(
      4_294_967_295,
    );
  });

  it('译文、语言、音色、Provider、模型、翻译用的参数与原声的处理都取自计划：同给时逐项拒绝', () => {
    const regroup = { groupId: 'dub_1', units: ['u1'] };
    for (const [key, value] of [
      ['translationId', 'doc_t'],
      ['targetLanguage', 'en'],
      ['documentId', 'doc_s'],
      ['voice', 'voice_1'],
      ['provider', 'elevenlabs'],
      ['model', 'm'],
      ['textProvider', 'openai'],
      ['textModel', 'gpt-x'],
      ['style', '口语'],
      ['glossary', [{ source: 'a', target: 'b' }]],
      ['glossaries', [{ id: 'g1' }]],
      ['batchSize', 10],
      ['originalAudio', 'mute'],
      ['duckDb', 20],
      ['separateBackground', true],
    ] as const) {
      expect(() => parseDubParams({ videoId: 'vid_1', regroup, [key]: value }), key).toThrow(new RegExp(`不能同时给 ${key}`));
    }
  });

  it('regroup 的形状逐项检查', () => {
    const parse = (regroup: unknown) => parseDubParams({ videoId: 'vid_1', regroup });
    expect(() => parse('dub_1')).toThrow(/regroup 应为对象/);
    expect(() => parse({ units: ['u1'] })).toThrow(/regroup.groupId/);
    expect(() => parse({ groupId: 'dub_1' })).toThrow(/regroup.units/);
    expect(() => parse({ groupId: 'dub_1', units: [] })).toThrow(/regroup.units/);
    expect(() => parse({ groupId: 'dub_1', units: Array.from({ length: 201 }, (_, i) => `u${i}`) })).toThrow(/regroup.units/);
    expect(() => parse({ groupId: 'dub_1', units: ['u1', 'u1'] })).toThrow(/不能重复/);
    expect(() => parse({ groupId: 'dub_1', units: [1] })).toThrow(/regroup.units/);
    expect(() => parse({ groupId: 'dub_1', units: ['u1'], seed: -1 })).toThrow(/regroup.seed/);
    expect(() => parse({ groupId: 'dub_1', units: ['u1'], seed: 1.5 })).toThrow(/regroup.seed/);
    expect(() => parse({ groupId: 'dub_1', units: ['u1'], seed: 4_294_967_296 })).toThrow(/regroup.seed/);
    expect(() => parse({ groupId: 'dub_1', units: ['u1'], seed: 'old' })).toThrow(/regroup.seed/);
    expect(() => parse({ groupId: 'dub_1', units: ['u1'], take: 2 })).toThrow(/regroup.take/);
  });
});

describe('句级重配的冻结（进程内的假视频与假合成）', () => {
  const plan = {
    schema: DUBBING_PLAN_SCHEMA,
    sequenceId: 'seq_1',
    language: 'en',
    groupId: 'dub_1',
    translationRef: { id: 'doc_t', revision: '1' },
    originalDialoguePolicy: 'mute',
    units: [
      { id: 'd-u1', speakerBindingId: null, extensions: { [DUB_EXTENSION]: { translationUnitId: 'u1', voice: 'voice_p', voiceSource: 'params' } } },
      { id: 'd-u2', speakerBindingId: 'S1', extensions: { [DUB_EXTENSION]: { translationUnitId: 'u2', voice: 'voice_s1', voiceSource: 'video' } } },
    ],
    extensions: { [DUB_EXTENSION]: { voice: { providerId: 'elevenlabs', modelId: 'm1', voice: 'voice_p' } } },
  };
  const record = (id: string, kind: string, summary?: unknown) => ({ id, kind, name: id, currentRevision: '1', revisions: { '1': { summary } } });
  const bodies: Record<string, unknown> = {
    doc_p: plan,
    doc_t: { schema: TRANSLATION_SCHEMA, language: 'en', sourceBasis: { speechRef: { id: 'doc_s' } }, units: [{ id: 'u1' }, { id: 'u2' }] },
  };
  const setup = (acceptsSeed: boolean, separator?: DubDeps['separator']) => {
    const prepared: Array<Record<string, unknown>> = [];
    const deps = {
      videos: {
        state: () => ({
          revision: '5',
          rootSequenceId: 'seq_1',
          documents: {
            doc_p: record('doc_p', 'dubbing-plan', { groupId: 'dub_1' }),
            doc_t: record('doc_t', 'translation'),
            doc_s: record('doc_s', 'speech'),
          },
        }),
        document: async (_videoId: string, id: string) => ({ revision: '1', body: bodies[id] }),
        sequence: () => ({
          fps: { num: 30, den: 1 },
          items: [{ id: 'item_1', type: 'audio', trackId: 'track_dub', extensions: { [DUB_EXTENSION]: { groupId: 'dub_1', unitId: 'u1' } } }],
        }),
      },
      translation: {},
      speech: {
        prepare: async (target: Record<string, unknown>) => {
          prepared.push(target);
          return { providerId: 'elevenlabs', modelId: 'm1', voice: String(target.voice), format: 'wav', maxInputChars: 1000, acceptsSeed };
        },
      },
      ...(separator ? { separator } : {}),
      ffmpeg: () => null,
      ffprobe: () => null,
    } as unknown as DubDeps;
    return { pipeline: dubPipeline(deps), prepared };
  };
  const start = (pipeline: ReturnType<typeof dubPipeline>, regroup: Record<string, unknown>) =>
    pipeline.prepare(parseDubParams({ videoId: 'vid_1', regroup }), { retry: false });

  it('译文、语言、Provider、模型与音色取自计划；用了说话人绑定的句子照那次的音色；记下计划与配音轨', async () => {
    const { pipeline, prepared } = setup(true);
    const frozen = await start(pipeline, { groupId: 'dub_1', units: ['u1', 'u2'], seed: 7 });
    expect(prepared[0]).toEqual({ provider: 'elevenlabs', model: 'm1', voice: 'voice_p', language: 'en' });
    expect(frozen.params).toMatchObject({
      videoId: 'vid_1',
      documentId: 'doc_s',
      translationId: 'doc_t',
      language: 'en',
      voiceSource: 'params',
      speakerVoices: [{ speakerId: 'S1', voice: 'voice_s1' }],
      originalAudio: 'mute',
      separatorId: null,
      regroup: { groupId: 'dub_1', units: ['u1', 'u2'], planDocumentId: 'doc_p', trackId: 'track_dub', seed: 7 },
    });
    // 重配的内容摘要与同一份译文的整组配音不同。
    const whole = await setup(true).pipeline.prepare(parseDubParams({ videoId: 'vid_1', translationId: 'doc_t' }), { retry: false });
    expect(frozen.contentHash).not.toBe(whole.contentHash);
  });

  it("种子：'new' 随机取一个；模型不接受种子时 'new' 记为 null、给数字拒绝", async () => {
    const random = (await start(setup(true).pipeline, { groupId: 'dub_1', units: ['u1'] })).params.regroup!.seed!;
    expect(Number.isInteger(random) && random >= 1 && random < 1_000_000).toBe(true);
    expect((await start(setup(false).pipeline, { groupId: 'dub_1', units: ['u1'], seed: 'new' })).params.regroup!.seed).toBeNull();
    await expect(start(setup(false).pipeline, { groupId: 'dub_1', units: ['u1'], seed: 7 })).rejects.toThrow(/不接受种子/);
  });

  it('要求分离：启动时按默认选定分离模型包并冻结（重试照用），分离一步按这个模型包的 Worker 申请资源', async () => {
    const asked: unknown[] = [];
    const separator: DubDeps['separator'] = async (model) => {
      asked.push(model);
      return {
        providerId: 'local',
        modelId: model?.modelId ?? 'sep-a',
        workerWeightBytes: 3 * 1024 ** 3,
        separate: async () => ({ vocals: '', background: '' }),
      };
    };
    const pipeline = setup(true, separator).pipeline;
    const frozen = await pipeline.prepare(parseDubParams({ videoId: 'vid_1', translationId: 'doc_t', separateBackground: true }), {
      retry: false,
    });
    expect(asked).toEqual([undefined]);
    expect(frozen.params).toMatchObject({
      separateBackground: true,
      separatorId: 'local',
      separatorModel: 'sep-a',
      separatorWeightBytes: 3 * 1024 ** 3,
    });
    const step = pipeline.steps.find((s) => s.name === 'separate')!;
    expect(step.resources!(frozen.params, {})).toEqual({
      demand: { memory: 2 * 1024 ** 3, scratchDisk: 2 * 1024 ** 3 },
      holder: { id: 'model-worker:sep-a', demand: { memory: 1024 ** 3, gpuMemory: 4 * 1024 ** 3, cpuThreads: 2 } },
    });
    // 旧的冻结参数没有模型包：只算这一步自己的。
    expect(step.resources!({ ...frozen.params, separatorModel: undefined }, {})).toEqual({
      demand: { memory: 2 * 1024 ** 3, scratchDisk: 2 * 1024 ** 3 },
    });

    // 没有可用的分离模型包：照常接受，分离一步跳过。
    const none = await setup(true, async () => null).pipeline.prepare(
      parseDubParams({ videoId: 'vid_1', translationId: 'doc_t', separateBackground: true }),
      { retry: false },
    );
    expect(none.params).toMatchObject({ separatorId: null, separatorModel: null });

    // 原声不动：分出来的两轨没有地方用，要求了也不分离、不选模型包。
    asked.length = 0;
    const keep = await pipeline.prepare(
      parseDubParams({ videoId: 'vid_1', translationId: 'doc_t', originalAudio: 'keep', separateBackground: true }),
      { retry: false },
    );
    expect(asked).toEqual([]);
    expect(keep.params).toMatchObject({ originalAudio: 'keep', separateBackground: false, separatorId: null });
  });

  it('组不在、句子不在计划或译文里：提交时拒绝', async () => {
    const { pipeline } = setup(true);
    await expect(start(pipeline, { groupId: 'dub_2', units: ['u1'] })).rejects.toMatchObject({ details: { code: 'DUB_GROUP_NOT_FOUND' } });
    await expect(start(pipeline, { groupId: 'dub_1', units: ['u1', 'u9'] })).rejects.toMatchObject({ details: { missing: ['u9'] } });
  });
});

describe('分离的输出合约（假的分离结果）', () => {
  const audio = (durationSec: number, sampleRate = 48_000) => ({ durationSec, audio: { sampleRate } });

  it('人声与背景各一条、与输入等长（容差 20 毫秒）、采样率相同时没有问题', () => {
    expect(stemProblems(audio(10), { vocals: audio(10.01), background: audio(9.99) })).toEqual([]);
  });

  it('长度不同、采样率不同、没有音频都逐项列出', () => {
    const problems = stemProblems(audio(10), {
      vocals: audio(9.5),
      background: { durationSec: 10, audio: null },
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/vocals 长 9.5 秒/);
    expect(problems[1]).toMatch(/background 没有音频/);
    expect(stemProblems(audio(10), { vocals: audio(10, 44_100), background: audio(10) })).toEqual([
      'vocals 的采样率 44100 与输入的 48000 不同',
    ]);
    expect(stemProblems({ durationSec: 10, audio: null }, { vocals: audio(10), background: audio(10) })).toEqual(['输入没有音频']);
  });
});

describe('配音在序列上的起点', () => {
  it('拆成粗帧与一帧之内的余数（约分）', () => {
    expect(audioStart(0, { num: 30, den: 1 })).toEqual({ fromFrame: 0, subframeOffset: { ticks: '0', timescale: 1 } });
    expect(audioStart(1_500_000, { num: 30, den: 1 })).toEqual({ fromFrame: 45, subframeOffset: { ticks: '0', timescale: 1 } });
    // 1.01 秒 @ 30 fps：第 30 帧，余 0.01 秒。
    expect(audioStart(1_010_000, { num: 30, den: 1 })).toEqual({ fromFrame: 30, subframeOffset: { ticks: '1', timescale: 100 } });
    // 29.97 fps：1 秒落在第 29 帧，余 1 − 29·1001/30000 秒。
    const start = audioStart(1_000_000, { num: 30_000, den: 1001 });
    expect(start.fromFrame).toBe(29);
    expect(Number(start.subframeOffset.ticks) / start.subframeOffset.timescale).toBeCloseTo(1 - (29 * 1001) / 30_000, 9);
    expect(Number(start.subframeOffset.ticks) / start.subframeOffset.timescale).toBeLessThan(1001 / 30_000);
  });
});

describe('应用配音的事务：原声与分离出的两轨', () => {
  type Input = Parameters<typeof dubOperations>[0];
  type Ops = Awaited<ReturnType<typeof dubOperations>>;
  const timeMap = { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } };
  const video = (id: string, fromFrame: number, durationFrames: number, enabled: boolean, volume: number) => ({
    id,
    type: 'video',
    trackId: 'track_v',
    assetRef: { id: 'asset_src' },
    span: { fromFrame, durationFrames },
    timeMap,
    embeddedAudio: { enabled, volume },
  });
  // item_v：分离的那份素材（视频，带声音）；item_a：别的素材上的原句；item_m：分离的素材、配音前已经静音。
  const sequence = {
    fps: { num: 30, den: 1 },
    items: [
      video('item_v', 0, 300, true, 0.8),
      {
        id: 'item_a',
        type: 'audio',
        trackId: 'track_a',
        assetRef: { id: 'asset_other' },
        fromFrame: 300,
        subframeOffset: { ticks: '0', timescale: 1 },
        playDuration: { ticks: '10', timescale: 1 },
        timeMap,
        mix: { volume: 1 },
      },
      video('item_m', 600, 30, false, 1),
    ],
  } as unknown as Input['sequence'];
  const separated = { assetId: 'asset_src', assetRevision: '1', vocalsArtifactId: 'art_vocals', backgroundArtifactId: 'art_bg' };
  const run = (originalAudio: 'duck' | 'mute' | 'keep', withStems: boolean) =>
    dubOperations({
      params: { language: 'en', voice: { providerId: 'p', modelId: 'm', voice: 'v' }, originalAudio, duckDb: 18 } as Input['params'],
      aligned: {
        videoRevision: '1',
        sequenceId: 'seq_1',
        placements: [
          {
            unitId: 'u1',
            sentenceId: 's1',
            itemId: 'item_v',
            startUs: 1_000_000,
            fit: 'fit',
            tempo: 1,
            artifactId: 'art_dub',
            samples: 24_000,
            sampleRate: 24_000,
          },
        ],
        overlong: [],
        offTimeline: [],
        dialogueItemIds: ['item_v', 'item_a', 'item_m'],
      },
      script: {
        translation: { id: 'doc_t', revision: '1' },
        language: 'en',
        units: [{ unitId: 'u1', sentenceId: 's1', fingerprint: 'f', text: 'Hi' }],
        stale: [],
      },
      synth: { units: { u1: { key: 'k', artifactId: 'art_dub', durationSec: 1, sampleRate: 24_000 } } },
      source: { speechRef: { id: 'doc_s', revision: '1' }, sentences: [] } as unknown as Input['source'],
      check: { artifactId: 'art_check', translationId: 'doc_t', revision: '1' } as Input['check'],
      separated: withStems ? separated : null,
      sequence,
      groupId: 'dub_1',
      parentJobId: 'job_1',
      artifacts: { locate: async (id: string) => `/staging/${id}.wav` } as unknown as Input['artifacts'],
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ofType = (ops: Ops, type: string) => ops.filter((op) => op.type === type) as Array<Record<string, any>>;
  const plan = (ops: Ops) => ofType(ops, 'putDocument')[0]!.body;

  it('压低且分离过：原句实例静音、换成「背景声」（原样音量）与「人声」两轨，闪避压人声轨与没换的原声；静音的实例记进计划', async () => {
    const ops = await run('duck', true);
    expect(ofType(ops, 'importAsset').map((op) => [op.ref, op.name, op.provenance.source.stem])).toEqual([
      ['dub-audio-1', '配音（en）第 1 句', undefined],
      ['dub-background', '背景声（en）', 'background'],
      ['dub-vocals', '人声（en）', 'vocals'],
    ]);
    expect(ofType(ops, 'addTrack').map((op) => [op.ref, op.name])).toEqual([
      ['dub-track', '配音（en）'],
      ['dub-background-track', '背景声（en）'],
      ['dub-vocals-track', '人声（en）'],
    ]);
    const [, bg, vocals] = ofType(ops, 'insertItems').map((op) => op.items);
    expect(bg).toEqual([
      expect.objectContaining({
        trackRef: 'dub-background-track',
        assetImportRef: 'dub-background',
        fromFrame: 0,
        playDuration: { ticks: '300', timescale: 30 },
        mix: { volume: 0.8 },
        extensions: { [DUB_EXTENSION]: { groupId: 'dub_1', stem: 'background' } },
      }),
    ]);
    expect(vocals).toEqual([
      expect.objectContaining({
        trackRef: 'dub-vocals-track',
        assetImportRef: 'dub-vocals',
        mix: { volume: 0.8 },
        extensions: { [DUB_EXTENSION]: { groupId: 'dub_1', stem: 'vocals' } },
      }),
    ]);
    expect(ofType(ops, 'setAudioMix').map((op) => [op.itemId, op.muted])).toEqual([['item_v', true]]);
    expect(ofType(ops, 'setDucking')).toEqual([
      expect.objectContaining({
        trigger: { kind: 'items', trackRefs: ['dub-track'] },
        target: { itemIds: ['item_a', 'item_m'], trackRefs: ['dub-vocals-track'] },
        depth: 18,
      }),
    ]);
    expect(plan(ops)).toMatchObject({
      originalDialoguePolicy: 'duck',
      backgroundPolicy: 'separate-stems',
      extensions: { [DUB_EXTENSION]: { mutedItemIds: ['item_v'] } },
    });
  });

  it('静音且分离过：原句实例都静音，只放「背景声」一轨，不放人声、没有闪避', async () => {
    const ops = await run('mute', true);
    expect(ofType(ops, 'addTrack').map((op) => op.name)).toEqual(['配音（en）', '背景声（en）']);
    expect(ofType(ops, 'insertItems')[1]!.items).toHaveLength(1);
    expect(ofType(ops, 'setAudioMix').map((op) => op.itemId)).toEqual(['item_v', 'item_a']);
    expect(ofType(ops, 'setDucking')).toEqual([]);
    expect(plan(ops).extensions[DUB_EXTENSION].mutedItemIds).toEqual(['item_v', 'item_a']);
  });

  it('没有分离：压低时一条闪避压原句实例，不静音、不记静音的实例；不动时什么都不碰', async () => {
    const duck = await run('duck', false);
    expect(ofType(duck, 'addTrack').map((op) => op.name)).toEqual(['配音（en）']);
    expect(ofType(duck, 'setAudioMix')).toEqual([]);
    expect(ofType(duck, 'setDucking')[0]!.target).toEqual({ itemIds: ['item_v', 'item_a', 'item_m'] });
    expect(plan(duck)).toMatchObject({ backgroundPolicy: 'none' });
    expect(plan(duck).extensions[DUB_EXTENSION].mutedItemIds).toBeUndefined();
    const keep = await run('keep', true);
    expect(ofType(keep, 'addTrack').map((op) => op.name)).toEqual(['配音（en）']);
    expect([...ofType(keep, 'setAudioMix'), ...ofType(keep, 'setDucking')]).toEqual([]);
  });
});
