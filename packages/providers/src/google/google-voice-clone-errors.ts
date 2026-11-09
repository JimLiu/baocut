// Gemini 复刻音色（`POST {base}/voices`）被拒时的原因（架构设计 §6.4「音色克隆的请求」）。文档只写了规则（参考录音 10–30 秒、
// 授权声明是同一个成年人念的官方原文、合成或带 SynthID / C2PA 水印的录音在核验时被拒、每个项目 200 只、要付费层级的项目），
// 没写错误的原话：这里按 Google 错误体的 `error.status`（INVALID_ARGUMENT、PERMISSION_DENIED、FAILED_PRECONDITION、
// RESOURCE_EXHAUSTED……）、`error.message`、`error.details[]`（`reason`、`metadata`、`violations`、`fieldViolations`）与 HTTP 状态，
// 加上保守的关键词判断，归成 `details.reason`。认不出的照旧是 `PROVIDER_REJECTED`、不带原因，原话照样在错误信息里。
// 用真密钥核对原话之前列在架构设计 §14 待评审。
import type { RejectionCode } from '../http/provider-fetch.ts';
import { classifyGoogle } from './google-adapter.ts';

/** 克隆任务失败时 `error.details.reason` 的取值（命令协议规范 §5 的 `voiceClone` 失败原因），界面按它给出说明与修法。 */
export type VoiceCloneRejectionReason =
  /** 授权声明录音与参考录音没被认作同一个人（说话人核验没过）。 */
  | 'speaker-mismatch'
  /** 授权声明没认出来：不是官方原文、念得不全、语言不对。 */
  | 'consent-unrecognized'
  /** 参考录音太短或太长。 */
  | 'source-duration'
  /** 录音被认作合成的、AI 生成的，或带 SynthID / C2PA 水印。 */
  | 'synthetic-audio'
  /** 音频格式不支持、文件坏了、媒体类型不对，或请求体太大（413）。 */
  | 'audio-invalid'
  /** 项目里的复刻音色到了上限。 */
  | 'voice-limit'
  /** 这个项目用不了复刻音色：要付费层级、开通结算，地区不支持或没有权限。 */
  | 'feature-unavailable';

type Classified = RejectionCode | { code: RejectionCode; reason: VoiceCloneRejectionReason };

/** 密钥本身的问题（无效、过期、受限、停用，或项目没开 Gemini API）：一律是认证失败，不算克隆的原因。 */
const KEY_PROBLEM =
  /API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_SERVICE_BLOCKED|API key not valid|API key expired|unregistered callers|CONSUMER_SUSPENDED|has been suspended|SERVICE_DISABLED/i;
/**
 * 按时间窗计的额度（每分钟、每天的请求数）：带这些说法的「上限」是限速，不是音色的个数。不看 `RATE_LIMIT_EXCEEDED` 这类原因码
 * 与文档链接里的 rate-limits：Google 的项目级额度也用它们。
 */
const RATE = /per (second|minute|hour|day)|PerSecond|PerMinute|PerHour|PerDay|requests per|retry (in|after) \d|\bRP[MD]\b/i;
const VOICE_LIMIT =
  /\bvoices?\s+(limit|quota|cap)\b|\b(maximum|max|limit)\b[^.]{0,30}\bvoices\b|too many (\w+ )?voices\b|number of (\w+ )?voices\b|voices per project|quota[^.]{0,40}\bvoices\b|\b(stored|saved|replicated|custom|cloned) voices\b[^.]{0,30}\b(limit|quota|maximum)/i;
const FREE_TIER = /free[ -]?tier/i;
const NO_QUOTA = /\blimit:?\s*0\b/i;
const SYNTHETIC =
  /synth ?id|\bc2pa\b|watermark|\bsynthetic\b|\bai[- ]generated|artificially generated|machine[- ]generated|computer[- ]generated|generated (by|with|using) (an? )?(ai|model)|deep ?fake/i;
const FEATURE =
  /\bbilling\b|paid[- ]tier|\bpaid (plan|account|project)|free[ -]?tier|\btier ?1\b|upgrade (your|to)|not available (in|for|on) (your|this|the) (country|region|location|project|account|plan|tier)|(country|region|location) (is )?not supported|unsupported (country|region|location)|user location|allow[- ]?list|not (yet )?(enabled|available) for (your|this) (project|account|api key|key)|early access/i;
const TOO_LARGE = /too large|too big|size exceeds|exceeds the (maximum |max )?(allowed )?(size|payload)|payload size|request entity|\bbytes\b|\b\d+ ?(KB|MB|MiB)\b/i;
const DURATION =
  /too (short|long)|\bduration\b|\bseconds?\b|\b\d+(\.\d+)? ?s\b|(audio|clip|recording|sample) length|length of (the )?(audio|clip|recording|sample)|(minimum|maximum) length|shorter than|longer than/i;
const BAD_AUDIO =
  /decod|corrupt|malformed|unreadable|(could not|cannot|unable to|failed to) (be )?(read|parsed?)|unsupported (audio |media |file )?(format|mime|codec|encoding|type|content)|(mime|media|content) type|invalid (audio|media|file|wav|mp3|flac|base64|mime)|base64|audio format|sample rate|no audio|empty audio|not (a )?valid audio/i;
/** 产品名里的「voice」不算说话人的线索。 */
const PRODUCT = /voice replication|replicated voices?|voice clon(e|es|ing)|custom voices?/gi;
const SPEAKER =
  /\bspeakers?\b|(voice|speaker) (verification|identity|identification)|same (person|individual|voice)|different (person|people|individual|voices?)|\bvoices?\b[^.]{0,40}\b(match|mismatch)/i;
const CONSENT = /\bconsent\b|\bstatement\b|\bphrase\b|official text|expected text|\blanguage\b|\blocale\b|\bverif(y|ied|ication)\b/i;
const CONSENT_ONLY = /\bconsent\b/i;
const SOURCE = /\bsource\b|\bsample\b|\breference\b/i;

/**
 * `createVoiceClone` 的 4xx 分类（`providerFetch` 的 `classify`）。别的 Gemini 请求仍用 `classifyGoogle`。按下面的先后，第一条
 * 命中的算数：
 * 1. 401、密钥无效或受限：`PROVIDER_AUTH_FAILED`。
 * 2. 429 或 RESOURCE_EXHAUSTED：说的是音色个数（且不是每分钟、每天的请求数）为 `voice-limit`；免费层级的额度是 0 为
 *    `feature-unavailable`；其余是限速 `PROVIDER_QUOTA_EXCEEDED`。前两种是 `PROVIDER_REJECTED`，不按限速重试。
 * 3. 413：`audio-invalid`。
 * 4. 其余 4xx 按内容：合成或水印 → 音色个数 → 付费层级、结算、地区、权限 → 请求体太大 → 时长（只说授权声明录音的归
 *    `consent-unrecognized`）→ 音频格式 → 说话人 → 授权声明、原文、语言或笼统的「核验没过」（`consent-unrecognized`）。
 *    提到授权与核验却没说说话人的，归 `consent-unrecognized`。
 * 5. 什么都没认出的 403 或 PERMISSION_DENIED：`feature-unavailable`；其余 `PROVIDER_REJECTED`，不带原因。
 */
export function classifyGoogleVoiceClone(status: number, body: string): Classified {
  if (status === 401 || classifyGoogle(status, body) === 'PROVIDER_AUTH_FAILED' || KEY_PROBLEM.test(body)) return 'PROVIDER_AUTH_FAILED';
  const error = googleErrorOf(body);
  // 原因码与字段路径里的下划线当空格：`SPEAKER_MISMATCH`、`consent_audio`、`free_tier` 与句子里的写法一样认。
  const text = error.text.replace(/_/g, ' ');
  const rejected = (reason: VoiceCloneRejectionReason): Classified => ({ code: 'PROVIDER_REJECTED', reason });
  const voiceLimit = VOICE_LIMIT.test(text) && !RATE.test(text);
  if (status === 429 || error.status === 'RESOURCE_EXHAUSTED') {
    if (voiceLimit) return rejected('voice-limit');
    if (FREE_TIER.test(text) && NO_QUOTA.test(text)) return rejected('feature-unavailable');
    return 'PROVIDER_QUOTA_EXCEEDED';
  }
  if (status === 413) return rejected('audio-invalid');
  if (SYNTHETIC.test(text)) return rejected('synthetic-audio');
  if (voiceLimit) return rejected('voice-limit');
  if (FEATURE.test(text)) return rejected('feature-unavailable');
  if (TOO_LARGE.test(text)) return rejected('audio-invalid');
  if (DURATION.test(text)) return rejected(CONSENT_ONLY.test(text) && !SOURCE.test(text) ? 'consent-unrecognized' : 'source-duration');
  if (BAD_AUDIO.test(text)) return rejected('audio-invalid');
  if (SPEAKER.test(text.replace(PRODUCT, ' '))) return rejected('speaker-mismatch');
  if (CONSENT.test(text)) return rejected('consent-unrecognized');
  if (status === 403 || error.status === 'PERMISSION_DENIED') return rejected('feature-unavailable');
  return 'PROVIDER_REJECTED';
}

/** Google 错误体里用来判断的文字：`message`，加上 `details[]` 的原因码、元数据与违规说明。不是这种形状时整个响应体。 */
function googleErrorOf(body: string): { status: string; text: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: '', text: body };
  }
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  const error = isObject(root) && isObject(root.error) ? root.error : null;
  if (!error) return { status: '', text: body };
  const parts: string[] = [];
  if (typeof error.message === 'string') parts.push(error.message);
  for (const detail of arrayOf(error.details)) {
    if (typeof detail.reason === 'string') parts.push(detail.reason);
    if (isObject(detail.metadata)) for (const value of Object.values(detail.metadata)) if (typeof value === 'string') parts.push(value);
    for (const violation of [...arrayOf(detail.violations), ...arrayOf(detail.fieldViolations)]) {
      for (const key of ['field', 'description', 'subject', 'quotaMetric', 'quotaId', 'reason']) {
        if (typeof violation[key] === 'string') parts.push(violation[key]);
      }
      if (typeof violation.quotaValue === 'string' || typeof violation.quotaValue === 'number') parts.push(`limit: ${violation.quotaValue}`);
    }
  }
  return { status: typeof error.status === 'string' ? error.status : '', text: parts.join('\n') };
}

function arrayOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
