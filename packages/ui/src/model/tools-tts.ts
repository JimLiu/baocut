import type { GeneratedOutput, JobRecord, LibraryEntrySummary, SpeechFormat, SpeechModelInfo, SynthesizeSpeechRequest } from '@baocut/protocol';
import { clip } from './task-list.ts';
import {
  codePoints,
  detectLang,
  langName,
  languagesShort,
  modelKeyOf,
  parseSeed,
  primaryLanguage,
  speaks,
  type ToolModelOption,
} from './tools-models.ts';
import { M, oneDecimal } from './tools-tts-copy.ts';
import { VOICE_CLONE_PROVIDERS } from './voices-library.ts';

/**
 * 生成语音工作台（设计稿 tool-tts.jsx 的云端部分、model-tools.js、model-cloud-tts.js、model-tts.js）：
 * 表单、校验、请求与记录卡。只认 `generation-options` 收的参数：音色、语言、格式、风格说明、语速、种子；
 * 文字超过模型上限时 Runtime 在提交时拒绝（不切段），这里先拦下来说清楚。
 */

export type SpeechOption = ToolModelOption<SpeechModelInfo>;

/** 没写文字时那一句（设计稿 tool-tts.jsx `EMPTY_TEXT`）：按下「生成语音」之前不念它。 */
export function emptyText(): string {
  return M.emptyText;
}

/** 「填一段示例」（设计稿的 intro 示例句）：按要念的语言挑，不随界面语言变。 */
export const TTS_SAMPLES = {
  // i18n-ignore: 中文示例句，给会念中文的模型念，按念的语言挑选
  zh: '欢迎使用 BaoCut！转录、翻译、配音，全都在你自己的电脑上完成。',
  en: 'Welcome to BaoCut! Transcribe, translate and voice over, all on your own machine.',
} as const;

/** 现成的念法（设计稿 model-tools.js `VIBES`）：点一下把这句填进「风格」。 */
function vibe<K extends keyof typeof M.vibes>(key: K) {
  return {
    key,
    get name(): string {
      return M.vibes[key].name;
    },
    get style(): string {
      return M.vibes[key].style;
    },
  };
}
export const VIBES = [vibe('radio'), vibe('launch'), vibe('bedtime'), vibe('news'), vibe('teach'), vibe('vlog')] as const;

/**
 * 音色的选法：模型的默认音色、它列出的某个预置音色、手填供应商账号里的音色 ID（模型收 `custom` 时），
 * 或我的声音里的一只（`library:<条目 ID>`：Runtime 用它在所选 Provider 上的有效克隆合成）。
 */
export type VoiceKey = 'default' | 'custom' | `preset:${string}` | `library:${string}`;

/** 我的声音（用户库 `voices` 的摘要）；null 为还没读到。 */
export type MyVoices = readonly LibraryEntrySummary[] | null;

export interface TtsDraft {
  text: string;
  /** `providerId/modelId`；null 为还没选。 */
  model: string | null;
  voice: VoiceKey;
  customVoice: string;
  /** 风格说明（只在模型收 `instructions` 时发）。 */
  instructions: string;
  /** 语速；null 为没拨过（不传，用供应商的默认）。 */
  speed: number | null;
  /** 种子（只在模型收 `seed` 时发）；空为不给。 */
  seed: string;
  /** null 为模型的默认格式。 */
  format: SpeechFormat | null;
  /** BCP 47；空为自动（不传）。 */
  language: string;
}

export const BLANK_TTS: TtsDraft = {
  text: '',
  model: null,
  voice: 'default',
  customVoice: '',
  instructions: '',
  speed: null,
  seed: '',
  format: null,
  language: '',
};

// ---- 文字 ----

/** 分段（设计稿 model-tts.js `segments`）：句号、问号、感叹号后，英文句点加空白后，或换行。 */
export function segments(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])\s*|(?<=\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/g;

/** 念出来大约多少秒（设计稿 model-tts.js `estimateDuration`）：汉字 4.2 字 / 秒，英文 2.6 词 / 秒，每个停顿 0.18 秒。 */
export function estimateDuration(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const cjk = (t.match(CJK) ?? []).length;
  const latinWords = (t.replace(CJK, ' ').match(/[A-Za-z0-9']+/g) ?? []).length;
  const pauses = (t.match(/[，,。.!！?？;；]/g) ?? []).length;
  return Number((cjk / 4.2 + latinWords / 2.6 + pauses * 0.18).toFixed(1));
}

/** 字数行（设计稿 model-tools.js `textStats`）：「128 / 4096 字 · 3 段 · 约 12.4 秒」。 */
export function textStats(text: string, max: number): string {
  const t = text.trim();
  if (!t) return M.statsEmpty(max);
  return M.stats(codePoints(t), max, segments(t).length, oneDecimal(estimateDuration(t)));
}

/** 示例句：按选的语言，自动时按模型会不会念中文。 */
export function sampleText(draft: Pick<TtsDraft, 'language'>, info: Pick<SpeechModelInfo, 'languages'> | null): string {
  const lang = draft.language ? primaryLanguage(draft.language) : info && !speaks(info.languages, 'zh') ? 'en' : 'zh';
  return lang === 'zh' ? TTS_SAMPLES.zh : TTS_SAMPLES.en;
}

// ---- 念法 ----

/** 点一张念法卡：同一张再点一次清空；文字框空着就顺手填一段示例（设计稿 `pickVibe`）。 */
export function pickVibe(draft: TtsDraft, key: string, info: SpeechModelInfo | null): Partial<TtsDraft> {
  const vibe = VIBES.find((v) => v.key === key);
  if (!vibe) return {};
  if (draft.instructions === vibe.style) return { instructions: '' };
  return draft.text.trim() ? { instructions: vibe.style } : { instructions: vibe.style, text: sampleText(draft, info) };
}

/** 「换一句」：随机挑一张与当前不同的念法卡（`rnd` 便于单测注入）。 */
export function rollVibe(draft: TtsDraft, info: SpeechModelInfo | null, rnd: () => number = Math.random): Partial<TtsDraft> {
  const others = VIBES.filter((v) => v.style !== draft.instructions);
  const vibe = others[Math.floor(rnd() * others.length)] ?? VIBES[0];
  return pickVibe({ ...draft, instructions: '' }, vibe.key, info);
}

// ---- 音色 ----

export interface VoiceOption {
  key: VoiceKey;
  label: string;
}

export function customVoiceAllowed(info: Pick<SpeechModelInfo, 'voiceModes'>): boolean {
  return info.voiceModes.includes('custom');
}

function presetLabel(info: SpeechModelInfo, voiceId: string): string {
  return info.voices.find((v) => v.voiceId === voiceId)?.label ?? voiceId;
}

/** 音色下拉：默认（模型有默认音色时）、预置音色、手填音色 ID（模型收 `custom` 时）。 */
export function voiceOptions(info: SpeechModelInfo): VoiceOption[] {
  const list: VoiceOption[] = [];
  if (info.defaultVoice) list.push({ key: 'default', label: M.defaultVoiceOption(presetLabel(info, info.defaultVoice)) });
  for (const v of info.voices) list.push({ key: `preset:${v.voiceId}`, label: v.label });
  if (customVoiceAllowed(info)) list.push({ key: 'custom', label: M.customVoiceOption });
  return list;
}

const LIBRARY_PREFIX = 'library:';

export function libraryVoiceKey(id: string): VoiceKey {
  return `${LIBRARY_PREFIX}${id}`;
}

/** `library:<id>` 的条目 ID；别的选法为 null。 */
export function libraryIdOf(key: string): string | null {
  return key.startsWith(LIBRARY_PREFIX) ? key.slice(LIBRARY_PREFIX.length) : null;
}

/**
 * 我的声音里的一只在这只模型上用不用得了：用得了为 null，否则一句原因。Runtime 只用这家的有效克隆、
 * 并且要有本人声明，否则以 `VOICE_CLONE_REQUIRED` / `VOICE_CONSENT_REQUIRED` 拒绝；克隆在 模型 › 语音合成 › 我的声音 里建。
 */
export function libraryVoiceBlock(
  voice: Pick<LibraryEntrySummary, 'consentDeclared' | 'clones'>,
  option: Pick<SpeechOption, 'providerId' | 'provider' | 'modelId' | 'info'>,
): string | null {
  if (!customVoiceAllowed(option.info)) return M.presetOnly(option.modelId);
  const clone = voice.clones?.find((c) => c.providerId === option.providerId);
  if (!clone && !VOICE_CLONE_PROVIDERS.includes(option.providerId)) return M.cannotClone(option.provider);
  if (!voice.consentDeclared) return M.noConsent;
  if (clone?.state === 'valid') return null;
  if (clone?.state === 'stale') return M.cloneStale(option.provider);
  return M.notCloned(option.provider);
}

/**
 * 草稿里的音色在这只模型下还成不成立；不成立时退回默认（没有默认时退回第一项）。我的声音里的一只原样留着：
 * 删了、在这家用不了时由 `ttsProblems` 说清，不悄悄换成别的声音。
 */
export function voiceKeyFor(draft: Pick<TtsDraft, 'voice'>, info: SpeechModelInfo): VoiceKey {
  if (libraryIdOf(draft.voice) !== null) return draft.voice;
  const options = voiceOptions(info);
  if (options.some((o) => o.key === draft.voice)) return draft.voice;
  return options[0]?.key ?? 'default';
}

/** 实际交给 Runtime 的音色 ID；默认时 undefined（Runtime 用模型的 `defaultVoice`）；我的声音原样给 `library:<id>`。 */
export function voiceToSend(draft: Pick<TtsDraft, 'voice' | 'customVoice'>, info: SpeechModelInfo): string | undefined {
  const key = voiceKeyFor(draft, info);
  if (key === 'custom') return draft.customVoice.trim() || undefined;
  if (libraryIdOf(key) !== null) return key;
  if (key.startsWith('preset:')) return key.slice('preset:'.length);
  return undefined;
}

/** 音色的短名：状态句与记录卡用。我的声音写名字（还没读到时写「我的声音」，删了写「已删除的音色」）。 */
export function voiceLabel(draft: Pick<TtsDraft, 'voice' | 'customVoice'>, info: SpeechModelInfo, voices: MyVoices = null): string {
  const key = voiceKeyFor(draft, info);
  if (key === 'custom') return draft.customVoice.trim() || M.customVoice;
  const id = libraryIdOf(key);
  if (id !== null) return voices ? (voices.find((v) => v.id === id)?.name ?? M.deletedVoice) : M.myVoices;
  if (key.startsWith('preset:')) return presetLabel(info, key.slice('preset:'.length));
  return info.defaultVoice ? presetLabel(info, info.defaultVoice) : M.defaultVoice;
}

// ---- 语速、格式、种子 ----

/** 滑杆上的语速：没拨过时 1（落在区间里）。 */
export function speedValue(draft: Pick<TtsDraft, 'speed'>, range: { min: number; max: number }): number {
  const v = draft.speed ?? 1;
  return Math.min(range.max, Math.max(range.min, v));
}

export function formatFor(draft: Pick<TtsDraft, 'format'>, info: Pick<SpeechModelInfo, 'formats' | 'defaultFormat'>): SpeechFormat {
  return draft.format && info.formats.includes(draft.format) ? draft.format : info.defaultFormat;
}

/**
 * 换一只模型：音色、语速、格式回到这只的默认；语言它不会念时回到自动；文字与风格留着。
 * 选的是我的声音时留着（它跟着人走，不跟模型走）：这只模型用不了时由选择器与 `ttsProblems` 说清。
 */
export function switchModel(draft: TtsDraft, option: SpeechOption): Partial<TtsDraft> {
  const language = draft.language && !speaks(option.info.languages, draft.language) ? '' : draft.language;
  const voice = libraryIdOf(draft.voice) !== null ? draft.voice : 'default';
  return { model: option.key, voice, customVoice: '', speed: null, format: null, language };
}

// ---- 校验与请求 ----

/** 语言的问题：选了的或（自动时）按文字判断出来的语言，模型的清单里没有。 */
function languageProblem(draft: TtsDraft, option: SpeechOption): string | null {
  const tag = draft.language || detectLang(draft.text);
  if (!tag || speaks(option.info.languages, tag)) return null;
  return M.cannotSpeak(option.modelId, langName(primaryLanguage(tag)));
}

/** 我的声音那一只的问题：删了、在这只模型上用不了。还没读到我的声音时只看模型收不收（其余交给 Runtime 核对）。 */
function libraryProblem(id: string, option: SpeechOption, voices: MyVoices): string | null {
  if (!voices) return customVoiceAllowed(option.info) ? null : M.presetOnly(option.modelId);
  const voice = voices.find((v) => v.id === id);
  return voice ? libraryVoiceBlock(voice, option) : M.voiceDeleted;
}

/** 生成前的问题（空即可提交）。按钮不置灰，按下再说清缺什么（设计稿 model-tools.js `validate`）。 */
export function ttsProblems(draft: TtsDraft, option: SpeechOption | null, voices: MyVoices = null, material: TtsMaterial | null = null): string[] {
  const problems: string[] = [];
  const text = material ? '' : draft.text.trim();
  if (!text && !material) problems.push(M.emptyText);
  if (!option) return problems;
  const info = option.info;
  if (codePoints(text) > info.maxInputChars) problems.push(M.tooLong(option.modelId, info.maxInputChars));
  const key = voiceKeyFor(draft, info);
  if (key === 'custom' && !draft.customVoice.trim()) problems.push(M.enterVoiceId);
  const libraryId = libraryIdOf(key);
  const mine = libraryId !== null ? libraryProblem(libraryId, option, voices) : null;
  if (mine) problems.push(mine);
  if (key === 'default' && !info.defaultVoice) problems.push(voiceOptions(info).length ? M.pickVoice : M.noVoices);
  if (text) {
    const lang = languageProblem(draft, option);
    if (lang) problems.push(lang);
  }
  if (info.acceptsSeed && !parseSeed(draft.seed).ok) problems.push(M.seedInteger);
  return problems;
}

/**
 * 念 Space 里的文档或字幕（`material`，架构设计 §7.9「Space 条目作输入」）：Runtime 读出条目的文字当 `text`（字幕去掉时间码），
 * 超过模型的字数上限时在提交时拒绝、不截断。`name` 只给界面看。
 */
export interface TtsMaterial {
  entryId: string;
  name: string;
}

/** `models.synthesizeSpeech` 的参数：只带这只模型收的字段，不导入任何视频。给了素材时 `text` 是空串、带 `material`。 */
export function speechRequest(draft: TtsDraft, option: SpeechOption, material: TtsMaterial | null = null): Omit<SynthesizeSpeechRequest, 'commandId'> {
  const info = option.info;
  const voice = voiceToSend(draft, info);
  const instructions = draft.instructions.trim();
  const seed = parseSeed(draft.seed);
  return {
    text: material ? '' : draft.text.trim(),
    ...(material ? { material: { entryId: material.entryId } } : {}),
    provider: option.providerId,
    model: option.modelId,
    ...(voice ? { voice } : {}),
    ...(draft.language ? { language: draft.language } : {}),
    format: formatFor(draft, info),
    ...(info.acceptsInstructions && instructions ? { instructions } : {}),
    ...(info.speedRange && draft.speed !== null ? { speed: speedValue(draft, info.speedRange) } : {}),
    ...(info.acceptsSeed && seed.ok && seed.seed !== null ? { seed: seed.seed } : {}),
  };
}

export interface BarStatus {
  text: string;
  /** 门没过或有问题：变橙。 */
  bad: boolean;
}

/**
 * 主按钮旁那句（设计稿 tool-tts.jsx `status`）：先说门（没模型、没连上），再说第一个问题（没写文字这一条要按过一次才说），
 * 都没有就念一遍这次会用的模型、音色、时长与字数。
 */
export function ttsStatus(draft: TtsDraft, option: SpeechOption | null, tried: boolean, voices: MyVoices = null, material: TtsMaterial | null = null): BarStatus {
  if (!option) return { text: M.noModel, bad: true };
  if (!option.usable) return { text: option.connected ? `${option.provider} · ${option.why}` : M.connectFirst(option.provider), bad: true };
  const empty = M.emptyText;
  const problem = ttsProblems(draft, option, voices, material).find((p) => tried || p !== empty);
  if (problem) return { text: problem, bad: true };
  if (material) return { text: M.readsMaterial(option.modelId, voiceLabel(draft, option.info, voices), material.name), bad: false };
  const text = draft.text.trim();
  const tail = text ? M.estimate(oneDecimal(estimateDuration(text)), codePoints(text)) : '';
  return { text: `${option.modelId} · ${voiceLabel(draft, option.info, voices)}${tail}`, bad: false };
}

// ---- 记录 ----

/** 两位的分:秒（设计稿 `recordMeta` 的「00:07」）。 */
function mmss(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function khz(rate: number): string {
  return `${Number((rate / 1000).toFixed(2))} kHz`;
}

/** 第一段音频输出。 */
export function audioOutput(job: Pick<JobRecord, 'result'>): GeneratedOutput | null {
  return job.result?.outputs?.find((o) => o.media.kind === 'audio') ?? null;
}

/**
 * 记录卡的元数据行（设计稿 model-tools.js `recordMeta`）：「00:07 · 24 kHz · OpenAI · gpt-4o-mini-tts · alloy · 中文 · 24 字」。
 * 时长与采样率是成品的事实，还没生成好时不写。
 */
export function speechMeta(job: JobRecord, provider: string): string {
  const g = job.generation?.capability === 'synthesizeSpeech' ? job.generation : null;
  const out = audioOutput(job);
  const media = out?.media.kind === 'audio' ? out.media : null;
  return [
    media ? mmss(media.durationSec) : null,
    media ? khz(media.sampleRate) : null,
    `${provider} · ${job.modelId}`,
    g?.voice ?? null,
    g?.language ? langName(primaryLanguage(g.language)) : null,
    g ? M.chars(codePoints(g.text)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 念的那段文字。 */
export function speechText(job: Pick<JobRecord, 'generation'>): string {
  return job.generation?.capability === 'synthesizeSpeech' ? job.generation.text : '';
}

/** 记录卡的标题：文字的开头。 */
export function speechTitle(job: Pick<JobRecord, 'generation'>): string {
  return clip(speechText(job), 18) || M.speech;
}

const AUDIO_EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac' };

/** 下载的文件名：文字的开头（去掉文件名里不能用的字符）+ 格式的扩展名。 */
export function audioFileName(job: Pick<JobRecord, 'generation'>, output: Pick<GeneratedOutput, 'mediaType'>): string {
  const g = job.generation?.capability === 'synthesizeSpeech' ? job.generation : null;
  const ext = AUDIO_EXT[output.mediaType] ?? g?.format ?? 'mp3';
  const stem = Array.from(speechText(job).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, 24)
    .join('')
    .trim();
  return `${stem || M.speech}.${ext}`;
}

/** 用的是我的声音时那只的条目 ID（任务冻结的用户库条目）；冻结的 `voice` 是它在供应商那边的克隆 ID。 */
function libraryVoiceOf(job: Pick<JobRecord, 'library'>): string | null {
  return job.library?.entries.find((e) => e.library === 'voices')?.id ?? null;
}

/** 「带回左边再改一版」：文字与设置回到表单；音色认回我的声音，或按这只模型的清单认回预置或手填。 */
export function draftFromJob(job: JobRecord, info: SpeechModelInfo | null): Partial<TtsDraft> | null {
  const g = job.generation?.capability === 'synthesizeSpeech' ? job.generation : null;
  if (!g) return null;
  const mine = libraryVoiceOf(job);
  const preset = info?.voices.some((v) => v.voiceId === g.voice);
  const isDefault = info?.defaultVoice === g.voice;
  return {
    text: g.text,
    model: modelKeyOf(job.providerId, job.modelId),
    voice: mine !== null ? libraryVoiceKey(mine) : isDefault ? 'default' : preset ? `preset:${g.voice}` : 'custom',
    customVoice: mine !== null || isDefault || preset ? '' : g.voice,
    instructions: g.instructions ?? '',
    speed: g.speed,
    seed: g.seed !== null ? String(g.seed) : '',
    format: g.format,
    language: g.language ?? '',
  };
}

/**
 * 「再试一次 / 重新排队」：照冻结的参数原样再提交一次（同一个 Provider、模型与音色）。用的是我的声音时仍给 `library:<id>`，
 * 由 Runtime 重新核对克隆（过期了照实拒绝），不拿旧的克隆 ID 绕过去。
 */
export function speechRetry(job: JobRecord): Omit<SynthesizeSpeechRequest, 'commandId'> | null {
  const g = job.generation?.capability === 'synthesizeSpeech' ? job.generation : null;
  if (!g) return null;
  const mine = libraryVoiceOf(job);
  return {
    text: g.text,
    provider: job.providerId,
    model: job.modelId,
    voice: mine !== null ? libraryVoiceKey(mine) : g.voice,
    ...(g.language ? { language: g.language } : {}),
    format: g.format,
    ...(g.instructions ? { instructions: g.instructions } : {}),
    ...(g.speed !== null ? { speed: g.speed } : {}),
    ...(g.seed !== null ? { seed: g.seed } : {}),
  };
}

/**
 * 模型那一行右边的一句（设计稿 tool-tts.jsx `ModelLine` 的 `c.line`）：这只模型能做什么，全从能力描述里来——
 * 音色几个、收不收风格说明、语速区间、会念哪些语言、一次最多几字。
 */
export function speechModelLine(info: SpeechModelInfo): string {
  return [
    info.notes ?? null,
    info.voices.length ? M.presetVoices(info.voices.length) : customVoiceAllowed(info) ? M.customVoiceId : null,
    info.acceptsInstructions ? M.takesStyle : null,
    info.speedRange ? M.speedRange(info.speedRange.min, info.speedRange.max) : null,
    languagesShort(info.languages),
    M.maxChars(info.maxInputChars),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 页头那枚标签（设计稿 model-cloud-tts.js `headerChip`）：走谁的服务。计费口径各家不同，只说「按用量计费」。 */
export function headerChip(option: Pick<SpeechOption, 'provider'> | null): string | null {
  return option ? M.headerChip(option.provider) : null;
}
