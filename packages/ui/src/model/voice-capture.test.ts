import { describe, expect, it } from 'vitest';
import type { LocalSpeechTraits, ModelCapabilitiesView, VoiceClone } from '@baocut/protocol';
import { speechModel, withLocalSpeech } from './models-test-fixtures.ts';
import {
  CONSENT_COMMON,
  CONSENT_PHRASES,
  CONSENT_REC,
  FALLBACK_SEED,
  SAMPLE,
  clock,
  cloneSteps,
  cloneTargets,
  consentLanguageName,
  consentMore,
  consentPhrase,
  consentTooShort,
  defaultPicked,
  defaultScriptLanguage,
  defaultVoiceName,
  downmix,
  encodeWav,
  firstSecondsUsed,
  initialCloneStep,
  initialSeeds,
  limitUnit,
  randomSeed,
  recordingNote,
  recordingProgress,
  reseedTargets,
  reseeded,
  sampleScript,
  sampleTooShortFor,
  sampleVerdict,
  seedFor,
  seedGroups,
  uploadPlan,
  uploadTargets,
  voiceIdBindings,
  voicesBoundTo,
  TAKE,
  analyzeTake,
  feedLiveTake,
  liveTakeHint,
  micMismatch,
  redoSteps,
  sameMic,
  saveTakeWarnings,
  startLiveTake,
  takeIssues,
  type CloneTarget,
  type TakeAnalysis,
  type TakeSource,
} from './voice-capture.ts';
import { captureVoiceRequest, cloneProviders, consentClipRequest, reseedRequest, type VoiceEntry } from './voices-library.ts';

/** 本机两只能克隆的（一只收种子）、一只没装的；云端 ElevenLabs（不要授权声明录音）与一家要的。 */
function view(): ModelCapabilitiesView {
  const v = withLocalSpeech();
  const providers = v.synthesizeSpeech.providers.map((p) => {
    if (p.providerId === 'local') {
      return {
        ...p,
        models: [
          ...p.models,
          speechModel('qwen3-tts-0.6b-base', [], { label: 'Qwen3-TTS 0.6B Base', voiceModes: ['clone'], acceptsSeed: true }),
          speechModel('indextts2', [], { label: 'IndexTTS2', voiceModes: ['clone'] }),
          speechModel('voxcpm2', [], { label: 'VoxCPM2', voiceModes: ['clone'], available: false }),
        ],
      };
    }
    if (p.providerId === 'elevenlabs') return { ...p, voiceClone: { requiresConsentClip: false } };
    return p;
  });
  providers.push({
    providerId: 'consent-co',
    kind: 'online',
    label: 'Consent Co',
    config: null,
    available: true,
    models: [],
    voiceClone: { requiresConsentClip: true },
  });
  return { ...v, synthesizeSpeech: { ...v.synthesizeSpeech, providers } };
}

describe('授权声明的语言', () => {
  it('官方表 30 种，代码不重复；英文推荐且实测能过，简体中文标着常验不过', () => {
    expect(CONSENT_PHRASES).toHaveLength(30);
    expect(new Set(CONSENT_PHRASES.map((p) => p.code)).size).toBe(30);
    expect(consentPhrase('en-US')).toMatchObject({ verified: true, recommended: true });
    expect(consentPhrase('zh-CN')).toMatchObject({ flaky: true });
    expect(consentPhrase('custom')).toBeNull();
    for (const p of CONSENT_PHRASES) expect(p.text.trim()).not.toBe('');
  });

  it('en-US 与 zh-CN 给芯片，其余 28 种进「更多语言」，按原表次序', () => {
    expect(CONSENT_COMMON).toEqual(['en-US', 'zh-CN']);
    const more = consentMore();
    expect(more).toHaveLength(28);
    expect(more.map((p) => p.code)).not.toContain('en-US');
    expect(more[0]!.code).toBe('en-GB');
    expect(more.at(-1)!.code).toBe('te-IN');
  });

  it('显示名按界面语言取；ar-XA 按阿拉伯语取', () => {
    expect(consentLanguageName('ja-JP', 'en')).toMatch(/Japanese/);
    expect(consentLanguageName('ar-XA', 'en')).toBe('Arabic');
    expect(consentLanguageName('de-DE', 'de')).toMatch(/Deutsch/);
  });
});

describe('录音门槛', () => {
  it('样本：5 秒以下不给存，10 秒以下只够本机，30 秒到顶', () => {
    expect(sampleVerdict(4.9)).toBe('short');
    expect(sampleVerdict(Number.NaN)).toBe('short');
    expect(sampleVerdict(5)).toBe('local');
    expect(sampleVerdict(12)).toBe('ok');
    expect(sampleVerdict(30)).toBe('best');
  });

  it('录音时那一句：不够存 → 够了 → 到目标后可以接着说 → 最后几秒倒数 → 到上限', () => {
    expect(recordingNote(2, SAMPLE)).toEqual({ kind: 'need', seconds: 3 });
    expect(recordingNote(Number.NaN, SAMPLE)).toEqual({ kind: 'need', seconds: 5 });
    expect(recordingNote(12, SAMPLE)).toEqual({ kind: 'enough' });
    expect(recordingNote(30, SAMPLE)).toEqual({ kind: 'plenty' });
    expect(recordingNote(169.9, SAMPLE)).toEqual({ kind: 'plenty' });
    expect(recordingNote(175, SAMPLE)).toEqual({ kind: 'left', seconds: 5 });
    expect(recordingNote(180, SAMPLE)).toEqual({ kind: 'stop' });
    expect(recordingNote(8, CONSENT_REC)).toEqual({ kind: 'left', seconds: 7 });
  });

  it('进度条朝目标走，到目标就满，之后不倒退', () => {
    expect(recordingProgress(15, SAMPLE)).toBe(50);
    expect(recordingProgress(30, SAMPLE)).toBe(100);
    expect(recordingProgress(120, SAMPLE)).toBe(100);
    expect(recordingProgress(-1, SAMPLE)).toBe(0);
  });

  it('上限写成整分钟还是秒', () => {
    expect(limitUnit(SAMPLE.max)).toEqual({ unit: 'minutes', value: 3 });
    expect(limitUnit(CONSENT_REC.max)).toEqual({ unit: 'seconds', value: 15 });
    expect(limitUnit(90)).toEqual({ unit: 'seconds', value: 90 });
  });

  it('授权声明：3 秒以下算没念完', () => {
    expect(consentTooShort(2.9)).toBe(true);
    expect(consentTooShort(3)).toBe(false);
  });

  it('计时器写成 mm:ss.s', () => {
    expect(clock(0)).toBe('00:00.0');
    expect(clock(7.94)).toBe('00:07.9');
    expect(clock(30)).toBe('00:30.0');
  });

  it('样本的台词：界面语言有台词时念它，没有时用表里第一门', () => {
    expect(defaultScriptLanguage('de-DE')).toBe('de');
    expect(defaultScriptLanguage('xx')).toBe(scriptFirst());
    expect(sampleScript('en').length).toBeGreaterThan(1);
  });
});

function scriptFirst(): string {
  return defaultScriptLanguage('zz-ZZ');
}

describe('克隆去哪些模型', () => {
  it('本机装好的、能克隆的模型 + 能克隆的云端；没装的不列', () => {
    const targets = cloneTargets(view());
    expect(targets.map((t) => `${t.kind}:${t.id}`)).toEqual([
      'local:qwen3-tts-0.6b-base',
      'local:indextts2',
      'cloud:elevenlabs',
      'cloud:consent-co',
    ]);
    expect(targets.find((t) => t.id === 'elevenlabs')).toMatchObject({ consent: false, connected: false });
    expect(targets.find((t) => t.id === 'consent-co')).toMatchObject({ consent: true, connected: true });
    expect(cloneTargets(null)).toEqual([]);
  });

  it('云端能不能克隆看 Runtime 报的 voiceClone（Gemini 要授权声明）；旧版 Runtime 不报时 ElevenLabs 照列，别家不列', () => {
    const v = view();
    const google = {
      providerId: 'google',
      kind: 'online' as const,
      label: 'Google Gemini',
      config: null,
      available: true,
      models: [speechModel('gemini-3.8-flash-tts', ['Kore'], { voiceModes: ['preset', 'custom'] })],
      voiceClone: { requiresConsentClip: true },
    };
    const providers = [
      ...v.synthesizeSpeech.providers.filter((p) => p.providerId !== 'consent-co').map((p) => (p.providerId === 'elevenlabs' ? { ...p, voiceClone: undefined } : p)),
      google,
    ];
    const targets = cloneTargets({ ...v, synthesizeSpeech: { ...v.synthesizeSpeech, providers } });
    expect(targets.filter((t) => t.kind === 'cloud').map((t) => [t.id, t.name, t.consent])).toEqual([
      ['elevenlabs', 'ElevenLabs', false],
      ['google', 'Google Gemini', true],
    ]);
    expect(cloneSteps(targets).find((s) => s.key === 'consent')!.needed).toEqual(['Google Gemini']);
  });

  it('默认只选本机引擎：云端存好就上传，只在从那一家过来时选上它', () => {
    const targets = cloneTargets(view());
    expect(defaultPicked(targets, null)).toEqual(['qwen3-tts-0.6b-base', 'indextts2']);
    expect(defaultPicked(targets, 'elevenlabs')).toEqual(['qwen3-tts-0.6b-base', 'indextts2', 'elevenlabs']);
  });

  it('一定要逐字稿的本机引擎标出来、默认不选（采集存下的逐字稿是空的）；从它过来时照样选上', () => {
    const v = view();
    const fish = speechModel('fish-s2-pro', [], {
      label: 'Fish S2 Pro',
      voiceModes: ['clone'],
      local: { reference: { recommendedSeconds: [5, 15], withTranscriptSeconds: [5, 15], acceptsTranscript: true, requiresTranscript: true } } as unknown as LocalSpeechTraits,
    });
    const providers = v.synthesizeSpeech.providers.map((p) => (p.providerId === 'local' ? { ...p, models: [...p.models, fish] } : p));
    const targets = cloneTargets({ ...v, synthesizeSpeech: { ...v.synthesizeSpeech, providers } });
    expect(targets.find((t) => t.id === 'fish-s2-pro')).toMatchObject({ kind: 'local', needsTranscript: true });
    expect(targets.find((t) => t.id === 'indextts2')).not.toHaveProperty('needsTranscript');
    expect(defaultPicked(targets, null)).not.toContain('fish-s2-pro');
    expect(defaultPicked(targets, 'fish-s2-pro')).toContain('fish-s2-pro');
  });

  it('云端收的样本时长照能力视图的 voiceClone.sourceSeconds 带上；没报的不带', () => {
    const v = view();
    const providers = v.synthesizeSpeech.providers.map((p) =>
      p.providerId === 'consent-co' ? { ...p, voiceClone: { requiresConsentClip: true, sourceSeconds: { min: 10, max: 30 } } } : p,
    );
    const targets = cloneTargets({ ...v, synthesizeSpeech: { ...v.synthesizeSpeech, providers } });
    expect(targets.find((t) => t.id === 'consent-co')!.sourceSeconds).toEqual({ min: 10, max: 30 });
    expect(targets.find((t) => t.id === 'elevenlabs')).not.toHaveProperty('sourceSeconds');
  });

  it('从某只模型过来时直接停在样本这一步', () => {
    expect(initialCloneStep('google')).toBe(1);
    expect(initialCloneStep(null)).toBe(0);
  });

  it('选法按当下的模型现算：点过的以点的为准，晚到的模型照默认选上', () => {
    const targets = cloneTargets(view());
    const late = [...targets, { ...targets[0]!, id: 'qwen3-tts-1.7b-base', name: 'Qwen3-TTS 1.7B Base' }];
    expect(defaultPicked(late, 'qwen3-tts-1.7b-base')).toContain('qwen3-tts-1.7b-base');
    const toggled = { 'indextts2': false, elevenlabs: true };
    expect(defaultPicked(late, null, toggled)).toEqual(['qwen3-tts-0.6b-base', 'elevenlabs', 'qwen3-tts-1.7b-base']);
    expect(defaultPicked(late, 'qwen3-tts-1.7b-base', { 'qwen3-tts-1.7b-base': false })).not.toContain('qwen3-tts-1.7b-base');
  });

  it('新音色的默认名字：重名时依次加编号', () => {
    expect(defaultVoiceName('我的声音', [])).toBe('我的声音');
    expect(defaultVoiceName('我的声音', ['千问', '我的声音'])).toBe('我的声音 2');
    expect(defaultVoiceName('我的声音', ['我的声音', '我的声音 2', '我的声音 3 '])).toBe('我的声音 4');
  });

  it('步骤：选中的里有要授权声明录音的才有那一步，点名谁要', () => {
    const targets = cloneTargets(view());
    const local = targets.filter((t) => t.kind === 'local');
    expect(cloneSteps(local).map((s) => s.key)).toEqual(['models', 'sample', 'save']);
    const withConsent = cloneSteps(targets);
    expect(withConsent.map((s) => s.key)).toEqual(['models', 'sample', 'consent', 'save']);
    expect(withConsent[2]!.needed).toEqual(['Consent Co']);
  });

  it('克隆的 Provider 带上要不要授权声明录音', () => {
    expect(cloneProviders(view())).toEqual([
      { providerId: 'elevenlabs', label: 'ElevenLabs', available: false, detail: '没有启用', requiresConsentClip: false, sourceSeconds: null },
      { providerId: 'consent-co', label: 'Consent Co', available: true, detail: null, requiresConsentClip: true, sourceSeconds: null },
    ]);
  });
});

describe('种子', () => {
  const targets: CloneTarget[] = [
    { kind: 'local', id: 'a', name: 'A', consent: false, connected: true, acceptsSeed: true },
    { kind: 'local', id: 'b', name: 'B', consent: false, connected: true, acceptsSeed: false },
    { kind: 'cloud', id: 'c', name: 'C', consent: false, connected: true, acceptsSeed: false },
  ];

  it('界面抽的种子在 1..2^31-1；只给收种子的本机引擎', () => {
    expect(randomSeed(() => 0)).toBe(1);
    expect(randomSeed(() => 0.999999999999)).toBe(2147483646);
    expect(initialSeeds(targets, () => 0.5)).toEqual({ a: 1073741824 });
  });

  it('取种子的次序：这只引擎的，其次兜底的，都没有时 null', () => {
    expect(seedFor({ seeds: { a: 5 }, seed: 9 }, 'a')).toBe(5);
    expect(seedFor({ seeds: { a: 5 }, seed: 9 }, 'b')).toBe(9);
    expect(seedFor({}, 'b')).toBeNull();
    expect(seedFor(null, 'a')).toBeNull();
  });

  it('换一颗只改那一只；* 换兜底的', () => {
    expect(reseeded({ seeds: { a: 1, b: 2 }, seed: 3 }, 'a', 7)).toEqual({ seeds: { a: 7, b: 2 }, seed: 3 });
    expect(reseeded({ seeds: { a: 1 } }, FALLBACK_SEED, 8)).toEqual({ seeds: { a: 1 }, seed: 8 });
    expect(reseeded({}, 'a', 4)).toEqual({ seeds: { a: 4 } });
  });

  it('⋯ 里能换种子的引擎：收种子的本机引擎，加上记着种子但已经不列的', () => {
    expect(reseedTargets({ seeds: { gone: 1 } }, targets)).toEqual(['a', 'gone']);
  });

  it('同一颗种子的几只引擎合在一起，兜底的在后', () => {
    expect(seedGroups({ seeds: { a: 5, b: 6, c: 5 }, seed: 6 })).toEqual([
      { value: 5, ids: ['a', 'c'] },
      { value: 6, ids: ['b', FALLBACK_SEED] },
    ]);
    expect(seedGroups({})).toEqual([]);
  });
});

describe('凭什么认人', () => {
  const clone = (voiceId: string, state: VoiceClone['state']): VoiceClone => ({
    voiceId,
    state,
    referenceHash: 'sha256:r',
    createdAt: '2026-10-14T00:00:00Z',
  });
  const voices = [
    { id: 'v1', content: { name: 'Me', seeds: { a: 11 }, seed: 12 }, clones: { elevenlabs: clone('test-voice-1', 'valid') } },
    { id: 'v2', content: { name: 'Host' }, clones: { elevenlabs: clone('test-voice-2', 'stale') } },
    { id: 'v3', content: { name: 'Other' } },
  ];

  it('云端各家的 voice id，有效的在前', () => {
    expect(voiceIdBindings({ x: clone('old', 'stale'), y: clone('new', 'valid') })).toEqual([
      { providerId: 'y', voiceId: 'new', stale: false },
      { providerId: 'x', voiceId: 'old', stale: true },
    ]);
  });

  it('模型页：本机列每只音色与它的种子，云端只列在这家建过克隆的', () => {
    expect(voicesBoundTo(voices, { kind: 'local', id: 'a' }).map((b) => [b.name, b.seed])).toEqual([
      ['Me', 11],
      ['Host', null],
      ['Other', null],
    ]);
    expect(voicesBoundTo(voices, { kind: 'local', id: 'z' })[0]!.seed).toBe(12);
    expect(voicesBoundTo(voices, { kind: 'cloud', id: 'elevenlabs' }).map((b) => [b.name, b.voiceId, b.stale])).toEqual([
      ['Me', 'test-voice-1', false],
      ['Host', 'test-voice-2', true],
    ]);
  });
});

describe('录音写成 WAV', () => {
  it('多声道取平均、截到上限', () => {
    const mono = downmix([new Float32Array([1, 1, 1, 1]), new Float32Array([0, 0, 0, 0])], 2, 1.5);
    expect([...mono]).toEqual([0.5, 0.5, 0.5]);
  });

  it('16 位单声道 WAV 的头与数据', () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1]), 48_000);
    const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(bytes.byteLength).toBe(50);
  });
});

describe('存下的请求', () => {
  const entry: VoiceEntry = {
    library: 'voices',
    id: 'voc_1',
    version: 4,
    contentHash: 'sha256:c',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    content: {
      name: 'Me',
      language: 'en',
      transcript: 'hello',
      origin: 'recorded',
      consent: { declared: true, declaredAt: '2026-10-01T00:00:00Z', statement: 'mine' },
      reference: { fileName: 'reference.wav', mediaType: 'audio/wav', sha256: 'sha256:r', byteLength: 10 },
      seeds: { a: 1 },
      seed: 2,
    },
  } as VoiceEntry;

  it('克隆新音色：样本是参考录音，种子与授权声明录音一起交', () => {
    const request = captureVoiceRequest({
      name: ' Me ',
      language: 'en',
      transcript: 'line one',
      origin: 'recorded',
      consent: true,
      seeds: { a: 5 },
      samplePath: '/tmp/sample.wav',
      consentClip: { language: 'en-US', text: null, path: '/tmp/consent.wav' },
    });
    expect(request).toMatchObject({
      library: 'voices',
      source: { path: '/tmp/sample.wav' },
      consentSource: { path: '/tmp/consent.wav' },
      content: {
        name: 'Me',
        language: 'en',
        transcript: 'line one',
        origin: 'recorded',
        seeds: { a: 5 },
        consentClip: { language: 'en-US', text: null },
      },
    });
    const bare = captureVoiceRequest({
      name: 'Me',
      language: null,
      transcript: '',
      origin: 'imported',
      consent: true,
      seeds: {},
      samplePath: '/tmp/sample.wav',
      consentClip: null,
    });
    expect(bare).not.toHaveProperty('consentSource');
    expect(bare.content).not.toHaveProperty('seeds');
    expect(bare.content).not.toHaveProperty('consentClip');
  });

  it('补录授权声明与换种子：带版本号，别的不动', () => {
    expect(consentClipRequest(entry, { language: 'custom', text: 'I agree', path: '/tmp/c.wav' })).toMatchObject({
      id: 'voc_1',
      expectedVersion: 4,
      consentSource: { path: '/tmp/c.wav' },
      content: { name: 'Me', consent: { declared: true, statement: 'mine' }, consentClip: { language: 'custom', text: 'I agree' } },
    });
    const reseed = reseedRequest(entry, 'a', 9);
    expect(reseed).toMatchObject({ id: 'voc_1', expectedVersion: 4, content: { seeds: { a: 9 }, seed: 2 } });
    expect(reseed).not.toHaveProperty('source');
    expect(reseed.content).not.toHaveProperty('consentClip');
  });
});

describe('保存后上传到哪', () => {
  const gemini: CloneTarget = {
    kind: 'cloud',
    id: 'google',
    name: 'Google Gemini',
    consent: true,
    connected: true,
    acceptsSeed: false,
    sourceSeconds: { min: 10, max: 30 },
  };
  const eleven: CloneTarget = { kind: 'cloud', id: 'elevenlabs', name: 'ElevenLabs', consent: false, connected: true, acceptsSeed: false };
  const offline: CloneTarget = { ...eleven, id: 'minimax', name: 'MiniMax', connected: false };
  const local: CloneTarget = { kind: 'local', id: 'indextts2', name: 'IndexTTS2', consent: false, connected: true, acceptsSeed: false };
  const ready = { declared: true, consentClip: true, sampleSeconds: 45 };

  it('条件齐了的云端都上传；本机引擎不在里面；比这家收的长时只用前几秒', () => {
    const plan = uploadPlan([local, gemini, eleven], ready);
    expect(plan.map((r) => [r.target.id, r.blockers, r.usesFirst])).toEqual([
      ['google', [], 30],
      ['elevenlabs', [], null],
    ]);
    expect(uploadTargets(plan).map((t) => t.id)).toEqual(['google', 'elevenlabs']);
    expect(uploadPlan([gemini], { ...ready, sampleSeconds: 30.04 })[0]!.usesFirst).toBeNull();
  });

  it('不上传的原因按先后列：没连上、没勾本人声明、样本太短、缺授权声明录音', () => {
    const none = { declared: false, consentClip: false, sampleSeconds: 6 };
    expect(uploadPlan([{ ...gemini, connected: false }], none)[0]!.blockers).toEqual(['offline', 'undeclared', 'too-short', 'no-consent-clip']);
    expect(uploadPlan([offline], ready)[0]!.blockers).toEqual(['offline']);
    expect(uploadPlan([eleven], { ...ready, declared: false })[0]!.blockers).toEqual(['undeclared']);
    expect(uploadPlan([gemini], { ...ready, sampleSeconds: 9.9 })[0]!.blockers).toEqual(['too-short']);
    expect(uploadPlan([gemini], { ...ready, consentClip: false })[0]!.blockers).toEqual(['no-consent-clip']);
    // 不要授权声明录音、没报时长的：只看连没连上与声明。
    expect(uploadPlan([eleven], { declared: true, consentClip: false, sampleSeconds: 6 })[0]!.blockers).toEqual([]);
    expect(uploadTargets(uploadPlan([gemini, eleven], { ...ready, declared: false }))).toEqual([]);
  });

  it('还没有样本时不判长短', () => {
    expect(uploadPlan([gemini], { ...ready, sampleSeconds: null })[0]).toMatchObject({ blockers: [], usesFirst: null });
  });

  it('只用前几秒的几家按秒数分组；本机引擎与没报时长的不算', () => {
    const other: CloneTarget = { ...gemini, id: 'other', name: 'Other' };
    const longer: CloneTarget = { ...gemini, id: 'longer', name: 'Longer', sourceSeconds: { min: 5, max: 60 } };
    expect(firstSecondsUsed([local, gemini, eleven, other, longer], 180)).toEqual([
      { seconds: 30, names: ['Google Gemini', 'Other'] },
      { seconds: 60, names: ['Longer'] },
    ]);
    expect(firstSecondsUsed([gemini], 30)).toEqual([]);
  });

  it('样本比哪几家收的最短还短：取最大的下限', () => {
    const strict: CloneTarget = { ...gemini, id: 'strict', name: 'Strict', sourceSeconds: { min: 15, max: 60 } };
    expect(sampleTooShortFor([local, gemini, strict, eleven], 12)).toEqual({ min: 15, names: ['Strict'] });
    expect(sampleTooShortFor([gemini, strict], 8)).toEqual({ min: 15, names: ['Google Gemini', 'Strict'] });
    expect(sampleTooShortFor([gemini, eleven], 10)).toBeNull();
  });
});

describe('录音音质', () => {
  const SR = 8000;
  /** `seconds` 秒、振幅 `amp` 的 200 Hz 正弦（RMS = amp / √2）。 */
  const sine = (amp: number, seconds: number, sr = SR) =>
    Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * 200 * i) / sr));
  /** 等幅的方波噪声：每个样本 ±amp，RMS = amp。 */
  const hiss = (amp: number, seconds: number, sr = SR) => Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => (i % 2 ? amp : -amp));
  const join = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const clean: TakeAnalysis = { seconds: 20, levelDb: -20, peakDb: -6, clipRatio: 0, silenceRatio: 0.2, noiseFloorDb: -60 };
  const take = (patch: Partial<TakeAnalysis>): TakeAnalysis => ({ ...clean, ...patch });

  it('门槛：削顶 0.5%、底噪 −45 dBFS、太小声 −35 dBFS、静音 −50 dBFS、底噪取开头 0.5 秒', () => {
    expect(TAKE).toMatchObject({ clipWarn: 0.005, noiseWarnDb: -45, quietDb: -35, silenceDb: -50, noiseWindow: 0.5, clipAt: 0.99 });
  });

  it('空的、正弦的读数；采样率不同读数一样', () => {
    expect(analyzeTake(new Float32Array(0), SR)).toEqual({
      seconds: 0,
      levelDb: -120,
      peakDb: -120,
      clipRatio: 0,
      silenceRatio: 1,
      noiseFloorDb: -120,
    });
    const a = analyzeTake(sine(0.5, 2), SR);
    expect(a).toMatchObject({ seconds: 2, levelDb: -9, peakDb: -6, clipRatio: 0, silenceRatio: 0 });
    expect(analyzeTake(sine(0.5, 2, 48_000), 48_000).levelDb).toBe(a.levelDb);
  });

  it('电平只算说话的帧，静音帧算进静音比例；全是静音退回整段 RMS', () => {
    const a = analyzeTake(join(new Float32Array(SR), sine(0.5, 1)), SR);
    expect(a.levelDb).toBe(-9);
    expect(a.silenceRatio).toBe(0.5);
    expect(analyzeTake(hiss(0.001, 1), SR)).toMatchObject({ silenceRatio: 1, levelDb: -60 });
  });

  it('削顶按 |x| ≥ 0.99 数', () => {
    const s = sine(0.3, 1);
    for (let i = 0; i < 80; i++) s[i * 100] = i % 2 ? -1 : 0.995;
    expect(analyzeTake(s, SR).clipRatio).toBe(80 / SR);
  });

  it('底噪取开头 0.5 秒的下四分位：跳过全零，刚开口也不被顶高，后面再吵也不算', () => {
    const room = hiss(0.003, 0.5); // −50.5 dBFS
    expect(analyzeTake(join(room, sine(0.5, 3)), SR).noiseFloorDb).toBe(-50.5);
    expect(analyzeTake(join(new Float32Array(SR * 0.1), hiss(0.003, 0.4), sine(0.5, 3)), SR).noiseFloorDb).toBe(-50.5);
    expect(analyzeTake(join(hiss(0.003, 0.3), sine(0.5, 3)), SR).noiseFloorDb).toBe(-50.5);
    expect(analyzeTake(join(room, sine(0.5, 1), hiss(0.05, 2)), SR).noiseFloorDb).toBe(-50.5);
  });

  it('停下后的毛病：门槛的两边，几乎没声音时只报它，按要紧程度排', () => {
    expect(takeIssues(clean)).toEqual([]);
    expect(takeIssues(null)).toEqual([]);
    expect(takeIssues(take({ clipRatio: 0.005 }))).toEqual([]);
    expect(takeIssues(take({ clipRatio: 0.0051 }))).toEqual(['clipping']);
    expect(takeIssues(take({ noiseFloorDb: -45 }))).toEqual([]);
    expect(takeIssues(take({ noiseFloorDb: -44.9 }))).toEqual(['noisy']);
    expect(takeIssues(take({ levelDb: -35 }))).toEqual([]);
    expect(takeIssues(take({ levelDb: -35.1 }))).toEqual(['quiet']);
    expect(takeIssues(take({ silenceRatio: 0.5 }))).toEqual([]);
    expect(takeIssues(take({ silenceRatio: 0.51 }))).toEqual(['pauses']);
    expect(takeIssues(take({ silenceRatio: 0.95, clipRatio: 0.1 }))).toEqual(['silent']);
    expect(takeIssues(take({ clipRatio: 0.02, noiseFloorDb: -40, silenceRatio: 0.6 }))).toEqual(['clipping', 'noisy', 'pauses']);
  });

  it('录音中那一行：爆音 > 3 秒没声音 > 太小声 > 太吵 > 等开口 > 合适', () => {
    const hint = (o: { recent?: Partial<TakeAnalysis> | null; noiseFloorDb?: number | null; heard?: boolean }, seconds = 5) =>
      liveTakeHint(
        {
          recent: o.recent === null ? null : take(o.recent ?? {}),
          noiseFloorDb: o.noiseFloorDb === undefined ? -60 : o.noiseFloorDb,
          heard: o.heard ?? true,
        },
        seconds,
      );
    expect(hint({})).toBe('ok');
    expect(hint({ recent: { clipRatio: 0.002 }, noiseFloorDb: -40 })).toBe('clipping');
    expect(hint({ recent: { clipRatio: 0.001 } }), '0.1% 以内不打扰').toBe('ok');
    expect(hint({ heard: false, recent: { silenceRatio: 1, levelDb: -70 } }, 3)).toBe('silent');
    expect(hint({ heard: false, recent: { silenceRatio: 1, levelDb: -70 } }, 2.9)).toBe('waiting');
    expect(hint({ recent: { levelDb: -40 }, noiseFloorDb: -40 })).toBe('quiet');
    expect(hint({ recent: { levelDb: -70, silenceRatio: 1 } }), '说话中间停一下不算太小声').toBe('ok');
    expect(hint({ noiseFloorDb: -40 })).toBe('noisy');
    expect(hint({ noiseFloorDb: null, heard: false, recent: null }, 0.3)).toBe('waiting');
    expect(hint({ noiseFloorDb: -40, heard: false }, 1), '没开口也先说吵').toBe('noisy');
  });

  it('录音中每 0.1 秒喂一帧：开头 0.5 秒量底噪，听到声音记下，只看最近 1.5 秒', () => {
    const frame = (f: Float32Array, i: number) => f.subarray(Math.round(i * 0.1 * SR), Math.round(i * 0.1 * SR) + 400);
    const audio = join(hiss(0.003, 0.8), sine(0.5, 1.2), sine(1.2, 0.5)); // 安静 → 说话 → 爆音
    let live = startLiveTake(SR);
    const seen: string[] = [];
    for (let i = 1; i <= 25; i++) {
      live = feedLiveTake(live, frame(audio, i - 1), i * 0.1);
      seen.push(liveTakeHint(live, i * 0.1));
      if (i === 5) expect(live.noiseFloorDb, '0.5 秒还在量').toBeNull();
      if (i === 6) expect(live.noiseFloorDb).toBe(-50.5);
    }
    expect(seen.slice(0, 8).every((h) => h === 'waiting')).toBe(true);
    expect(seen[9]).toBe('ok');
    expect(seen[24]).toBe('clipping');
    expect(live.frames.length, '最近 1.5 秒').toBe(15);
    expect(live.head, '量完就不留了').toEqual([]);
    // 复制了帧：AnalyserNode 复用同一块缓冲
    const buf = sine(0.5, 0.05);
    const fed = feedLiveTake(startLiveTake(SR), buf, 0.1);
    buf.fill(0);
    expect(fed.frames[0]![10]).not.toBe(0);
  });

  it('同一只麦克风：知道物理设备就按它比（系统默认也认得出），否则按选的设备比', () => {
    expect(sameMic({ id: 'default', group: 'g1' }, { id: 'builtin', group: 'g1' })).toBe(true);
    expect(sameMic({ id: 'builtin', group: 'g1' }, { id: 'airpods', group: 'g2' })).toBe(false);
    expect(sameMic({ id: 'default' }, { id: 'builtin', group: 'g1' })).toBe(false);
    expect(sameMic({ id: 'builtin' }, { id: 'builtin' })).toBe(true);
  });

  it('授权声明和样本不是同一只麦克风', () => {
    const sample: TakeSource = { via: 'mic', mic: { id: 'builtin' } };
    expect(micMismatch(sample, null, { id: 'builtin' })).toBe(false);
    expect(micMismatch(sample, null, { id: 'airpods' }), '还没录：看现在选的').toBe(true);
    expect(micMismatch(sample, { via: 'mic', mic: { id: 'airpods' } }, { id: 'builtin' }), '录好了：看录时用的').toBe(true);
    expect(micMismatch(sample, { via: 'mic', mic: { id: 'builtin' } }, { id: 'airpods' })).toBe(false);
    expect(micMismatch(sample, { via: 'upload' }, { id: 'airpods' }), '授权声明是上传的不比').toBe(false);
    expect(micMismatch({ via: 'upload' }, null, { id: 'airpods' }), '样本是上传的不比').toBe(false);
    expect(micMismatch(null, null, { id: 'airpods' })).toBe(false);
    expect(micMismatch(sample, null, null)).toBe(false);
  });

  it('保存前只报削顶 > 0.5%、底噪 > −45 dBFS 与换了麦克风；干净的不说话', () => {
    const mic = (a: TakeAnalysis, id = 'builtin'): TakeSource => ({ via: 'mic', mic: { id }, analysis: a });
    expect(saveTakeWarnings({ sample: mic(clean), consent: mic(clean) })).toEqual([]);
    expect(saveTakeWarnings({ sample: mic(take({ levelDb: -40, silenceRatio: 0.7 })) }), '太小声、停顿多只在停下时说').toEqual([]);
    expect(saveTakeWarnings({ sample: mic(take({ clipRatio: 0.005, noiseFloorDb: -45 })) }), '正好在门槛上').toEqual([]);
    const list = saveTakeWarnings({ sample: mic(take({ clipRatio: 0.012 })), consent: mic(take({ noiseFloorDb: -40 }), 'airpods') });
    expect(list).toEqual([
      { step: 'sample', kind: 'clipping' },
      { step: 'consent', kind: 'noisy' },
      { step: 'consent', kind: 'mic' },
    ]);
    expect(redoSteps(list)).toEqual(['sample', 'consent']);
    expect(redoSteps([{ step: 'consent', kind: 'mic' }])).toEqual(['consent']);
    expect(saveTakeWarnings({ sample: mic(clean), consent: null }), '授权声明这次不上传：不比麦克风').toEqual([]);
    expect(saveTakeWarnings({ sample: null, consent: mic(take({ clipRatio: 0.02 })) }), '单步补录只看授权声明').toEqual([
      { step: 'consent', kind: 'clipping' },
    ]);
  });
});
