import { describe, expect, it } from 'vitest';
import type { AssetRecord, AudioItem, DocumentRecord, DuckingRule, JobRecord, Sequence, Track } from '@baocut/protocol';
import {
  activeTake,
  archivedTakes,
  assetOfArtifact,
  canListenDub,
  failedUnits,
  placedUnits,
  planTakes,
  planUnitOrder,
  queuedId,
  queuedKey,
  queuedSet,
  regenCandidates,
  regroupJobs,
  retextTranslation,
  sourceGroup,
  sourceOf,
  switchSourceOperations,
  switchTakeOperations,
  takeSeconds,
  trackCounts,
  versionTip,
  withRegen,
} from './dub-takes.ts';
import type { DubBlock } from './timeline-dub.ts';
import { textHash, type TranslationBody } from './translation-doc.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number, muted = false): Track {
  return { id, order, kind: 'audio', locked: false, visible: true, muted, solo: { enabled: false, group: 'audio' } };
}

function audio(id: string, trackId: string, start: number, seconds: number, extra: Partial<AudioItem> = {}): AudioItem {
  return {
    id,
    trackId,
    type: 'audio',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    assetRef: { id: `asset_${id}`, revision: '1' },
    fromFrame: Math.round(start * 30),
    subframeOffset: { ticks: '0', timescale: 1000 },
    playDuration: { ticks: String(Math.round(seconds * 1000)), timescale: 1000 },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
    mix: { volume: 1 },
    ...extra,
  };
}

const dub = (groupId: string, unitId: string, more: Record<string, unknown> = {}) => ({
  role: 'dub' as const,
  name: `配音 ${unitId}`,
  extensions: { 'baocut.dub': { groupId, language: 'en', unitId, ...more } },
});
const bed = (groupId: string) => ({ extensions: { 'baocut.dub': { groupId, stem: 'background' } } });

function sequence(items: Sequence['items'], tracks: Track[], ducking: DuckingRule[] = []): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks,
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking,
  };
}

function asset(id: string, source: Record<string, unknown>): AssetRecord {
  return {
    id,
    kind: 'audio',
    name: id,
    currentRevision: '1',
    revisions: { '1': { revision: '1', storage: { kind: 'managed', path: `${id}.wav` }, provenance: { origin: 'generated', source } } },
  } as unknown as AssetRecord;
}

const take = (k: number, more: Record<string, unknown> = {}) => ({
  k,
  seed: k === 1 ? null : 1000 + k,
  artifactId: `art_${k}`,
  samples: 48000 * k,
  sampleRate: 48000,
  fit: 'fit',
  tempo: 1,
  text: `第 ${k} 版的稿`,
  jobId: `job_${k}`,
  at: '2026-10-01T00:00:00Z',
  ...more,
});

/** 计划单元：给了 `takes` 就是重配过的；否则是旧计划（放上了就带 `artifactId`）。 */
function planUnit(unitId: string, status: string, own: Record<string, unknown> = {}, more: Record<string, unknown> = {}) {
  return {
    id: `d-${unitId}`,
    sourceSentenceIds: [`s-${unitId}`],
    script: { text: `${unitId} 的稿` },
    status,
    ...more,
    extensions: { 'baocut.dub': { translationUnitId: unitId, ...own } },
  };
}

describe('版本', () => {
  it('旧计划：放上的那一句补成第 1 版（视图，不改计划）；没合成的没有版本', () => {
    const units = planTakes({
      units: [
        planUnit('u1', 'ready', { artifactId: 'art_old', fit: 'tempo', tempo: 1.2 }, { actualSamples: '96000', sampleRate: 48000 }),
        planUnit('u2', 'failed', { voiceUnavailable: { speakerId: 'S1' } }),
        planUnit('u3', 'needs-fit', { overflowSeconds: 0.8 }),
      ],
    });
    const u1 = units.get('u1')!;
    expect(u1.take).toBe(1);
    expect(u1.takes).toEqual([
      expect.objectContaining({ k: 1, seed: null, artifactId: 'art_old', samples: 96000, sampleRate: 48000, fit: 'tempo', text: 'u1 的稿' }),
    ]);
    expect(takeSeconds(activeTake(u1)!)).toBe(2);
    expect(archivedTakes(u1)).toEqual([]);
    expect(versionTip(u1)).toBeNull();
    expect(units.get('u2')).toMatchObject({ take: null, takes: [], voiceUnavailable: true });
    expect(units.get('u3')).toMatchObject({ take: null, overflowSeconds: 0.8 });
  });

  it('重配过：当前版本、归档与块提示（只有多于一版时写，种子没有时只写版号）', () => {
    const units = planTakes({
      units: [planUnit('u1', 'ready', { take: 2, seed: 1002, takes: [take(1), take(2), take(3, { samples: null, fit: null, overflowSeconds: 0.5 })] })],
    });
    const u1 = units.get('u1')!;
    expect(activeTake(u1)!.k).toBe(2);
    expect(u1.seed).toBe(1002);
    expect(archivedTakes(u1).map((t) => t.k)).toEqual([1, 3]);
    expect(versionTip(u1)).toEqual({ k: 2, seed: 1002 });
    expect(takeSeconds(u1.takes[2]!)).toBeNull();
    // `take` 指向不存在的版本时取最新的一版。
    const odd = planTakes({ units: [planUnit('u1', 'ready', { take: 9, takes: [take(1), take(2)] })] }).get('u1')!;
    expect(odd.take).toBe(2);
    const first = planTakes({ units: [planUnit('u1', 'ready', { take: 1, takes: [take(1), take(2)] })] }).get('u1')!;
    expect(versionTip(first)).toEqual({ k: 1, seed: null });
  });
});

describe('排队与候选', () => {
  const job = (id: string, state: JobRecord['state'], regroup: unknown, videoId = 'v1') =>
    ({ jobId: id, kind: 'pipeline', state, endedAt: null, videoId, pipeline: { name: 'dub', params: { regroup } } }) as unknown as JobRecord;

  it('在跑的句级重配：只认这个视频、还没结束、带 regroup 的配音流程；键排好序，句子不变时不变', () => {
    const jobs = [
      job('j1', 'running', { groupId: 'g1', units: ['u2', 'u1'], seed: 7, planDocumentId: 'p', trackId: 't' }),
      job('j2', 'queued', { groupId: 'g2', units: ['u9'], seed: null }),
      job('j3', 'completed', { groupId: 'g1', units: ['u3'] }),
      job('j4', 'running', { groupId: 'g1', units: ['u4'] }, 'v2'),
      job('j5', 'running', undefined),
    ];
    expect(regroupJobs(jobs, 'v1')).toEqual([
      { jobId: 'j1', groupId: 'g1', units: ['u2', 'u1'], seed: 7 },
      { jobId: 'j2', groupId: 'g2', units: ['u9'], seed: null },
    ]);
    const key = queuedKey(jobs, 'v1');
    expect(key).toBe(queuedKey([...jobs].reverse(), 'v1'));
    const set = queuedSet(key);
    expect([...set].sort()).toEqual([queuedId('g1', 'u1'), queuedId('g1', 'u2'), queuedId('g2', 'u9')].sort());
    expect(queuedSet('').size).toBe(0);
  });

  it('块级管理（设计稿 model-dub.test.js「块级管理」）：没合成的句、候选与行头计数', () => {
    const seq = sequence(
      [
        audio('d1', 'a-dub', 1, 2, dub('g1', 'u1')),
        audio('d2', 'a-dub', 4, 2, { ...dub('g1', 'u2'), mix: { volume: 1, muted: true } }),
        audio('d4', 'a-dub', 9, 1, dub('g1', 'u4')),
      ],
      [track('a-dub', 0)],
    );
    const body = {
      units: [
        planUnit('u1', 'ready', { artifactId: 'a1' }),
        planUnit('u2', 'ready', { artifactId: 'a2' }),
        planUnit('u3', 'failed', { voiceUnavailable: {} }),
        planUnit('u4', 'needs-fit', { overflowSeconds: 1 }),
        planUnit('u5', 'needs-fit', { overflowSeconds: 0.4 }),
        planUnit('u6', 'draft', { offTimeline: true }),
      ],
    };
    const placed = placedUnits(seq, 'g1');
    expect([...placed]).toEqual(['u1', 'u2', 'u4']);
    // u4 是放不下但留着旧的一版：在时间线上，不算没合成。
    const failed = failedUnits(body, placed);
    expect(failed).toEqual([
      { unitId: 'u3', reason: 'voice', overflowSeconds: null },
      { unitId: 'u5', reason: 'overlong', overflowSeconds: 0.4 },
    ]);
    const blocks = [
      { groupId: 'g1', unitId: 'u1', fast: true, muted: false },
      { groupId: 'g1', unitId: 'u2', fast: false, muted: true },
      { groupId: 'g1', unitId: 'u4', fast: true, muted: false },
    ];
    expect(regenCandidates(failed, blocks, 'g1')).toEqual(['u3', 'u5', 'u1', 'u4']);
    expect(regenCandidates(failed, blocks, 'g2')).toEqual(['u3', 'u5']);
    expect(trackCounts(blocks, failed, new Set())).toEqual({ total: 5, fast: 2, muted: 1, failed: 2, queued: 0 });
    // 排队中的块照旧算过快（设计稿 blockCounts：重配好之前放的还是这一版），但不再是候选。
    expect(trackCounts(blocks, failed, new Set([queuedId('g1', 'u1')]))).toEqual({ total: 5, fast: 2, muted: 1, failed: 2, queued: 1 });
    expect(regenCandidates(failed, blocks, 'g1', new Set([queuedId('g1', 'u1'), queuedId('g1', 'u3')]))).toEqual(['u5', 'u4']);
    // 句号按计划的次序：没合成的 u3 也占一个号，u4 是第 4 句而不是轨上的第 3 块。
    const order = planUnitOrder(body);
    expect([order.get('u3'), order.get('u4'), order.get('u6')]).toEqual([3, 4, 6]);
    expect(planUnitOrder(null).size).toBe(0);
  });

  it('时间线的块叠上排队与版本：没变的块原样返回', () => {
    const base = (itemId: string, unitId: string | null, groupId = 'g1') =>
      ({
        itemId,
        groupId,
        unitId,
        language: 'en',
        index: 1,
        text: null,
        speakerId: null,
        speakerName: null,
        hue: 'blue',
        tempo: 1,
        speed: 1,
        rate: 1,
        fast: false,
        muted: false,
        manual: false,
      }) as DubBlock;
    const blocks = new Map([
      ['d1', base('d1', 'u1')],
      ['d2', base('d2', 'u2')],
      ['d3', base('d3', null)],
      ['d4', base('d4', 'u1', 'g2')],
    ]);
    const plans = new Map<string, unknown>([
      ['g1', { units: [planUnit('u1', 'ready', { take: 2, seed: 1002, takes: [take(1), take(2)] }), planUnit('u2', 'ready', { artifactId: 'a2' })] }],
    ]);
    const out = withRegen(blocks, plans, new Set([queuedId('g1', 'u2')]));
    expect(out.get('d1')).toMatchObject({ queued: false, version: { k: 2, seed: 1002 } });
    expect(out.get('d2')).toMatchObject({ queued: true, version: null });
    expect(out.get('d3')).toBe(blocks.get('d3'));
    // 别的组同一个 unitId：计划没取到、不在排队，原样。
    expect(out.get('d4')).toBe(blocks.get('d4'));
  });
});

describe('切换版本', () => {
  const seq = sequence(
    [
      audio('d1', 'a-dub', 1, 2, {
        ...dub('g1', 'u1', { take: 2, seed: 1002 }),
        assetRef: { id: 'asset_t2', revision: '1' },
        mix: { volume: 0.7, muted: true },
      }),
      audio('d2', 'a-dub', 4, 2, dub('g1', 'u2')),
    ],
    [track('a-dub', 0)],
  );
  const record = {
    id: 'plan1',
    currentRevision: '3',
    revisions: { '3': { summary: { groupId: 'g1', placed: 2 } } },
  } as unknown as DocumentRecord;
  const body = {
    schema: 'baocut.dubbing-plan/1',
    units: [
      planUnit(
        'u1',
        'ready',
        { take: 2, seed: 1002, takes: [take(1, { assetRef: { id: 'asset_t1', revision: '1' } }), take(2), take(3, { samples: null, fit: null })] },
        { actualSamples: '96000', sampleRate: 48000 },
      ),
      planUnit('u2', 'ready', { artifactId: 'art_u2' }),
    ],
  };
  const assets = { asset_t1: asset('asset_t1', { artifactId: 'art_1' }), asset_t2: asset('asset_t2', { artifactId: 'art_2' }) };

  it('切回第 1 版：删掉这句的实例、用那一版的素材放回原处、写计划的新版本（被换下的那一版补记素材）', () => {
    const ops = switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body, unitId: 'u1', k: 1, assets })!;
    expect(ops.map((o) => o.type)).toEqual(['deleteItems', 'insertItems', 'putDocument']);
    expect(ops[0]).toEqual({ type: 'deleteItems', sequenceId: 'seq', itemIds: ['d1'] });
    const insert = ops[1] as Extract<(typeof ops)[number], { type: 'insertItems' }>;
    expect(insert.items[0]).toMatchObject({
      type: 'audio',
      trackId: 'a-dub',
      assetRef: { id: 'asset_t1', revision: '1' },
      fromFrame: 30,
      playDuration: { ticks: '48000', timescale: 48000 },
      timeMap: { kind: 'linear', rate: { num: 1, den: 1 } },
      mix: { volume: 0.7, muted: true },
      name: '配音 u1',
      role: 'dub',
      extensions: { 'baocut.dub': { groupId: 'g1', language: 'en', unitId: 'u1', take: 1 } },
    });
    expect((insert.items[0] as { extensions: Record<string, Record<string, unknown>> }).extensions['baocut.dub']).not.toHaveProperty('seed');
    const put = ops[2] as Extract<(typeof ops)[number], { type: 'putDocument' }>;
    expect(put).toMatchObject({ documentId: 'plan1', kind: 'dubbing-plan', summary: { groupId: 'g1', placed: 2 } });
    const unit = (put.body as typeof body).units[0]! as unknown as {
      extensions: Record<string, Record<string, unknown>>;
      actualSamples: string;
      script: { text: string };
    };
    const own = unit.extensions['baocut.dub']!;
    expect(own.take).toBe(1);
    expect(own).not.toHaveProperty('seed');
    expect(unit.actualSamples).toBe('48000');
    expect(unit.script.text).toBe('第 1 版的稿');
    expect((own.takes as Array<{ k: number; assetRef?: unknown }>).find((t) => t.k === 2)!.assetRef).toEqual({ id: 'asset_t2', revision: '1' });
    // 原来的正文不动。
    expect((body.units[0]!.extensions['baocut.dub'] as unknown as { take: number }).take).toBe(2);
  });

  it('素材没记下时按产物找；当前版本、没放上过的版本、找不到素材时不能切', () => {
    expect(assetOfArtifact(assets, 'art_2')).toEqual({ id: 'asset_t2', revision: '1' });
    expect(assetOfArtifact(assets, 'nope')).toBeNull();
    const back = switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body, unitId: 'u1', k: 2, assets });
    expect(back).toBeNull();
    expect(switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body, unitId: 'u1', k: 3, assets })).toBeNull();
    // 第 1 版记着素材：不用找；没记下又找不到时不能切。
    expect(switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body, unitId: 'u1', k: 1, assets: {} })).not.toBeNull();
    const bare = structuredClone(body);
    delete (bare.units[0]!.extensions['baocut.dub'] as unknown as { takes: Array<{ assetRef?: unknown }> }).takes[0]!.assetRef;
    expect(switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body: bare, unitId: 'u1', k: 1, assets })).not.toBeNull();
    expect(switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body: bare, unitId: 'u1', k: 1, assets: {} })).toBeNull();
    expect(switchTakeOperations({ sequence: seq, item: seq.items[0] as AudioItem, record, body, unitId: 'u1', k: 9, assets })).toBeNull();
  });
});

describe('听配音 / 听原声 / 两者都听', () => {
  const duckRule = (enabled: boolean): DuckingRule =>
    ({
      id: 'r1',
      enabled,
      trigger: { kind: 'items', trackIds: ['a-en'] },
      target: { itemIds: ['orig'] },
      depth: 12,
      attack: { ticks: '0', timescale: 1 },
      release: { ticks: '0', timescale: 1 },
    }) as DuckingRule;
  const tracks = () => [track('a-orig', 0), track('a-en', 1), track('a-bed', 2), track('a-ja', 3)];
  const items = (origMuted = false) => [
    audio('orig', 'a-orig', 0, 20, { mix: { volume: 1, ...(origMuted ? { muted: true } : {}) } }),
    audio('en1', 'a-en', 1, 2, dub('gEn', 'u1')),
    audio('bg', 'a-bed', 0, 20, bed('gEn')),
    audio('ja1', 'a-ja', 1, 2, dub('gJa', 'u1')),
  ];
  const groups = [
    sourceGroup('gEn', { originalDialoguePolicy: 'duck' }),
    sourceGroup('gJa', { originalDialoguePolicy: 'mute', extensions: { 'baocut.dub': { mutedItemIds: ['orig'] } } }),
  ];

  it('从轨道、静音与闪避反推在听什么', () => {
    expect(sourceOf(sequence(items(), tracks(), [duckRule(true)]), groups[0]!)).toBe('dub');
    expect(sourceOf(sequence(items(), tracks(), [duckRule(false)]), groups[0]!)).toBe('both');
    const off = tracks().map((t) => (t.id === 'a-en' ? { ...t, muted: true } : t));
    expect(sourceOf(sequence(items(), off, [duckRule(true)]), groups[0]!)).toBe('original');
    expect(sourceOf(sequence(items(true), tracks()), groups[1]!)).toBe('dub');
    expect(sourceOf(sequence(items(false), tracks()), groups[1]!)).toBe('both');
    expect(sourceOf(sequence(items(), tracks()), sourceGroup('gKeep', { originalDialoguePolicy: 'keep' }))).toBe('original');
    expect(canListenDub(groups[0]!)).toBe(true);
    expect(canListenDub(sourceGroup('g', { originalDialoguePolicy: 'keep' }))).toBe(false);
  });

  it('听配音（duck 组）：这组的配音与背景声开、别的语言关、闪避打开、别组静音过的原声恢复', () => {
    const seq = sequence(items(true), tracks(), [duckRule(false)]);
    expect(switchSourceOperations(seq, groups, 'gEn', 'dub')).toEqual([
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-ja', muted: true },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'orig', muted: false },
      { type: 'setDucking', sequenceId: 'seq', ruleId: 'r1', enabled: true },
    ]);
  });

  it('听原声：所有配音与背景声关、原声恢复、闪避关掉；两者都听：背景声关、这组配音开', () => {
    const seq = sequence(items(true), tracks(), [duckRule(true)]);
    expect(switchSourceOperations(seq, groups, 'gEn', 'original')).toEqual([
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-en', muted: true },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-bed', muted: true },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-ja', muted: true },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'orig', muted: false },
      { type: 'setDucking', sequenceId: 'seq', ruleId: 'r1', enabled: false },
    ]);
    expect(switchSourceOperations(seq, groups, 'gEn', 'both')).toEqual([
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-bed', muted: true },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-ja', muted: true },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'orig', muted: false },
      { type: 'setDucking', sequenceId: 'seq', ruleId: 'r1', enabled: false },
    ]);
  });

  it('听配音（mute 组）：静音它记下的原声、开它的配音轨；和别的实例共用的轨道逐件改', () => {
    const shared = [track('a-orig', 0), track('a-mix', 1, true)];
    const seq = sequence(
      [
        audio('orig', 'a-orig', 0, 20),
        audio('en1', 'a-mix', 1, 2, { ...dub('gEn', 'u1'), mix: { volume: 1, muted: true } }),
        audio('ja1', 'a-mix', 4, 2, dub('gJa', 'u1')),
        audio('music', 'a-mix', 10, 2),
      ],
      shared,
    );
    expect(switchSourceOperations(seq, groups, 'gJa', 'dub')).toEqual([
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-mix', muted: false },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'orig', muted: true },
    ]);
    // 已经是要的样子：不发操作。
    const done = sequence(
      [audio('orig', 'a-orig', 0, 20, { mix: { volume: 1, muted: true } }), audio('ja1', 'a-ja', 1, 2, dub('gJa', 'u1'))],
      [track('a-orig', 0), track('a-ja', 1)],
    );
    expect(switchSourceOperations(done, groups, 'gJa', 'dub')).toEqual([]);
  });

  it('分离过的 duck 组：原声实例静音、换成背景声与人声两轨，闪避压人声轨；听原声恢复原声、两轨都关，听配音再换回去', () => {
    const vocalsRule = (enabled: boolean) => ({ ...duckRule(enabled), target: { trackIds: ['a-voc'] } }) as DuckingRule;
    const sepTracks = [track('a-orig', 0), track('a-en', 1), track('a-bed', 2), track('a-voc', 3)];
    const sepItems = (origMuted: boolean) => [
      audio('orig', 'a-orig', 0, 20, { mix: { volume: 1, ...(origMuted ? { muted: true } : {}) } }),
      audio('en1', 'a-en', 1, 2, dub('gEn', 'u1')),
      audio('bg', 'a-bed', 0, 20, bed('gEn')),
      audio('voc', 'a-voc', 0, 20, { extensions: { 'baocut.dub': { groupId: 'gEn', stem: 'vocals' } } }),
    ];
    const sep = [sourceGroup('gEn', { originalDialoguePolicy: 'duck', extensions: { 'baocut.dub': { mutedItemIds: ['orig'] } } })];
    // 刚配完：原声静音、两轨开、闪避开。
    const dubbed = sequence(sepItems(true), sepTracks, [vocalsRule(true)]);
    expect(sourceOf(dubbed, sep[0]!)).toBe('dub');
    const toOriginal = switchSourceOperations(dubbed, sep, 'gEn', 'original');
    expect(toOriginal).toEqual([
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-en', muted: true },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-bed', muted: true },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-voc', muted: true },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'orig', muted: false },
      { type: 'setDucking', sequenceId: 'seq', ruleId: 'r1', enabled: false },
    ]);
    const muted = (ids: string[]) => sepTracks.map((t) => (ids.includes(t.id) ? { ...t, muted: true } : t));
    const original = sequence(sepItems(false), muted(['a-en', 'a-bed', 'a-voc']), [vocalsRule(false)]);
    expect(sourceOf(original, sep[0]!)).toBe('original');
    expect(sourceOf(sequence(sepItems(false), muted(['a-bed', 'a-voc']), [vocalsRule(false)]), sep[0]!)).toBe('both');
    expect(switchSourceOperations(original, sep, 'gEn', 'dub')).toEqual([
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-en', muted: false },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-bed', muted: false },
      { type: 'updateTrack', sequenceId: 'seq', trackId: 'a-voc', muted: false },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'orig', muted: true },
      { type: 'setDucking', sequenceId: 'seq', ruleId: 'r1', enabled: true },
    ]);
  });
});

describe('改译文', () => {
  it('改 naturalText（有字幕改写的单元改写不动）、记为 reviewed、换 textHash；没变或空的不改', async () => {
    const hash = await textHash('Hello.');
    const body: TranslationBody = {
      schema: 'baocut.translation/2',
      language: 'en',
      sourceBasis: { speechRef: { id: 'sp', revision: '1' }, sequenceId: 'seq', scopeLineage: [], editViewHash: 'h' },
      units: [
        {
          id: 't1',
          sourceSentenceId: 's1',
          sourceFingerprint: 'f1',
          naturalText: 'Hello.',
          alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: ['w1'], textHash: hash },
          status: 'draft',
        },
        {
          id: 't2',
          sourceSentenceId: 's2',
          sourceFingerprint: 'f2',
          naturalText: 'A long sentence.',
          displayRewrite: { text: 'Long.', reason: 'cps', reviewed: false },
          alignment: { basis: 'display-rewrite', correspondence: 'sentence', blocks: [], sourceWordIds: ['w2'], textHash: 'sha256:x' },
          status: 'draft',
        },
        { id: 't3', sourceSentenceId: 's3', sourceFingerprint: 'f3', naturalText: 'Same.', alignment: null, status: 'draft' },
      ],
    } as unknown as TranslationBody;
    const result = (await retextTranslation(
      body,
      new Map([
        ['t1', ' Hi. '],
        ['t2', 'Short.'],
        ['t3', 'Same.'],
        ['t9', 'x'],
      ]),
    ))!;
    expect(result.changed).toEqual(['t1', 't2']);
    expect(result.body.units[0]).toMatchObject({ naturalText: 'Hi.', status: 'reviewed', alignment: { textHash: await textHash('Hi.') } });
    expect(result.body.units[1]).toMatchObject({
      naturalText: 'Short.',
      status: 'reviewed',
      displayRewrite: { text: 'Long.' },
      alignment: { textHash: 'sha256:x' },
    });
    expect(result.body.units[2]).toBe(body.units[2]);
    expect(
      await retextTranslation(
        body,
        new Map([
          ['t1', 'Hello.'],
          ['t3', '  '],
        ]),
      ),
    ).toBeNull();
  });
});
