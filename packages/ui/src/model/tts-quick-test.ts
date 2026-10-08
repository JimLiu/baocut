import { intlLocale, live, type JobRecord, type ModelBundleStatus, type SpeechModelInfo, type SynthesizeSpeechRequest } from '@baocut/protocol';
import { languageName } from './caption-tracks.ts';
import { isBundleInstalled } from './models-local.ts';
import { canClone, quickKind, type QuickKind } from './models-tts-local.ts';
import { M } from './tts-quick-test-copy.ts';

/**
 * 本地语音合成的「试听」（设计稿 settings-tts.jsx 的 TtsQuickTest、model-tts.js 的 `quick*`）：芯片只改选择，
 * 点「生成试听」才提交一次真实的 `models.synthesizeSpeech`（`provider: 'local'`，`model` = 模型包）。结果带着自己的身份
 * （`quickKey` = 请求本身），选择一变旧结果就只是「上一次」的。示例台词、快捷音色与语气照设计稿。
 */

/* ---------- 示例台词（设计稿 SAMPLE_KINDS / SAMPLE_LINES：十一门语言 × 三句） ---------- */

export type SampleKind = 'intro' | 'numbers' | 'mood';
export const SAMPLE_KINDS: readonly { k: SampleKind; label: string }[] = [
  {
    k: 'intro',
    get label() {
      return M.kindIntro;
    },
  },
  {
    k: 'numbers',
    get label() {
      return M.kindNumbers;
    },
  },
  {
    k: 'mood',
    get label() {
      return M.kindMood;
    },
  },
];

/** 示例台词按台词的语言固定，不随界面语言变。 */
// i18n-ignore-start: 示例台词按台词语言固定，不随界面语言
export const SAMPLE_LINES: readonly { code: string; kind: SampleKind; text: string }[] = [
  { code: 'zh', kind: 'intro', text: '欢迎使用 BaoCut！转录、翻译、配音，全都在你自己的电脑上完成。' },
  { code: 'zh', kind: 'numbers', text: '这条 4K 片段 3 分 28 秒，导出只用了 1 分 12 秒。' },
  { code: 'zh', kind: 'mood', text: '是不是快得有点不像话？而且素材从头到尾没离开过你的电脑！' },
  { code: 'en', kind: 'intro', text: 'Welcome to BaoCut! Transcribe, translate and voice over, all on your own machine.' },
  { code: 'en', kind: 'numbers', text: 'This 4K clip runs 3 minutes 28 seconds, and the export took just 1 minute 12.' },
  { code: 'en', kind: 'mood', text: "Fast, isn't it? And your footage never leaves your computer!" },
  { code: 'ja', kind: 'intro', text: 'BaoCut へようこそ！文字起こしも翻訳も吹き替えも、ぜんぶ自分のパソコンで終わります。' },
  { code: 'ja', kind: 'numbers', text: 'この 4K クリップは 3 分 28 秒、書き出しはたったの 1 分 12 秒でした。' },
  { code: 'ja', kind: 'mood', text: '驚くほど速いでしょう？素材は一度もパソコンから出ていません！' },
  { code: 'ko', kind: 'intro', text: 'BaoCut에 오신 것을 환영합니다! 전사, 번역, 더빙까지 모두 내 컴퓨터에서 끝납니다.' },
  { code: 'ko', kind: 'numbers', text: '이 4K 클립은 3분 28초이고, 내보내기는 1분 12초밖에 걸리지 않았습니다.' },
  { code: 'ko', kind: 'mood', text: '놀랄 만큼 빠르죠? 게다가 소재는 컴퓨터 밖으로 나가지 않습니다!' },
  { code: 'es', kind: 'intro', text: '¡Bienvenido a BaoCut! Transcribe, traduce y dobla, todo en tu propio equipo.' },
  { code: 'es', kind: 'numbers', text: 'Este clip en 4K dura 3 minutos y 28 segundos, y exportarlo llevó solo 1 minuto y 12.' },
  { code: 'es', kind: 'mood', text: '¿A que es rapidísimo? ¡Y tu material nunca sale de tu ordenador!' },
  { code: 'de', kind: 'intro', text: 'Willkommen bei BaoCut! Transkribieren, Übersetzen und Vertonen, alles auf deinem eigenen Rechner.' },
  { code: 'de', kind: 'numbers', text: 'Dieser 4K-Clip dauert 3 Minuten und 28 Sekunden, der Export nur 1 Minute 12.' },
  { code: 'de', kind: 'mood', text: 'Ganz schön schnell, oder? Und dein Material verlässt deinen Rechner nie!' },
  { code: 'fr', kind: 'intro', text: 'Bienvenue dans BaoCut ! Transcription, traduction et doublage, tout se passe sur votre ordinateur.' },
  { code: 'fr', kind: 'numbers', text: "Ce clip 4K dure 3 minutes 28, et l'export n'a pris qu'une minute 12." },
  { code: 'fr', kind: 'mood', text: 'Plutôt rapide, non ? Et vos rushes ne quittent jamais votre ordinateur !' },
  { code: 'it', kind: 'intro', text: 'Benvenuto in BaoCut! Trascrizione, traduzione e doppiaggio, tutto sul tuo computer.' },
  { code: 'it', kind: 'numbers', text: "Questa clip in 4K dura 3 minuti e 28 secondi, e l'esportazione ha richiesto solo 1 minuto e 12." },
  { code: 'it', kind: 'mood', text: 'Veloce, vero? E il tuo materiale non lascia mai il computer!' },
  { code: 'pt', kind: 'intro', text: 'Bem-vindo ao BaoCut! Transcrição, tradução e dublagem, tudo no seu próprio computador.' },
  { code: 'pt', kind: 'numbers', text: 'Este clipe em 4K tem 3 minutos e 28 segundos, e a exportação levou apenas 1 minuto e 12.' },
  { code: 'pt', kind: 'mood', text: 'Rápido, não é? E o seu material nunca sai do seu computador!' },
  { code: 'ru', kind: 'intro', text: 'Добро пожаловать в BaoCut! Расшифровка, перевод и озвучка — всё на вашем компьютере.' },
  { code: 'ru', kind: 'numbers', text: 'Этот 4K-фрагмент длится 3 минуты 28 секунд, а экспорт занял всего 1 минуту 12 секунд.' },
  { code: 'ru', kind: 'mood', text: 'Быстро, правда? И ваши материалы никогда не покидают компьютер!' },
  { code: 'ar', kind: 'intro', text: 'مرحبًا بك في BaoCut! التفريغ والترجمة والدبلجة، كلها تتم على جهازك.' },
  { code: 'ar', kind: 'numbers', text: 'هذا المقطع بدقة 4K مدته 3 دقائق و28 ثانية، والتصدير استغرق دقيقة و12 ثانية فقط.' },
  { code: 'ar', kind: 'mood', text: 'سريع، أليس كذلك؟ وموادك لا تغادر جهازك أبدًا!' },
];
// i18n-ignore-end

const SAMPLE_CODES = [...new Set(SAMPLE_LINES.map((l) => l.code))];

/**
 * 这只模型能试听哪几门语言：模型声明的语言里有示例台词的，按示例表的次序；不限语言（`any`）时示例表的每一门都给。
 * 声明了但没有示例台词的语言不给芯片——那门语言可以用「自己写一句」念。不假定中文或英文。
 */
export function sampleLangs(model: Pick<SpeechModelInfo, 'languages'>): { code: string; label: string }[] {
  const declared = model.languages;
  const codes = declared === 'any' ? SAMPLE_CODES : SAMPLE_CODES.filter((c) => declared.some((d) => d.toLowerCase().split('-')[0] === c));
  return codes.map((code) => ({ code, label: languageName(code) }));
}

/** 这门语言有哪几种台词。 */
export function sampleKinds(code: string): { k: SampleKind; label: string }[] {
  return SAMPLE_KINDS.filter((k) => SAMPLE_LINES.some((l) => l.code === code && l.kind === k.k));
}

/** 按语言 + 台词种类取示例句；缺这一种就退到这门语言的第一句，再退到表头。 */
export function sampleLine(code: string | null, kind: SampleKind): { code: string; kind: SampleKind; text: string } {
  return SAMPLE_LINES.find((l) => l.code === code && l.kind === kind) ?? SAMPLE_LINES.find((l) => l.code === code) ?? SAMPLE_LINES[0]!;
}

/* ---------- 音色 ---------- */

/** Qwen3-TTS CustomVoice 的说话人：名字是权重里的标识，不翻译；副题是听感（设计稿 PRESETS）。 */
export const PRESET_SUB: Readonly<Record<string, string>> = live(() => M.presetSub);
/** 行上直接露出的四个预设，男女各两；其余收进「更多音色」。 */
export const QUICK_PRESETS: readonly string[] = ['Vivian', 'Serena', 'Eric', 'Uncle_Fu'];

/**
 * 内置音色的名字与录音时长（设计稿 BUILTIN_REFS；录音、原文与出处在 Runtime 的 packages/models/src/speech-voices.ts，
 * 模型描述只给 `voiceId` 与语言）。
 */
const BUILTIN_SECONDS: Readonly<Record<string, number>> = {
  'zh-female': 6.72,
  'zh-male': 6.16,
  'en-female': 7.32,
  'en-male': 6.9,
  'ja-female': 8.44,
  'ja-male': 6.4,
  'es-female': 6.92,
  'es-male': 7.86,
};
export const BUILTIN_VOICE_INFO: Readonly<Record<string, { label: string; seconds: number }>> = live(() =>
  Object.fromEntries(Object.entries(BUILTIN_SECONDS).map(([id, seconds]) => [id, { label: M.builtinVoice[id] ?? id, seconds }])),
);
/** 芯片上直接露出的四只内置音色，其余收进「更多音色」。 */
export const QUICK_BUILTINS: readonly string[] = ['zh-female', 'zh-male', 'en-female', 'en-male'];
/** 内置音色录音的出处（设计稿 REF_CREDIT）。 */
export const builtinCredit = (): string => M.builtinCredit;

/** 秒数按当前语言写数字（`min` / `max` 位小数）。 */
function formatSeconds(seconds: number, max: number, min = 0): string {
  return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false }).format(seconds);
}

export function builtinLabel(id: string): string {
  return BUILTIN_VOICE_INFO[id]?.label ?? id;
}

/** 「按描述造声音」的三句现成描述（设计稿 DESCRIBE_VOICES），给只认自由描述的模型。 */
export const DESCRIBE_VOICES: readonly { k: string; label: string; text: string }[] = [
  {
    k: 'warm',
    get label() {
      return M.describeWarm;
    },
    get text() {
      return M.describeWarmText;
    },
  },
  {
    k: 'anchor',
    get label() {
      return M.describeAnchor;
    },
    get text() {
      return M.describeAnchorText;
    },
  },
  {
    k: 'bright',
    get label() {
      return M.describeBright;
    },
    get text() {
      return M.describeBrightText;
    },
  },
];

/**
 * 试听的语气（设计稿 INSTRUCT_TONES）：只给预设说话人、且接受风格说明（`instructions: 'style'`）的模型——落成 `instructions`。
 * 设计稿给 IndexTTS 的情绪档（EMOTION_TONES）这一版的请求带不了，不画。
 */
export const INSTRUCT_TONES: readonly { k: string; label: string; text?: string }[] = [
  {
    k: 'upbeat',
    get label() {
      return M.toneUpbeat;
    },
    get text() {
      return M.toneUpbeatText;
    },
  },
  {
    k: 'natural',
    get label() {
      return M.toneNatural;
    },
  },
  {
    k: 'anchor',
    get label() {
      return M.toneAnchor;
    },
    get text() {
      return M.toneAnchorText;
    },
  },
  {
    k: 'soft',
    get label() {
      return M.toneSoft;
    },
    get text() {
      return M.toneSoftText;
    },
  },
];

export function quickTones(model: SpeechModelInfo): readonly { k: string; label: string; text?: string }[] {
  return quickKind(model) === 'preset' && model.local?.instructions === 'style' ? INSTRUCT_TONES : [];
}

/** 音色芯片与「更多音色」的一项。 */
export interface VoiceOption {
  key: string;
  label: string;
  /** 次要说明（悬停提示 / 菜单副题）。 */
  sub?: string;
}

/** 「我的声音」里的一只（`library:<id>` 交给克隆模型）。 */
export interface MyVoice {
  id: string;
  name: string;
}

export const DEFAULT_VOICE = 'default';
export const FILE_VOICE = 'file';
export const CUSTOM_DESCRIBE = 'describe';
export const MY_PREFIX = 'my:';

const builtinIds = (model: SpeechModelInfo) => model.voices.filter((v) => v.source === 'builtin').map((v) => v.voiceId);
const speakerIds = (model: SpeechModelInfo) => model.voices.filter((v) => v.source !== 'builtin').map((v) => v.voiceId);
const quickSpeakers = (model: SpeechModelInfo) => {
  const ids = speakerIds(model);
  const quick = QUICK_PRESETS.filter((id) => ids.includes(id));
  return quick.length ? quick : ids.slice(0, 4);
};

/**
 * 快捷音色（设计稿 `quickVoices`）：预设模型给四个说话人；按描述造声的给快捷四只内置音色（在它身上是一句描述）+ 三句现成描述
 * + 自己描述；能克隆的给默认音色、我的声音、快捷四只内置音色与「临时用一段」。
 */
export function quickVoices(model: SpeechModelInfo, mine: readonly MyVoice[]): VoiceOption[] {
  const kind = quickKind(model);
  if (kind === 'preset') return quickSpeakers(model).map((id) => ({ key: id, label: PRESET_SUB[id] ?? id, sub: id }));
  const builtins = QUICK_BUILTINS.filter((id) => builtinIds(model).includes(id)).map((id) => ({ key: id, label: builtinLabel(id) }));
  if (kind === 'describe') {
    return [
      ...builtins,
      ...DESCRIBE_VOICES.map((v) => ({ key: v.k, label: v.label, sub: v.text })),
      { key: CUSTOM_DESCRIBE, label: M.customDescribe },
    ];
  }
  return [
    { key: DEFAULT_VOICE, label: M.defaultVoice },
    ...mine.map((v) => ({ key: MY_PREFIX + v.id, label: v.name, sub: M.myVoices })),
    ...builtins,
    { key: FILE_VOICE, label: M.fileVoice },
  ];
}

/** 「更多音色」：预设模型收其余的说话人，其余收快捷四只之外的内置音色。 */
export function moreVoices(model: SpeechModelInfo): VoiceOption[] {
  if (quickKind(model) === 'preset') {
    const quick = quickSpeakers(model);
    return speakerIds(model)
      .filter((id) => !quick.includes(id))
      .map((id) => ({ key: id, label: PRESET_SUB[id] ?? id, sub: id }));
  }
  return builtinIds(model)
    .filter((id) => !QUICK_BUILTINS.includes(id))
    .map((id) => {
      const info = BUILTIN_VOICE_INFO[id];
      return { key: id, label: builtinLabel(id), ...(info ? { sub: M.seconds(formatSeconds(info.seconds, 2)) } : {}) };
    });
}

/** 这门语言的内置音色：先找女声，再找这门语言的第一只，都没有时取第一只（与 Runtime 的 `defaultBuiltinVoice` 同口径）。 */
export function defaultBuiltin(model: SpeechModelInfo, lang: string | null): string | null {
  const builtins = model.voices.filter((v) => v.source === 'builtin');
  const same = lang ? builtins.filter((v) => v.language === lang) : [];
  return (same.find((v) => v.voiceId.endsWith('-female')) ?? same[0] ?? builtins[0])?.voiceId ?? null;
}

/* ---------- 选择 → 请求 ---------- */

/** 这一行试听的选择（按模型在本次页面会话里留着）。 */
export interface QuickPick {
  lang: string | null;
  kind: SampleKind;
  voice: string;
  /** 用户自己点过音色：没点过时换语言，默认的内置音色跟着语言走。 */
  voicePicked: boolean;
  tone: string;
  /** 「自己写一句」开着：念 `draft`，否则念示例台词。关上时写过的那句留着。 */
  editing: boolean;
  draft: string;
  /** 「自己描述」的那句话。 */
  describe: string;
  /** 「临时用一段」：自己选的录音，或「用示例录音」放进来的内置音色。 */
  file: { path: string; name: string } | null;
  sample: string | null;
  /** 自己选的录音的原文（模型读原文时可填）。 */
  transcript: string;
}

export function quickDefaults(model: SpeechModelInfo): QuickPick {
  const langs = sampleLangs(model);
  const lang = langs[0]?.code ?? null;
  const kind = quickKind(model);
  const voice =
    kind === 'preset'
      ? (quickSpeakers(model)[0] ?? '')
      : (defaultBuiltin(model, lang) ?? (kind === 'describe' ? CUSTOM_DESCRIBE : DEFAULT_VOICE));
  const tones = quickTones(model);
  return {
    lang,
    kind: 'intro',
    voice,
    voicePicked: false,
    tone: tones[0]?.k ?? 'natural',
    editing: false,
    draft: '',
    describe: '',
    file: null,
    sample: null,
    transcript: '',
  };
}

/** 换语言：想听同一句换种语言念，台词种类留着（这门语言没有就落回第一句）；没点过音色时默认的内置音色跟着语言走。 */
export function chooseLang(model: SpeechModelInfo, pick: QuickPick, lang: string): QuickPick {
  const next: QuickPick = { ...pick, lang, kind: sampleLine(lang, pick.kind).kind, editing: false };
  if (!pick.voicePicked && quickKind(model) !== 'preset') {
    const builtin = defaultBuiltin(model, lang);
    if (builtin) next.voice = builtin;
  }
  return next;
}

/** 点了一个音色芯片或「更多音色」里的一项。 */
export function chooseVoice(pick: QuickPick, voice: string): QuickPick {
  return { ...pick, voice, voicePicked: true };
}

/** 选好了一段自己的录音（换掉示例录音）。 */
export function chooseFile(pick: QuickPick, path: string): QuickPick {
  const name = path.split(/[\\/]/).pop() || path;
  return { ...pick, voice: FILE_VOICE, voicePicked: true, file: { path, name }, sample: null };
}

/** 「用示例录音」：拿这门语言的内置音色当参考（它就是一段随应用分发的录音），不用去找文件。 */
export function chooseSample(model: SpeechModelInfo, pick: QuickPick): QuickPick {
  const sample = defaultBuiltin(model, pick.lang);
  return sample ? { ...pick, voice: FILE_VOICE, voicePicked: true, sample, file: null } : pick;
}

export type QuickRequest = Omit<SynthesizeSpeechRequest, 'commandId'>;

export interface QuickForm {
  /** 能提交时的请求；有问题时 null。 */
  request: QuickRequest | null;
  /** 按下「生成试听」时要说清楚的第一个问题（按钮不置灰，按下再说）。 */
  problem: string | null;
  /** 结果的身份：同一身份的结果就是「现在这组选择」念出来的。 */
  key: string;
}

/** 正在念的文字：「自己写一句」开着时是写的那句，否则是示例台词。 */
export function quickText(pick: QuickPick): string {
  return pick.editing ? pick.draft : sampleLine(pick.lang, pick.kind).text;
}

/**
 * 选择 → `models.synthesizeSpeech` 的请求（设计稿 `quickForm` + `validatePreview`）。`voice`、`reference` 与 `voiceDescription`
 * 至多给一个（Runtime 同样拒绝多给）。念示例台词时带上语言；自己写的一句不猜语言。
 */
export function quickForm(model: SpeechModelInfo, pick: QuickPick, mine: readonly MyVoice[]): QuickForm {
  const kind = quickKind(model);
  const text = quickText(pick);
  const base: QuickRequest = { text, provider: 'local', model: model.modelId };
  if (!pick.editing && pick.lang) base.language = pick.lang;
  const tone = quickTones(model).find((t) => t.k === pick.tone);
  if (tone?.text) base.instructions = tone.text;

  let request: QuickRequest = base;
  let problem: string | null = null;
  if (!text.trim()) problem = M.textRequired;
  else if ([...text].length > model.maxInputChars) problem = M.textTooLong(model.maxInputChars);

  if (kind === 'preset') {
    request = { ...base, voice: pick.voice };
  } else if (kind === 'describe') {
    const preset = DESCRIBE_VOICES.find((v) => v.k === pick.voice);
    if (pick.voice === CUSTOM_DESCRIBE) {
      if (!pick.describe.trim()) problem ??= M.describeRequired;
      request = { ...base, voiceDescription: pick.describe.trim() };
    } else if (preset) request = { ...base, voiceDescription: preset.text };
    else request = { ...base, voice: pick.voice };
  } else if (pick.voice === DEFAULT_VOICE) {
    request = base;
  } else if (pick.voice.startsWith(MY_PREFIX)) {
    const id = pick.voice.slice(MY_PREFIX.length);
    if (!mine.some((v) => v.id === id)) problem ??= M.myVoiceGone;
    request = { ...base, voice: `library:${id}` };
  } else if (pick.voice === FILE_VOICE) {
    if (pick.sample) request = { ...base, voice: pick.sample };
    else if (pick.file) {
      const transcript = model.local?.reference?.acceptsTranscript ? pick.transcript.trim() : '';
      request = { ...base, reference: { file: pick.file.path, ...(transcript ? { transcript } : {}) } };
    } else problem ??= M.referenceRequired;
  } else {
    request = { ...base, voice: pick.voice };
  }
  return { request: problem ? null : request, problem, key: JSON.stringify(request) };
}

/* ---------- 进度与结果 ---------- */

/**
 * 在跑的试听写到哪一步：排队 → 加载模型 → 合成（Worker 报了步数时写第几步）→ 写出音频。Worker 自己的参考录音准备与编码
 * 不单独成为任务阶段，只有合成的步数会转到任务进度里。
 */
export function quickPhase(job: JobRecord | undefined): { label: string; percent: number | null } {
  if (!job) return { label: M.phaseSubmitting, percent: null };
  switch (job.phase) {
    case 'queued':
      return { label: M.phaseQueued, percent: null };
    case 'starting':
    case 'loading':
      return { label: M.phaseLoading, percent: null };
    case 'generating': {
      const p = job.progress;
      if (p && p.unit === 'steps' && p.total) {
        return { label: M.phaseGeneratingStep(Math.min(p.done + 1, p.total), p.total), percent: Math.round((p.done / p.total) * 100) };
      }
      return { label: M.phaseGenerating, percent: null };
    }
    case 'validating':
    case 'publishing':
    case 'encoding':
    case 'finalizing':
      return { label: M.phaseWriting, percent: 100 };
    default:
      return { label: M.phasePreparing, percent: null };
  }
}

/** 结果行这一段用的是哪只音色（设计稿 `quickSummary` 的 voice）。 */
export function voiceLabel(model: SpeechModelInfo, pick: QuickPick, mine: readonly MyVoice[]): string {
  const kind = quickKind(model);
  if (kind === 'preset') return pick.voice;
  if (kind === 'describe') {
    if (pick.voice === CUSTOM_DESCRIBE) return M.customDescribe;
    return DESCRIBE_VOICES.find((v) => v.k === pick.voice)?.label ?? builtinLabel(pick.voice);
  }
  if (pick.voice === DEFAULT_VOICE) return M.defaultVoice;
  if (pick.voice.startsWith(MY_PREFIX)) return mine.find((v) => MY_PREFIX + v.id === pick.voice)?.name ?? M.myVoices;
  if (pick.voice === FILE_VOICE) return pick.sample ? M.sampleVoice(builtinLabel(pick.sample)) : (pick.file?.name ?? M.fileVoice);
  return builtinLabel(pick.voice);
}

/**
 * 结果行：「Vivian · 热情洋溢 · 中文 · 用时 1.6 秒 · 音频 3.9 秒」。台词不是介绍时写出种类；自己写的一句写「自定义文本」。
 * 用时与音频时长都取任务的真实数字，没有就不写。
 */
export function quickSummary(
  model: SpeechModelInfo,
  pick: QuickPick,
  mine: readonly MyVoice[],
  facts: { seconds: number | null; audioSec: number | null },
): string {
  const voice = voiceLabel(model, pick, mine);
  const tone = quickTones(model).find((t) => t.k === pick.tone && t.k !== 'natural');
  const kind = SAMPLE_KINDS.find((k) => k.k === pick.kind);
  const said = pick.editing
    ? M.customText
    : pick.lang
      ? kind && kind.k !== 'intro'
        ? `${languageName(pick.lang)} · ${kind.label}`
        : languageName(pick.lang)
      : '';
  const parts = [tone ? `${voice} · ${tone.label}` : voice, said];
  if (facts.seconds !== null) parts.push(M.elapsed(formatSeconds(facts.seconds, 1, 1)));
  if (facts.audioSec !== null) parts.push(M.audioLength(formatSeconds(facts.audioSec, 1, 1)));
  return parts.filter(Boolean).join(' · ');
}

/* ---------- 「我的声音」的试听克隆 ---------- */

/** 「我的声音」挑模型的次序（设计稿 model-voices.js CLONE_MODELS），按模型包 ID 的 `@` 前一段比；表外能克隆的排在后面。 */
export const CLONE_ORDER: readonly string[] = [
  'indextts2',
  'qwen3-tts-0.6b-base',
  'gpt-sovits-v2',
  'index-tts2.5',
  'qwen3-tts-1.7b-base',
  'voxcpm2',
];

/** 「试听克隆」去哪一行：装好了的、能克隆的模型包里按 `CLONE_ORDER` 取第一只；一只都没装时 null。 */
export function auditionBundle(bundles: readonly ModelBundleStatus[], models: ReadonlyMap<string, SpeechModelInfo>): string | null {
  const rank = (id: string) => {
    const i = CLONE_ORDER.indexOf(id.split('@')[0]!);
    return i < 0 ? CLONE_ORDER.length : i;
  };
  const candidates = bundles
    .filter((b) => b.capability === 'synthesize' && isBundleInstalled(b))
    .filter((b) => {
      const model = models.get(b.bundleId);
      return !!model && canClone(model);
    })
    .sort((a, b) => rank(a.bundleId) - rank(b.bundleId) || a.bundleId.localeCompare(b.bundleId));
  return candidates[0]?.bundleId ?? null;
}

export type { QuickKind };
