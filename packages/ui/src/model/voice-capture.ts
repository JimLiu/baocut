import {
  VOICE_CONSENT_CUSTOM,
  type ModelCapabilitiesView,
  type ProviderCapabilityView,
  type VoiceClone,
  type VoiceContent,
} from '@baocut/protocol';
import { canClone, localSpeechModels } from './models-tts-local.ts';
import { sampleKinds, sampleLangs, sampleLine } from './tts-quick-test.ts';

/**
 * 我的声音 › 克隆新音色的纯逻辑（架构设计 §5.9，设计稿 model-voices.js 与 settings-voice-capture.jsx）：
 * 先选这只音色给哪些模型用 → 录一段样本 →（选中的云端里有要授权声明录音的才有）念授权声明 → 保存（每只本机引擎一颗种子），
 * 保存后立即上传到选中的、连着且条件齐了的云端建克隆（`uploadPlan`）。
 * 这里只算，不画；也不放给人看的文字（文案在 components/models/voices-copy.ts）。
 */

/** 一种录音的时长门槛（秒）：`countdown` 是到上限前多少秒开始倒数。 */
export interface RecordingSpec {
  min: number;
  target: number;
  max: number;
  countdown: number;
}

/**
 * 样本：5 秒能存，10 秒以上云端才收，30 秒就够了；想多说可以接着说，到 3 分钟（上限）自动停，最后 10 秒倒数。
 * 上传的超过 3 分钟取前 3 分钟（48 kHz 单声道 16 位 WAV 约 16.5 MiB，在库的 20 MiB 上限内）。云端各家收多长看能力视图的
 * `voiceClone.sourceSeconds`，更长的由 Runtime 的适配器截短再上传。
 */
export const SAMPLE = { min: 5, good: 10, target: 30, max: 180, countdown: 10 } as const satisfies RecordingSpec & { good: number };
/** 授权声明录音：念完一整句，3 秒起，8 秒以后倒数，15 秒自动停（Runtime 对文件的上限是 3 MiB）。 */
export const CONSENT_REC = { min: 3, target: 8, max: 15, countdown: 7 } as const satisfies RecordingSpec;

export interface ConsentPhrase {
  /** 提供方收的 `language_code`（BCP 47）。 */
  code: string;
  /** 官方原文：录的时候照着念，一字不改。 */
  text: string;
  /** 实测能验过（目前只有英文）。 */
  verified?: boolean;
  /** 推荐值。 */
  recommended?: boolean;
  /** 官方支持，但实测常验不过。 */
  flaky?: boolean;
}

const EN = 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.';
const FR = "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique.";
const ES = 'Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética.';

/**
 * 授权声明的官方原文：提供方官方表里的 30 个地区语言，同一语言的几个地区原文相同。这是提供方要核对的固定文本，
 * 不是界面文字，不翻译；只有要授权声明录音的提供方（`voiceClone.requiresConsentClip`）用得到。
 */
// i18n-ignore-start 提供方要核对的授权声明原文，按语言原样保留
export const CONSENT_PHRASES: readonly ConsentPhrase[] = [
  { code: 'en-US', text: EN, verified: true, recommended: true },
  { code: 'zh-CN', text: '我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型', flaky: true },
  { code: 'en-GB', text: EN },
  { code: 'en-IN', text: EN },
  { code: 'en-AU', text: EN },
  { code: 'ja-JP', text: '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。' },
  { code: 'ko-KR', text: '나는 이 음성의 소유자이며 구글이 이 음성을 사용하여 음성 합성 모델을 생성할 것을 허용합니다.' },
  { code: 'fr-FR', text: FR },
  { code: 'fr-CA', text: FR },
  {
    code: 'de-DE',
    text: 'Ich bin der Eigentümer dieser Stimme und bin damit einverstanden, dass Google diese Stimme zur Erstellung eines synthetischen Stimmmodells verwendet.',
  },
  { code: 'es-ES', text: ES },
  { code: 'es-US', text: ES },
  {
    code: 'it-IT',
    text: 'Sono il proprietario di questa voce e acconsento che Google la utilizzi per creare un modello di voce sintetica.',
  },
  { code: 'pt-BR', text: 'Eu sou o proprietário desta voz e autorizo o Google a usá-la para criar um modelo de voz sintética.' },
  {
    code: 'ru-RU',
    text: 'Я являюсь владельцем этого голоса и даю согласие Google на использование этого голоса для создания модели синтетического голоса.',
  },
  {
    code: 'nl-NL',
    text: 'Ik ben de eigenaar van deze stem en ik geef Google toestemming om deze stem te gebruiken om een synthetisch stemmodel te maken.',
  },
  {
    code: 'pl-PL',
    text: 'Jestem właścicielem tego głosu i wyrażam zgodę na wykorzystanie go przez Google w celu utworzenia syntetycznego modelu głosu.',
  },
  { code: 'tr-TR', text: "Bu sesin sahibi benim ve Google'ın bu sesi kullanarak sentetik bir ses modeli oluşturmasına izin veriyorum." },
  { code: 'id-ID', text: 'Saya pemilik suara ini dan saya menyetujui Google menggunakan suara ini untuk membuat model suara sintetis.' },
  {
    code: 'vi-VN',
    text: 'Tôi là chủ sở hữu giọng nói này và tôi đồng ý cho Google sử dụng giọng nói này để tạo mô hình giọng nói tổng hợp.',
  },
  { code: 'th-TH', text: 'ฉันเป็นเจ้าของเสียงนี้ และฉันยินยอมให้ Google ใช้เสียงนี้เพื่อสร้างแบบจำลองเสียงสังเคราะห์' },
  { code: 'ar-XA', text: 'أنا مالك هذا الصوت وأوافق على أن تستخدم Google هذا الصوت لإنشاء نموذج صوتي اصطناعي.' },
  {
    code: 'hi-IN',
    text: 'मैं इस आवाज का मालिक हूं और मैं सिंथेटिक आवाज मॉडल बनाने के लिए Google को इस आवाज का उपयोग करने की सहमति देता हूं',
  },
  {
    code: 'bn-IN',
    text: 'আমি এই ভয়েসের মালিক এবং আমি একটি সিন্থেটিক ভয়েস মডেল তৈরি করতে এই ভয়েস ব্যবহার করে Google-এর সাথে সম্মতি দিচ্ছি।',
  },
  {
    code: 'gu-IN',
    text: 'હું આ વોઈસનો માલિક છું અને સિન્થેટિક વોઈસ મોડલ બનાવવા માટે આ વોઈસનો ઉપયોગ કરીને google ને હું સંમતિ આપું છું',
  },
  {
    code: 'kn-IN',
    text: 'ನಾನು ಈ ಧ್ವನಿಯ ಮಾಲಿಕ ಮತ್ತು ಸಂಶ್ಲೇಷಿತ ಧ್ವನಿ ಮಾದರಿಯನ್ನು ರಚಿಸಲು ಈ ಧ್ವನಿಯನ್ನು ಬಳಸಿಕೊಂಡುಗೂಗಲ್ ಗೆ ನಾನು ಸಮ್ಮತಿಸುತ್ತೇನೆ.',
  },
  {
    code: 'ml-IN',
    text: 'ഈ ശബ്ദത്തിന്റെ ഉടമ ഞാനാണ്, ഒരു സിന്തറ്റിക് വോയ്സ് മോഡൽ സൃഷ്ടിക്കാൻ ഈ ശബ്ദം ഉപയോഗിക്കുന്നതിന് ഞാൻ Google-ന് സമ്മതം നൽകുന്നു.',
  },
  {
    code: 'mr-IN',
    text: 'मी या आवाजाचा मालक आहे आणि सिंथेटिक व्हॉइस मॉडेल तयार करण्यासाठी हा आवाज वापरण्यासाठी मी Google ला संमती देतो',
  },
  {
    code: 'ta-IN',
    text: 'நான் இந்த குரலின் உரிமையாளர் மற்றும் செயற்கை குரல் மாதிரியை உருவாக்க இந்த குரலை பயன்படுத்த குகல்க்கு நான் ஒப்புக்கொள்கிறேன்.',
  },
  {
    code: 'te-IN',
    text: 'నేను ఈ వాయిస్ యజమానిని మరియు సింతటిక్ వాయిస్ మోడల్ ని రూపొందించడానికి ఈ వాయిస్ ని ఉపయోగించడానికి googleకి నేను సమ్మతిస్తున్నాను.',
  },
];
// i18n-ignore-end

/** 采集页上直接给芯片的两种；其余在「更多语言」里。 */
export const CONSENT_COMMON: readonly string[] = ['en-US', 'zh-CN'];
export const CONSENT_DEFAULT = 'en-US';
export { VOICE_CONSENT_CUSTOM };

/** 表里的一种声明；`custom` 与不认识的回 null。 */
export function consentPhrase(code: string): ConsentPhrase | null {
  return CONSENT_PHRASES.find((p) => p.code === code) ?? null;
}

/** 「更多语言」的项：表里除常用两种之外的，按原表次序。 */
export function consentMore(): ConsentPhrase[] {
  return CONSENT_PHRASES.filter((p) => !CONSENT_COMMON.includes(p.code));
}

/** `ar-XA` 是提供方的写法（XA 不是真的地区），显示名按 `ar` 取。 */
const DISPLAY_CODE: Record<string, string> = { 'ar-XA': 'ar' };

/** 声明语言的显示名：按界面语言取（`Intl.DisplayNames`），取不到时回代码本身。 */
export function consentLanguageName(code: string, uiLocale: string): string {
  try {
    const names = new Intl.DisplayNames([uiLocale], { type: 'language' });
    return names.of(DISPLAY_CODE[code] ?? code) ?? code;
  } catch {
    return code;
  }
}

// ---- 录音门槛 ----

/** 样本停下后：`short` 不给存；`local` 只够本机引擎；`ok` 云端也收；`best` 到了 30 秒（再长也是 `best`）。 */
export type SampleVerdict = 'short' | 'local' | 'ok' | 'best';

export function sampleVerdict(seconds: number): SampleVerdict {
  const s = Number.isFinite(seconds) ? seconds : 0;
  if (s < SAMPLE.min) return 'short';
  if (s < SAMPLE.good) return 'local';
  if (s < SAMPLE.target - 0.05) return 'ok';
  return 'best';
}

/** 录音时计时旁边的一句：`need` 还不够存；`enough` 够了、到目标最好；`plenty` 到了目标、想多说可以接着说；`left` 最后几秒倒数；`stop` 到上限。 */
export type RecordingNote =
  | { kind: 'need'; seconds: number }
  | { kind: 'enough' }
  | { kind: 'plenty' }
  | { kind: 'left'; seconds: number }
  | { kind: 'stop' };

export function recordingNote(seconds: number, spec: RecordingSpec): RecordingNote {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (s < spec.min) return { kind: 'need', seconds: spec.min - s };
  if (s < spec.target) return { kind: 'enough' };
  const left = spec.max - s;
  if (left <= 0.05) return { kind: 'stop' };
  return left <= spec.countdown ? { kind: 'left', seconds: left } : { kind: 'plenty' };
}

/** 录音进度条（0–100）：朝目标走，到目标就满，之后接着说也不倒退。 */
export function recordingProgress(seconds: number, spec: Pick<RecordingSpec, 'target'>): number {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.min(1, s / spec.target) * 100;
}

/** 上限写成整分钟还是秒（文案里的「最长 3 分钟」「最长 15 秒」）。 */
export function limitUnit(seconds: number): { unit: 'minutes' | 'seconds'; value: number } {
  return seconds >= 60 && seconds % 60 === 0 ? { unit: 'minutes', value: seconds / 60 } : { unit: 'seconds', value: seconds };
}

/** 授权声明录音太短（没念完整句）。 */
export function consentTooShort(seconds: number): boolean {
  return !(seconds >= CONSENT_REC.min);
}

/** 计时器：`mm:ss.s`。 */
export function clock(seconds: number): string {
  const n = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(n / 60);
  const sec = n - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
}

// ---- 照着念的台词 ----

/** 样本能照着念的语言：试听用的示例台词有的那几门（不假定中文或英文）。 */
export function scriptLanguages(): { code: string; label: string }[] {
  return sampleLangs({ languages: 'any' });
}

/** 默认念哪门：界面语言的主语言有台词就用它，否则表里第一门。 */
export function defaultScriptLanguage(uiLocale: string): string {
  const langs = scriptLanguages();
  const primary = uiLocale.toLowerCase().split('-')[0];
  return langs.find((l) => l.code === primary)?.code ?? langs[0]?.code ?? 'en';
}

/** 这门语言的几句示例台词连起来念；麦克风录的样本以它为逐字稿（念完接着随便说的那部分不在里面）。 */
export function sampleScript(code: string): string[] {
  return sampleKinds(code).map((k) => sampleLine(code, k.k).text);
}

// ---- 克隆去哪些模型 ----

export interface CloneTarget {
  /** `local`：本机引擎（种子在本机）；`cloud`：能克隆的云端提供方（记对方给的 voice id）。 */
  kind: 'local' | 'cloud';
  /** 本机模型 ID（`library:<id>` 合成时按它取种子），或 `providerId`。 */
  id: string;
  name: string;
  /** 云端：克隆要附上授权声明录音。 */
  consent: boolean;
  /** 云端：密钥连好、现在就能用；本机总为 true。 */
  connected: boolean;
  /** 本机：模型收 `seed`（才给它一颗种子）。 */
  acceptsSeed: boolean;
  /** 本机：参考录音一定要配逐字稿（采集存下的逐字稿是空的，存好后要在「编辑」里补）。 */
  needsTranscript?: boolean;
  /** 云端：Provider 收的参考录音时长（秒）；没公开时没有。 */
  sourceSeconds?: { min: number; max: number };
}

/** 旧版 Runtime 不报 `voiceClone`：那时只有这几家能克隆（选音色的地方也按它判断云端能不能用我的声音）。 */
export const VOICE_CLONE_PROVIDERS: readonly string[] = ['elevenlabs'];

/** 这个 Provider 能不能克隆音色（`library.createVoiceClone`）。 */
export function providerCanClone(p: Pick<ProviderCapabilityView, 'providerId' | 'kind' | 'voiceClone'>): boolean {
  return p.kind !== 'local' && (!!p.voiceClone || VOICE_CLONE_PROVIDERS.includes(p.providerId));
}

/** 本机装好了、能克隆的合成模型 + 能克隆的云端提供方；没连密钥的云端也列出来，先存样本，连上后在音色的 ⋯ 里上传。 */
export function cloneTargets(view: ModelCapabilitiesView | null): CloneTarget[] {
  const local: CloneTarget[] = [...localSpeechModels(view).values()]
    .filter((m) => canClone(m) && m.available !== false)
    .map((m) => ({
      kind: 'local',
      id: m.modelId,
      name: m.label,
      consent: false,
      connected: true,
      acceptsSeed: m.acceptsSeed,
      ...(m.local?.reference?.requiresTranscript ? { needsTranscript: true } : {}),
    }));
  const cloud: CloneTarget[] = (view?.synthesizeSpeech.providers ?? []).filter(providerCanClone).map((p) => ({
    kind: 'cloud',
    id: p.providerId,
    name: p.label,
    consent: !!p.voiceClone?.requiresConsentClip,
    connected: p.available,
    acceptsSeed: false,
    ...(p.voiceClone?.sourceSeconds ? { sourceSeconds: { ...p.voiceClone.sourceSeconds } } : {}),
  }));
  return [...local, ...cloud];
}

/**
 * 选上了哪些：用户点过的（`toggled`）以点的为准；没点过的按默认——本机引擎都选上（一定要逐字稿的除外：采集存下的逐字稿是空的），
 * 云端只选从模型页那一家过来时的那一家（保存后会立即上传，不替用户把声音发给他没选的提供方）；从模型页过来的那一只总是选上。
 * 每次按当下的 `targets` 算，不在打开时拍快照：能力视图晚一步才报上来的模型（刚装好）也照默认选上。
 */
export function defaultPicked(
  targets: readonly CloneTarget[],
  handoffTarget: string | null,
  toggled: Readonly<Record<string, boolean>> = {},
): string[] {
  const byDefault = (t: CloneTarget) => t.id === handoffTarget || (t.kind === 'local' && !t.needsTranscript);
  return targets.filter((t) => toggled[t.id] ?? byDefault(t)).map((t) => t.id);
}

/**
 * 打开采集时停在哪一步：从模型页某只模型过来（`preselect`）时用户已经选好了模型，直接停在样本这一步（上一步还能回去改）；
 * 否则从选模型开始。
 */
export function initialCloneStep(preselect: string | null): number {
  return preselect ? 1 : 0;
}

// ---- 保存后上传到哪 ----

/**
 * 一家选中的云端这次为什么不上传（可能不止一个，先写的是这一页上补不了的）：`offline` 没连上（连上后在音色的 ⋯ 里上传）；
 * `undeclared` 没勾本人声明（不勾也能存，只留在本机，§5.9：没有声明不上传）；`too-short` 样本比这家收的最短还短；
 * `no-consent-clip` 要授权声明录音、跳过了。
 */
export type UploadBlocker = 'offline' | 'undeclared' | 'too-short' | 'no-consent-clip';

export interface UploadRow {
  target: CloneTarget;
  /** 空：保存后立即上传。 */
  blockers: UploadBlocker[];
  /** 样本比这家收的最长还长：只用前这么多秒（Runtime 截短再上传）；不截时 null。 */
  usesFirst: number | null;
}

export interface UploadInput {
  /** 勾了本人声明（「这是我自己的声音，或已获本人许可」）。 */
  declared: boolean;
  /** 有一段能用的授权声明录音。 */
  consentClip: boolean;
  /** 样本秒数；还没有时 null。 */
  sampleSeconds: number | null;
}

/** 选中的云端每家一行：这次上不上传、为什么不、只用前几秒。本机引擎不在里面（样本留在本机，不外发）。 */
export function uploadPlan(chosen: readonly CloneTarget[], input: UploadInput): UploadRow[] {
  return chosen
    .filter((t) => t.kind === 'cloud')
    .map((target) => {
      const blockers: UploadBlocker[] = [];
      const seconds = input.sampleSeconds;
      const range = target.sourceSeconds;
      if (!target.connected) blockers.push('offline');
      if (!input.declared) blockers.push('undeclared');
      if (range && seconds !== null && seconds < range.min) blockers.push('too-short');
      if (target.consent && !input.consentClip) blockers.push('no-consent-clip');
      const usesFirst = range && seconds !== null && seconds > range.max + 0.05 ? range.max : null;
      return { target, blockers, usesFirst };
    });
}

/** 这次保存后要上传的那几家。 */
export function uploadTargets(plan: readonly UploadRow[]): CloneTarget[] {
  return plan.filter((r) => !r.blockers.length).map((r) => r.target);
}

/** 样本比哪几家收的最长还长（「Google Gemini 只用前 30 秒」）：按秒数分组，同样秒数的几家写在一起。 */
export function firstSecondsUsed(chosen: readonly CloneTarget[], sampleSeconds: number): { seconds: number; names: string[] }[] {
  const groups: { seconds: number; names: string[] }[] = [];
  for (const t of chosen) {
    const max = t.kind === 'cloud' ? t.sourceSeconds?.max : undefined;
    if (max === undefined || !(sampleSeconds > max + 0.05)) continue;
    const hit = groups.find((g) => g.seconds === max);
    if (hit) hit.names.push(t.name);
    else groups.push({ seconds: max, names: [t.name] });
  }
  return groups;
}

/** 样本比哪几家收的最短还短：要录多长（这几家里最大的下限）与它们的名字；都够时 null。 */
export function sampleTooShortFor(chosen: readonly CloneTarget[], sampleSeconds: number): { min: number; names: string[] } | null {
  const short = chosen.filter((t) => t.kind === 'cloud' && !!t.sourceSeconds && sampleSeconds < t.sourceSeconds.min);
  if (!short.length) return null;
  return { min: Math.max(...short.map((t) => t.sourceSeconds!.min)), names: short.map((t) => t.name) };
}

/** 新音色的默认名字：`base`（「我的声音」），重名时依次加「 2」「 3」…，用户可以再改。 */
export function defaultVoiceName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.trim()));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export type CloneStepKey = 'models' | 'sample' | 'consent' | 'save';
export interface CloneStep {
  key: CloneStepKey;
  /** `consent`：谁要它（提供方的名字）。 */
  needed: string[];
}

/** 采集的步骤：选模型 → 样本 →（选中的里有要授权声明录音的才有）授权声明 → 保存。 */
export function cloneSteps(chosen: readonly CloneTarget[]): CloneStep[] {
  const needed = chosen.filter((t) => t.consent).map((t) => t.name);
  const steps: CloneStep[] = [
    { key: 'models', needed: [] },
    { key: 'sample', needed: [] },
  ];
  if (needed.length) steps.push({ key: 'consent', needed });
  steps.push({ key: 'save', needed: [] });
  return steps;
}

/** 要授权声明录音的提供方（单步补录时点名谁要它）。 */
export function consentProviders(targets: readonly CloneTarget[]): CloneTarget[] {
  return targets.filter((t) => t.kind === 'cloud' && t.consent);
}

// ---- 种子 ----

/** 本机引擎没有 voice id：同一段参考 + 同一颗种子，每次都出同一个人。界面抽的在 1..2^31-1。 */
export function randomSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 2147483646);
}

/** 每只收种子的本机引擎一颗新种子。 */
export function initialSeeds(targets: readonly CloneTarget[], random: () => number = Math.random): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of targets) if (t.kind === 'local' && t.acceptsSeed) out[t.id] = randomSeed(random);
  return out;
}

/** 这只引擎上用的种子：单独给过的用那颗，否则用兜底的 `seed`；都没有时 null（合成时 Runtime 现抽一颗）。与 Runtime 的次序相同。 */
export function seedFor(content: Pick<VoiceContent, 'seed' | 'seeds'> | null | undefined, modelId: string): number | null {
  return content?.seeds?.[modelId] ?? content?.seed ?? null;
}

/** ⋯ 菜单「换种子」的对象：`*` 是兜底的 `seed`。 */
export const FALLBACK_SEED = '*';

/** 换一颗种子后的 `seed` / `seeds`（只改这一只；别的照旧）。 */
export function reseeded(
  content: Pick<VoiceContent, 'seed' | 'seeds'>,
  modelId: string,
  seed: number,
): Pick<VoiceContent, 'seed' | 'seeds'> {
  if (modelId === FALLBACK_SEED) return { ...(content.seeds ? { seeds: content.seeds } : {}), seed };
  return { ...(content.seed !== undefined ? { seed: content.seed } : {}), seeds: { ...content.seeds, [modelId]: seed } };
}

// ---- 这只音色凭什么认人 ----

/** 一颗种子用在哪些引擎上（`*` 是兜底，用在其余引擎上）。 */
export interface SeedGroup {
  value: number;
  ids: string[];
}

/** 种子按值合并：同一颗种子的几只引擎写在一起；兜底的排在它那一组最后。 */
export function seedGroups(content: Pick<VoiceContent, 'seed' | 'seeds'>): SeedGroup[] {
  const groups: SeedGroup[] = [];
  const add = (id: string, value: number) => {
    const hit = groups.find((g) => g.value === value);
    if (hit) hit.ids.push(id);
    else groups.push({ value, ids: [id] });
  };
  for (const [id, value] of Object.entries(content.seeds ?? {})) add(id, value);
  if (content.seed !== undefined) add(FALLBACK_SEED, content.seed);
  return groups;
}

export interface VoiceIdBinding {
  providerId: string;
  voiceId: string;
  stale: boolean;
}

/** 云端各家的 voice id（有效的在前）。 */
export function voiceIdBindings(clones: Record<string, VoiceClone> | undefined): VoiceIdBinding[] {
  return Object.entries(clones ?? {})
    .filter(([, c]) => !!c.voiceId)
    .map(([providerId, c]) => ({ providerId, voiceId: c.voiceId, stale: c.state === 'stale' }))
    .sort((a, b) => Number(a.stale) - Number(b.stale));
}

/** ⋯ 菜单里「换种子 · <引擎>」的引擎：本机收种子的引擎，加上已经记着种子、但这个 Runtime 已经不列的。 */
export function reseedTargets(content: Pick<VoiceContent, 'seed' | 'seeds'>, targets: readonly CloneTarget[]): string[] {
  const ids = targets.filter((t) => t.kind === 'local' && t.acceptsSeed).map((t) => t.id);
  for (const id of Object.keys(content.seeds ?? {})) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** 模型页那一行里绑在这只模型上的一只音色：本机写种子，云端写 voice id。 */
export interface BoundVoice {
  id: string;
  name: string;
  /** 本机：种子（没有时 null，合成时现抽）。 */
  seed: number | null;
  /** 云端：voice id。 */
  voiceId: string | null;
  stale: boolean;
}

/** 绑在这只模型上的音色：本机引擎列每只音色与它的种子，云端只列在这家建过克隆的。 */
export function voicesBoundTo(
  voices: readonly { id: string; content: Pick<VoiceContent, 'name' | 'seed' | 'seeds'>; clones?: Record<string, VoiceClone> }[],
  target: Pick<CloneTarget, 'kind' | 'id'>,
): BoundVoice[] {
  if (target.kind === 'cloud') {
    return voices.flatMap((v) => {
      const c = v.clones?.[target.id];
      return c?.voiceId ? [{ id: v.id, name: v.content.name, seed: null, voiceId: c.voiceId, stale: c.state === 'stale' }] : [];
    });
  }
  return voices.map((v) => ({ id: v.id, name: v.content.name, seed: seedFor(v.content, target.id), voiceId: null, stale: false }));
}

// ---- 录音的文件 ----

/** 采集用的采样率：解码时重采样到它，存单声道 16 位 WAV（15 秒的授权声明约 1.4 MiB，在 3 MiB 上限内；3 分钟的样本约 16.5 MiB）。 */
export const CAPTURE_SAMPLE_RATE = 48_000;

/** 多声道取平均成单声道，最多取前 `maxSeconds` 秒。 */
export function downmix(channels: readonly Float32Array[], sampleRate: number, maxSeconds: number): Float32Array {
  const length = Math.min(channels[0]?.length ?? 0, Math.floor(maxSeconds * sampleRate));
  const out = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) out[i]! += ch[i]! / channels.length;
  return out;
}

/** 单声道 PCM → 16 位 WAV 的字节。 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** 电平（0–1）：一帧时域样本（`getByteTimeDomainData`）的峰值，按对数压一下，安静的说话也看得见。 */
export function meterLevel(frame: Uint8Array): number {
  let peak = 0;
  for (const v of frame) peak = Math.max(peak, Math.abs(v - 128) / 128);
  if (peak <= 0) return 0;
  return Math.max(0, Math.min(1, 1 + Math.log10(peak) / 2));
}

// ---- 录音音质（设计稿 model-voice-take.js：门槛同一组数） ----
//
// 克隆新音色的样本与授权声明录完先在本机看一遍，别等云端退回才知道录坏了：要授权声明的提供方会核对两段是不是同一个人，
// 官方建议同一只麦克风、同一个房间、干净自然的说话；爆音、底噪、太小声都会让它认不准。只提醒，不拦（时长门槛在上面）。

/** 音质门槛：dB 都是 dBFS。 */
export const TAKE = {
  /** 20 ms 一帧。 */
  frame: 0.02,
  /** 底噪取开头 0.5 秒：按下录音到开口通常有这么久。 */
  noiseWindow: 0.5,
  /** |x| ≥ 0.99 算削顶。 */
  clipAt: 0.99,
  /** 削顶样本超过 0.5%：判爆音，保存前提醒。 */
  clipWarn: 0.005,
  /** 底噪高于 −45 dBFS：判太吵，保存前提醒。 */
  noiseWarnDb: -45,
  /** 一帧 RMS 低于 −50 dBFS 算静音。 */
  silenceDb: -50,
  /** 说话（非静音帧）的电平低于 −35 dBFS：太小声。 */
  quietDb: -35,
  /** 95% 以上是静音：几乎没录到声音。 */
  silentRatio: 0.95,
  /** 一半以上是静音：停顿太多。 */
  pauseWarn: 0.5,
  /** 录音中只看最近 1.5 秒。 */
  liveWindow: 1.5,
  /** 最近这一段削顶超过 0.1% 就当场提醒。 */
  liveClip: 0.001,
  /** 开录 3 秒还没听到人声：多半是麦克风不对。 */
  noVoiceAfter: 3,
} as const;

const DB_FLOOR = -120;
/** 比它还低的是数字静音（设备刚打开时的全零），不算进底噪。 */
const ZERO_DB = -100;

const dbfs = (x: number) => (x > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(x)) : DB_FLOOR);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** 从小到大第 q 分位（0–1），取下标向下取整的那个；空的回最低值。 */
function quantile(list: readonly number[], q: number): number {
  if (!list.length) return DB_FLOOR;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)]!;
}

/** 一段录音的读数。dB 都是 dBFS（最低 −120），比例是 0–1。 */
export interface TakeAnalysis {
  seconds: number;
  /** 说话的电平：非静音帧的 RMS（全是静音时退到整段 RMS）。 */
  levelDb: number;
  peakDb: number;
  /** 削顶样本的比例。 */
  clipRatio: number;
  /** 静音帧的比例。 */
  silenceRatio: number;
  /** 底噪：开头 0.5 秒各帧 RMS 的下四分位（刚开口也不至于被说话顶高），跳过全零。 */
  noiseFloorDb: number;
}

/** 一段单声道 PCM（−1..1）的读数。 */
export function analyzeTake(samples: Float32Array, sampleRate: number): TakeAnalysis {
  const n = samples.length;
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  if (!n || !sr) return { seconds: 0, levelDb: DB_FLOOR, peakDb: DB_FLOOR, clipRatio: 0, silenceRatio: 1, noiseFloorDb: DB_FLOOR };
  const size = Math.max(1, Math.round(TAKE.frame * sr));
  const headEnd = TAKE.noiseWindow * sr;
  const head: number[] = [];
  let peak = 0;
  let clipped = 0;
  let total = 0;
  let voiced = 0;
  let voicedN = 0;
  let frames = 0;
  let silent = 0;
  for (let start = 0; start < n; start += size) {
    const end = Math.min(n, start + size);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const x = samples[i]!;
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
      if (a >= TAKE.clipAt) clipped += 1;
      sum += x * x;
    }
    total += sum;
    frames += 1;
    const d = dbfs(Math.sqrt(sum / (end - start)));
    if (d < TAKE.silenceDb) silent += 1;
    else {
      voiced += sum;
      voicedN += end - start;
    }
    if (start < headEnd && d > ZERO_DB) head.push(d);
  }
  return {
    seconds: round1(n / sr),
    levelDb: round1(dbfs(Math.sqrt(voicedN ? voiced / voicedN : total / n))),
    peakDb: round1(dbfs(peak)),
    clipRatio: clipped / n,
    silenceRatio: silent / frames,
    noiseFloorDb: round1(quantile(head, 0.25)),
  };
}

/** 几段接成一段。 */
function joinFrames(frames: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/**
 * 录音进行中的读数：每次取到一帧时域样本（AnalyserNode，约 0.1 秒一帧）喂进来。`recent` 是最近 1.5 秒的读数，
 * `noiseFloorDb` 是开头 0.5 秒量到的（还没量完是 null），`heard` 是到现在有没有过非静音的帧。
 */
export interface LiveTake {
  sampleRate: number;
  frames: Float32Array[];
  head: Float32Array[];
  heard: boolean;
  noiseFloorDb: number | null;
  recent: TakeAnalysis | null;
}

export function startLiveTake(sampleRate: number): LiveTake {
  return { sampleRate, frames: [], head: [], heard: false, noiseFloorDb: null, recent: null };
}

/** 喂一帧（会复制，AnalyserNode 复用同一块缓冲）。`seconds` 是这一帧在录音里的时刻，`interval` 是两帧之间隔多久。 */
export function feedLiveTake(live: LiveTake, frame: Float32Array, seconds: number, interval = 0.1): LiveTake {
  const copy = Float32Array.from(frame);
  const keep = Math.max(1, Math.round(TAKE.liveWindow / interval));
  const frames = [...live.frames, copy].slice(-keep);
  const inHead = seconds <= TAKE.noiseWindow;
  const head = inHead ? [...live.head, copy] : live.head;
  const noiseFloorDb =
    live.noiseFloorDb ?? (!inHead && head.length ? analyzeTake(joinFrames(head), live.sampleRate).noiseFloorDb : null);
  const heard = live.heard || analyzeTake(copy, live.sampleRate).silenceRatio < 1;
  return { ...live, frames, head: inHead ? head : [], heard, noiseFloorDb, recent: analyzeTake(joinFrames(frames), live.sampleRate) };
}

/** 录音中那一行：`waiting` 还没开口；`ok` 音量合适；其余是要当场改的。 */
export type LiveTakeHint = 'clipping' | 'silent' | 'quiet' | 'noisy' | 'waiting' | 'ok';

/** 先后：爆音 > 3 秒还没声音 > 太小声 > 太吵 > 等开口 > 合适。 */
export function liveTakeHint(live: Pick<LiveTake, 'recent' | 'noiseFloorDb' | 'heard'>, seconds: number): LiveTakeHint {
  const s = Number.isFinite(seconds) ? seconds : 0;
  const recent = live.recent;
  if (recent && recent.clipRatio > TAKE.liveClip) return 'clipping';
  if (!live.heard && s >= TAKE.noVoiceAfter) return 'silent';
  if (live.heard && recent && recent.silenceRatio < 1 && recent.levelDb < TAKE.quietDb) return 'quiet';
  if (live.noiseFloorDb !== null && live.noiseFloorDb > TAKE.noiseWarnDb) return 'noisy';
  return live.heard ? 'ok' : 'waiting';
}

/** 停下后这段录音的毛病（按要紧程度排）；几乎没声音时只报 `silent`。 */
export type TakeIssue = 'silent' | 'clipping' | 'quiet' | 'noisy' | 'pauses';

export function takeIssues(a: TakeAnalysis | null | undefined): TakeIssue[] {
  if (!a) return [];
  if (a.silenceRatio >= TAKE.silentRatio) return ['silent'];
  const out: TakeIssue[] = [];
  if (a.clipRatio > TAKE.clipWarn) out.push('clipping');
  if (a.levelDb < TAKE.quietDb) out.push('quiet');
  if (a.noiseFloorDb > TAKE.noiseWarnDb) out.push('noisy');
  if (a.silenceRatio > TAKE.pauseWarn) out.push('pauses');
  return out;
}

/** 一只麦克风：`id` 是选的输入设备（`default` 是系统默认），`group` 是它的物理设备（`groupId`，认得出系统默认就是哪一只）。 */
export interface MicIdentity {
  id: string;
  group?: string;
}

/** 是不是同一只：两边都知道物理设备时按它比，否则按选的设备比。 */
export function sameMic(a: MicIdentity, b: MicIdentity): boolean {
  return a.group && b.group ? a.group === b.group : a.id === b.id;
}

/** 比麦克风用到的一段录音：麦克风录的带着当时那只。 */
export interface TakeSource {
  via: 'mic' | 'upload';
  mic?: MicIdentity | null;
  analysis?: TakeAnalysis | null;
}

/**
 * 授权声明和样本是不是同一只麦克风：样本是上传的不比；授权声明已录就看它录时用的（上传的不比），没录就看现在选的 `current`。
 * 不是同一只时 true。
 */
export function micMismatch(sample: TakeSource | null, consent: TakeSource | null, current: MicIdentity | null): boolean {
  if (!sample || sample.via !== 'mic' || !sample.mic) return false;
  const used = consent ? (consent.via === 'mic' ? (consent.mic ?? null) : null) : current;
  return !!used && !sameMic(used, sample.mic);
}

/** 保存前那条提醒的一项：哪一段（`step`）有什么（爆音、底噪，或两段不是同一只麦克风）。 */
export interface SaveTakeWarning {
  step: 'sample' | 'consent';
  kind: 'clipping' | 'noisy' | 'mic';
}

/**
 * 保存这一步、上传按钮上面那条提醒：只看会让对方认不准的——削顶超过 0.5%、底噪高于 −45 dBFS、两段不是同一只麦克风；干净的回 []。
 * 授权声明这次不上传就别给 `consent`（本机引擎只用样本）。
 */
export function saveTakeWarnings(clips: { sample: TakeSource | null; consent?: TakeSource | null }): SaveTakeWarning[] {
  const out: SaveTakeWarning[] = [];
  for (const step of ['sample', 'consent'] as const) {
    const a = clips[step]?.analysis;
    if (!a) continue;
    if (a.clipRatio > TAKE.clipWarn) out.push({ step, kind: 'clipping' });
    if (a.noiseFloorDb > TAKE.noiseWarnDb) out.push({ step, kind: 'noisy' });
  }
  if (clips.consent && micMismatch(clips.sample, clips.consent, null)) out.push({ step: 'consent', kind: 'mic' });
  return out;
}

/** 那条提醒里要回去重录的步骤（按步骤的先后）。 */
export function redoSteps(list: readonly SaveTakeWarning[]): ('sample' | 'consent')[] {
  return (['sample', 'consent'] as const).filter((step) => list.some((w) => w.step === step));
}
