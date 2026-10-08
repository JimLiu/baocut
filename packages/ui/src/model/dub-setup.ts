import {
  defineMessages,
  GRANT_DATA_KIND_LABELS,
  GRANT_DATA_KINDS,
  RpcError,
  type DocumentRecord,
  type DubOriginalAudio,
  type DubParams,
  type DubVoiceSource,
  type GrantCreateParams,
  type GrantDataKind,
  type Id,
  type LibraryEntrySummary,
  type SpeakerVoiceBinding,
  type SpeechModelInfo,
} from '@baocut/protocol';
import { languageName } from './caption-tracks.ts';
import { recipientName } from './data-grants.ts';
import { langName } from './tools-models.ts';
import { sameLanguage, TARGET_LANGUAGES } from './translate-setup.ts';
import { speechSentences } from './translation-doc.ts';
import { zhHans } from './dub-setup.zh-Hans.ts';
import { zhHant } from './dub-setup.zh-Hant.ts';
import { ja } from './dub-setup.ja.ts';
import { ko } from './dub-setup.ko.ts';
import { es } from './dub-setup.es.ts';
import { fr } from './dub-setup.fr.ts';
import { de } from './dub-setup.de.ts';
import { nl } from './dub-setup.nl.ts';
import { ptBR } from './dub-setup.pt-BR.ts';
import { it } from './dub-setup.it.ts';
import { ru } from './dub-setup.ru.ts';
import { pl } from './dub-setup.pl.ts';
import { tr } from './dub-setup.tr.ts';
import { vi } from './dub-setup.vi.ts';
import { remedyHintText } from './localized-text.ts';

/** 配音设置模型的文案（英文是键与类型的来源，译文在 `dub-setup.zh-Hans.ts`）。 */
const en = {
  useExisting: (name: string) => `Use existing translation · ${name}`,
  translateFirst: (language: string) => `${language} · Translate first`,
  sameAsSource: 'Same language as the original',
  missingLibraryVoice: (id: string) => `Library voice (${id}, no longer in the library)`,
  voiceRemoved: 'This voice is no longer in the library',
  noConsent: 'No consent statement from the speaker, so it won’t be uploaded to the provider',
  notCloned: (provider: string) => `Not cloned with ${provider} yet`,
  cloneExpired: (provider: string) => `The clone with ${provider} has expired; clone it again`,
  modelDefaultNamed: (voice: string) => `Model default · ${voice}`,
  modelDefault: 'Model default',
  noDefaultVoice: 'This model has no default voice',
  needsVoice: 'This model needs a voice to be specified',
  presetVoice: 'Preset voice',
  myVoiceProblem: (problem: string) => `My voices · ${problem}`,
  myVoice: 'My voices',
  customVoice: 'Enter voice ID…',
  customVoiceDesc: 'A voice in your provider account',
  purpose: (language: string, videoName: string | null) =>
    `Voice-over: dub ${videoName ? `“${videoName}”` : 'this video'} into ${language}`,
  kindList: (kinds: readonly string[]) => kinds.join(', '),
  transcriptNote: ' (the translation to synthesize; when translating first, also the original text)',
  factWhat: 'Data sent',
  factTo: 'Sent to',
  factScope: 'Scope',
  factPurpose: 'Purpose',
  factBudget: 'Budget',
  factRevoke: 'Revoking',
  scopeVideoNamed: (name: string) => `Only the video “${name}”`,
  scopeThisVideo: 'Only this video',
  budget: 'Counted per call, cost unknown, unlimited calls; the provider charges for usage as usual',
  revoke: 'Revoke any time in Settings › Privacy › Data sharing grants; data already sent can’t be taken back',
};
export type DubSetupMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 翻译配音设置页（设计稿 panel-dub-setup.jsx `DubSetup`）的纯逻辑：配成哪种语言（已有译文或先翻译）、每位说话人生效的音色、
 * 交给 `pipelines.start`（`dub`）的参数，以及第一次配音被 `GRANT_REQUIRED` 拒绝时要发的那条授权。
 * 设计稿里的引擎自动挑选、本机模型下载、注音、时长对比与样片都是本机引擎的模拟，Runtime 的 `dub` 合同里没有，这里不做。
 */

export const DUB_PIPELINE = 'dub';
export const DEFAULT_DUCK_DB = 18;
export const DUCK_DB_MIN = 1;
export const DUCK_DB_MAX = 60;
/** 风格提示的上限（与翻译同）。 */
export const DUB_STYLE_MAX = 500;
/** 授权用途的上限（`grants.create` 的 `purpose`）。 */
export const GRANT_PURPOSE_MAX = 200;

/** 压低多少 dB：1–60 的整数（Runtime 按整数收）；不是数时用默认的 12。 */
export function clampDuckDb(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DUCK_DB;
  return Math.min(DUCK_DB_MAX, Math.max(DUCK_DB_MIN, Math.round(value)));
}

// ---- 配成哪种语言 ----

export interface DubLanguageOption {
  /** `doc:<译文 ID>` 用已有译文；`lang:<标签>` 先翻译成这门语言。 */
  key: string;
  /** 这门语言自己的叫法。 */
  label: string;
  description: string;
  language: string;
  translationId: Id | null;
  /** 不能选的原因（和原文同一种语言）；能选时 null。 */
  disabled: string | null;
}

/**
 * 语言下拉：先列这份转写已有的译文（用它，语言跟着它走），再列常用语言（先翻译）。已有译文的语言不再列「先翻译」：
 * 一门语言一份译文，要重翻在字幕面板里做。
 */
export function dubLanguageOptions(sourceLanguage: string | null, translations: readonly DocumentRecord[]): DubLanguageOption[] {
  const docs: DubLanguageOption[] = translations
    .filter((d) => !!d.language)
    .map((d) => ({
      key: `doc:${d.id}`,
      label: languageName(d.language!),
      description: M.useExisting(d.name),
      language: d.language!,
      translationId: d.id,
      disabled: null,
    }));
  const fresh: DubLanguageOption[] = TARGET_LANGUAGES.filter((tag) => !docs.some((d) => sameLanguage(d.language, tag))).map((tag) => ({
    key: `lang:${tag}`,
    label: languageName(tag),
    description: M.translateFirst(langName(tag)),
    language: tag,
    translationId: null,
    disabled: sourceLanguage !== null && sameLanguage(sourceLanguage, tag) ? M.sameAsSource : null,
  }));
  return [...docs, ...fresh];
}

/** 默认选哪一项：有已有译文时第一份；否则原文是中文时英语、别的简体中文；都不能选时第一项能选的。 */
export function defaultDubLanguage(options: readonly DubLanguageOption[], sourceLanguage: string | null): string | null {
  const doc = options.find((o) => o.translationId !== null && !o.disabled);
  if (doc) return doc.key;
  const preferred = sourceLanguage && sourceLanguage.toLowerCase().startsWith('zh') ? 'lang:en' : 'lang:zh-Hans';
  return (options.find((o) => o.key === preferred && !o.disabled) ?? options.find((o) => !o.disabled))?.key ?? null;
}

// ---- 参数 ----

export interface DubSetup {
  videoId: Id;
  /** 原文（`speech`）。用已有译文时 Runtime 取译文的来源，这里不传。 */
  speechDocumentId: Id;
  /** 已有的译文；null 时先翻译成 `targetLanguage`。 */
  translationId: Id | null;
  targetLanguage: string;
  /** 语音合成的 Provider 与模型；null 时用语音合成的默认值。 */
  voiceModel: { providerId: string; modelId: string } | null;
  /** 没有绑定音色的说话人用的音色；null 时用模型的默认音色。 */
  voice: string | null;
  /** 先翻译时用的文本模型；null 时用文本生成的默认值。 */
  textModel: { providerId: string; modelId: string } | null;
  style: string;
  originalAudio: DubOriginalAudio;
  duckDb: number;
  /** 先分离人声与背景（`separateBackground`）：背景声单独成轨，原声只剩人声（静音或压低）；`keep` 时 Runtime 不分离。 */
  separateBackground: boolean;
}

/**
 * `pipelines.start` 的 `params`：只放流程认得的键。给了 `translationId` 时不翻译，`targetLanguage`、`style` 与文本模型都不传
 * （Runtime 拒绝这种组合，语言跟着译文走）。术语表不在这里传：先翻译时用视频里启用的（与翻译同）。
 * 分离只在打开时传 `separateBackground: true`（与 CLI 的 `--separate-background` 相同），没有分离模型时 Runtime 跳过这一步并告警。
 */
export function dubParams(setup: DubSetup): DubParams {
  const voice = setup.voice?.trim();
  const base: DubParams = {
    videoId: setup.videoId,
    ...(setup.voiceModel ? { provider: setup.voiceModel.providerId, model: setup.voiceModel.modelId } : {}),
    ...(voice ? { voice } : {}),
    originalAudio: setup.originalAudio,
    ...(setup.originalAudio === 'duck' ? { duckDb: clampDuckDb(setup.duckDb) } : {}),
    ...(setup.separateBackground ? { separateBackground: true } : {}),
  };
  if (setup.translationId) return { ...base, translationId: setup.translationId };
  const style = setup.style.trim().slice(0, DUB_STYLE_MAX);
  return {
    ...base,
    documentId: setup.speechDocumentId,
    targetLanguage: setup.targetLanguage,
    ...(style ? { style } : {}),
    ...(setup.textModel ? { textProvider: setup.textModel.providerId, textModel: setup.textModel.modelId } : {}),
  };
}

// ---- 说话人与音色 ----

export interface SpeechSpeaker {
  speakerId: string;
  name: string;
  /** 这位说话人的句数（句子的说话人取它第一个没隐藏的词的，与 Runtime 一致）。 */
  sentences: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 转写里的说话人与各自的句数；没有说话人信息时为空（所有句子都用参数音色或模型默认）。 */
export function speechSpeakers(body: unknown): SpeechSpeaker[] {
  const sentences = speechSentences(body);
  if (!sentences || !isObject(body)) return [];
  const names = new Map<string, string>();
  for (const raw of Array.isArray(body.speakers) ? body.speakers : []) {
    if (!isObject(raw) || typeof raw.id !== 'string') continue;
    names.set(raw.id, (typeof raw.name === 'string' && raw.name.trim()) || raw.id);
  }
  const words = new Map<string, { speaker?: string; hidden?: boolean }>();
  for (const raw of Array.isArray(body.words) ? body.words : []) {
    if (isObject(raw) && typeof raw.id === 'string') {
      words.set(raw.id, {
        ...(typeof raw.speaker === 'string' ? { speaker: raw.speaker } : {}),
        ...(raw.hidden === true ? { hidden: true } : {}),
      });
    }
  }
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const first = sentence.wordIds.map((id) => words.get(id)).find((w) => w && !w.hidden);
    if (first?.speaker) counts.set(first.speaker, (counts.get(first.speaker) ?? 0) + 1);
  }
  // 先按转写里说话人的次序，再是没登记名字的。
  const order = [...names.keys(), ...[...counts.keys()].filter((id) => !names.has(id))];
  return order.filter((id) => counts.has(id)).map((id) => ({ speakerId: id, name: names.get(id) ?? id, sentences: counts.get(id)! }));
}

const LIBRARY_PREFIX = 'library:';

/** `library:<id>` 的条目 ID；不是库里的音色时 null。 */
export function libraryVoiceId(voice: string): string | null {
  return voice.startsWith(LIBRARY_PREFIX) && voice.length > LIBRARY_PREFIX.length ? voice.slice(LIBRARY_PREFIX.length) : null;
}

/** 音色的短名：库里的取条目名，预置的取模型给的名字，别的照写 ID。 */
export function voiceName(voice: string, info: Pick<SpeechModelInfo, 'voices'> | null, library: readonly LibraryEntrySummary[]): string {
  const id = libraryVoiceId(voice);
  if (id !== null) return library.find((e) => e.id === id)?.name ?? M.missingLibraryVoice(id);
  return info?.voices.find((v) => v.voiceId === voice)?.label ?? voice;
}

/**
 * 库里的音色在这家服务商上用不用得上：没有本人声明不上传（`VOICE_CONSENT_REQUIRED`），没有有效克隆不能合成
 * （`VOICE_CLONE_REQUIRED`）。用得上时 null。
 */
export function libraryVoiceProblem(entry: LibraryEntrySummary | undefined, providerId: string | null, providerLabel: string): string | null {
  if (!entry) return M.voiceRemoved;
  if (!entry.consentDeclared) return M.noConsent;
  if (!providerId) return null;
  const clone = entry.clones?.find((c) => c.providerId === providerId);
  if (!clone) return M.notCloned(providerLabel);
  if (clone.state !== 'valid') return M.cloneExpired(providerLabel);
  return null;
}

export interface VoiceChoice {
  /** `default`、`preset:<id>`、`library:<id>`、`custom`。 */
  key: string;
  label: string;
  description: string | null;
  /** 交给 Runtime（参数 `voice`）或写进绑定的值；`default` 与 `custom` 为 null。 */
  voice: string | null;
  /** 预置音色只在这家服务商上有意义：写绑定时带上；库里的音色不带（Runtime 按配音选的服务商换成克隆）。 */
  providerId?: string;
  /** 不能选的原因；能选时 null。 */
  disabled: string | null;
}

/**
 * 音色下拉：模型默认（`defaultLabel`，绑定里写「不绑定」）、模型的预置音色、库里的音色（写清在这家服务商上能不能用）、
 * 手填音色 ID（`custom` 为 true 且模型收手填时）。参数音色用库里的音色时要有有效克隆，否则启动就被拒，所以那时不能选；
 * 绑定可以先绑上、之后再克隆（这次用不上的说话人逐句报告）。
 */
export function voiceChoices(options: {
  info: SpeechModelInfo | null;
  providerId: string | null;
  providerLabel: string;
  library: readonly LibraryEntrySummary[];
  defaultLabel: string;
  /** 参数音色的下拉（库里的音色要能用才能选；可以手填）。 */
  forParams: boolean;
}): VoiceChoice[] {
  const { info, providerId, providerLabel, library, defaultLabel, forParams } = options;
  const list: VoiceChoice[] = [];
  const preset = info?.defaultVoice ? (info.voices.find((v) => v.voiceId === info.defaultVoice)?.label ?? info.defaultVoice) : null;
  list.push({
    key: 'default',
    label: defaultLabel,
    description: forParams ? (preset ? M.modelDefaultNamed(preset) : M.noDefaultVoice) : null,
    voice: null,
    disabled: forParams && info && !info.defaultVoice ? M.needsVoice : null,
  });
  for (const v of info?.voices ?? []) {
    list.push({
      key: `preset:${v.voiceId}`,
      label: v.label,
      description: M.presetVoice,
      voice: v.voiceId,
      ...(providerId ? { providerId } : {}),
      disabled: null,
    });
  }
  for (const entry of library) {
    const problem = libraryVoiceProblem(entry, providerId, providerLabel);
    list.push({
      key: `library:${entry.id}`,
      label: entry.name,
      description: problem ? M.myVoiceProblem(problem) : M.myVoice,
      voice: `${LIBRARY_PREFIX}${entry.id}`,
      disabled: forParams && problem ? problem : null,
    });
  }
  if (forParams && info?.voiceModes.includes('custom')) {
    list.push({ key: 'custom', label: M.customVoice, description: M.customVoiceDesc, voice: null, disabled: null });
  }
  return list;
}

/** 一个音色值在下拉里对应哪一项；不在里面（别处绑的、换了模型）时 null。 */
export function choiceKeyOf(voice: string, choices: readonly VoiceChoice[]): string | null {
  return choices.find((c) => c.voice === voice)?.key ?? null;
}

export interface SpeakerRow {
  speakerId: string;
  name: string;
  sentences: number;
  /** 视频里给这位说话人（这份转写）绑定的音色；没有时 null。 */
  binding: SpeakerVoiceBinding | null;
  /** 绑定的是别家服务商的预置音色：这次不用，退到参数音色或模型默认。 */
  bindingIgnored: boolean;
  /** 生效的音色（绑定 → 参数 `voice` → 模型默认）：给人看的名字与来源。 */
  effective: { label: string; source: DubVoiceSource };
  /** 生效的是库里的音色、却在这家服务商上用不上：这位说话人的句子不会合成。 */
  warning: string | null;
}

/**
 * 设置页「声音」一节每位说话人一行：生效的音色按 Runtime 的优先级（视频里的绑定 → 参数 `voice` → 模型默认）。
 * 指定了别家服务商的绑定 Runtime 不用（`providerId` 不符），这里同样退下去并写明。
 */
export function speakerRows(options: {
  speakers: readonly SpeechSpeaker[];
  bindings: readonly SpeakerVoiceBinding[];
  documentId: Id;
  providerId: string | null;
  providerLabel: string;
  voice: string | null;
  info: SpeechModelInfo | null;
  library: readonly LibraryEntrySummary[];
}): SpeakerRow[] {
  const { speakers, bindings, documentId, providerId, providerLabel, voice, info, library } = options;
  const fallback = (): SpeakerRow['effective'] => {
    if (voice) return { label: voiceName(voice, info, library), source: 'params' };
    const preset = info?.defaultVoice ? voiceName(info.defaultVoice, info, library) : null;
    return { label: preset ? M.modelDefaultNamed(preset) : M.modelDefault, source: 'default' };
  };
  return speakers.map((s) => {
    const binding = bindings.find((b) => b.documentId === documentId && b.speakerId === s.speakerId) ?? null;
    const ignored = !!binding && binding.providerId !== undefined && providerId !== null && binding.providerId !== providerId;
    const used = binding && !ignored ? binding : null;
    const effectiveVoice = used ? used.voice : voice;
    const libraryId = effectiveVoice ? libraryVoiceId(effectiveVoice) : null;
    const warning =
      libraryId !== null
        ? libraryVoiceProblem(
            library.find((e) => e.id === libraryId),
            providerId,
            providerLabel,
          )
        : null;
    return {
      speakerId: s.speakerId,
      name: s.name,
      sentences: s.sentences,
      binding,
      bindingIgnored: ignored,
      effective: used ? { label: voiceName(used.voice, info, library), source: 'video' } : fallback(),
      warning,
    };
  });
}

/**
 * 改一位说话人的绑定：换掉（原位）或去掉这份转写里这位说话人的那条，别的照旧；新的排到最后。`library:` 音色不带
 * `providerId`（Runtime 拒绝），预置音色带上它所在的服务商。
 */
export function withBinding(
  bindings: readonly SpeakerVoiceBinding[],
  documentId: Id,
  speakerId: string,
  choice: { voice: string; providerId?: string } | null,
): SpeakerVoiceBinding[] {
  const next: SpeakerVoiceBinding | null = choice
    ? {
        documentId,
        speakerId,
        voice: choice.voice,
        ...(choice.providerId !== undefined && libraryVoiceId(choice.voice) === null ? { providerId: choice.providerId } : {}),
      }
    : null;
  const index = bindings.findIndex((b) => b.documentId === documentId && b.speakerId === speakerId);
  if (index < 0) return next ? [...bindings, next] : [...bindings];
  const out = [...bindings];
  if (next) out[index] = next;
  else out.splice(index, 1);
  return out;
}

// ---- 授权 ----

/** 第一次配音被拒在授权上：要把哪些数据交给谁、给哪个视频，Runtime 给的补救说明与命令。 */
export interface GrantRefusal {
  code: 'GRANT_REQUIRED' | 'GRANT_REVOKED';
  message: string;
  recipient: string;
  dataKinds: GrantDataKind[];
  videoId: Id | null;
  hint: string;
  commands: string[];
}

const GRANT_CODES = new Set(['GRANT_REQUIRED', 'GRANT_REVOKED']);

/**
 * 读 `pipelines.start` / `pipelines.retry` 的拒绝：`GRANT_REQUIRED` 或 `GRANT_REVOKED`、补救是「发放授权」时给出要发的那条；
 * 别的拒绝（预算、没有配置……）为 null。接收方、数据种类与视频取 details 顶层的（不去解析命令）。
 */
export function grantRefusal(error: unknown): GrantRefusal | null {
  const details = error instanceof RpcError ? error.details : (error as { details?: unknown } | null)?.details;
  if (!isObject(details) || typeof details.code !== 'string' || !GRANT_CODES.has(details.code)) return null;
  const remedy = isObject(details.remedy) ? details.remedy : null;
  if (!remedy || remedy.action !== 'create-grant') return null;
  if (typeof details.recipient !== 'string' || !details.recipient) return null;
  const kinds = Array.isArray(details.dataKinds)
    ? details.dataKinds.filter((k): k is GrantDataKind => typeof k === 'string' && (GRANT_DATA_KINDS as readonly string[]).includes(k))
    : [];
  return {
    code: details.code as GrantRefusal['code'],
    message: error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? ''),
    recipient: details.recipient,
    dataKinds: kinds.length ? kinds : ['transcript'],
    videoId: typeof details.videoId === 'string' ? details.videoId : null,
    hint: remedyHintText(remedy) ?? '',
    commands: Array.isArray(remedy.commands) ? remedy.commands.filter((c): c is string => typeof c === 'string') : [],
  };
}

/** 同一位接收方、同一组数据种类：发过一次还被拒时不再循环。 */
export function refusalKey(refusal: Pick<GrantRefusal, 'recipient' | 'dataKinds'>): string {
  return `${refusal.recipient}|${[...refusal.dataKinds].sort().join(',')}`;
}

/** 授权的用途（给人看，`grants.create` 的 `purpose`，最多 200 字）。 */
export function grantPurpose(language: string, videoName: string | null): string {
  const what = M.purpose(langName(language), videoName);
  return what.slice(0, GRANT_PURPOSE_MAX);
}

/**
 * 用户确认之后发的那条授权：数据种类与接收方照拒绝里的（配音是 `transcript`），只限这个视频，用途照设置页写的，
 * 金额未知、按次计、次数不限（`per-call-unknown-cost`，不设金额上限；有上限要 `estimate-cap` 与 `budgetCap`）。
 */
export function grantRequest(refusal: Pick<GrantRefusal, 'recipient' | 'dataKinds' | 'videoId'>, videoId: Id, purpose: string): GrantCreateParams {
  return {
    dataKinds: [...refusal.dataKinds],
    recipient: refusal.recipient,
    scope: { videoId: refusal.videoId ?? videoId },
    purpose: purpose.trim().slice(0, GRANT_PURPOSE_MAX),
    budgetMode: 'per-call-unknown-cost',
  };
}

/** 确认框里的几行：外发什么、交给谁、限哪个视频、用途、预算、怎么撤销。 */
export function grantFacts(
  refusal: Pick<GrantRefusal, 'recipient' | 'dataKinds'>,
  labels: ReadonlyMap<string, string>,
  videoName: string | null,
  purpose: string,
): Array<[label: string, value: string]> {
  const kinds = M.kindList(refusal.dataKinds.map((k) => GRANT_DATA_KIND_LABELS[k]));
  const transcript = refusal.dataKinds.includes('transcript') ? M.transcriptNote : '';
  return [
    [M.factWhat, `${kinds}${transcript}`],
    [M.factTo, recipientName(refusal.recipient, labels)],
    [M.factScope, videoName ? M.scopeVideoNamed(videoName) : M.scopeThisVideo],
    [M.factPurpose, purpose],
    [M.factBudget, M.budget],
    [M.factRevoke, M.revoke],
  ];
}
