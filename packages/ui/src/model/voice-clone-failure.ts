import { CLONE_FAILURE_COPY as F } from '../components/models/voices-copy.ts';
import { SAMPLE } from './voice-capture.ts';

/**
 * 克隆没建成时给人看的诊断（架构设计 §5.9）：按 Runtime 报的错误码与 `details.reason`（命令协议规范 §5 的 `voiceClone`
 * 失败原因）说清原因、怎么办，配一个一键补救。提交时就被拒（没建任务）与任务失败走同一张表。认不出的给这家通用的建议，
 * Provider 的原话放在最后（`detail`）。这里只算，不画。
 */

/** 一次没建成的克隆：错误码、原因与原话（已按界面语言写好），加上判断用得着的这家与这只音色的事实。 */
export interface CloneFailureFacts {
  providerId: string;
  /** Provider 的名字；这个 Runtime 已经不登记时是 `providerId`。 */
  label: string;
  code: string | null;
  /** `details.reason`：`speaker-mismatch`、`consent-unrecognized`、`source-duration`…… */
  reason: string | null;
  /** Provider 的 HTTP 状态（有时才有）。 */
  status: number | null;
  /** 原话；空串时不写「详情」。 */
  message: string;
  /** Runtime 给的补救（授权、预算的拒绝带着）。 */
  remedy: string | null;
  /** 这家收的样本时长（能力视图的 `voiceClone.sourceSeconds`）。 */
  sourceSeconds: { min: number; max: number } | null;
  /** 这只音色已经有授权声明录音（决定补救写「重录」还是「录」）。 */
  hasConsentClip: boolean;
}

/**
 * 一键补救：`reconsent` 重录授权声明，存好后自动重新上传；`record-consent` 第一次录授权声明，存好后上传；`resample` 录一段新样本
 * （打开克隆新音色、预选这家）；`retry` 原样再传一次；`provider` 打开这家的设置；`privacy` 打开隐私与权限（数据外发授权）；
 * `edit` 打开这只音色的编辑（勾本人声明）。
 */
export type CloneFixKind = 'reconsent' | 'record-consent' | 'resample' | 'retry' | 'provider' | 'privacy' | 'edit';

export interface CloneDiagnosis {
  cause: string;
  advice: string | null;
  fix: { kind: CloneFixKind; label: string } | null;
  /** Provider 的原话（「详情：…」）；没有时 null。 */
  detail: string | null;
}

const isGoogle = (f: CloneFailureFacts) => f.providerId === 'google';

/** 认不出的失败：这家通用的建议。Gemini 的那句要写样本时长，取能力视图报的；没报时用通用的。 */
function genericAdvice(f: CloneFailureFacts): string {
  const range = f.sourceSeconds;
  return isGoogle(f) && range ? F.adviceGoogle(range.min, range.max) : F.advice;
}

function consentFix(f: CloneFailureFacts): CloneDiagnosis['fix'] {
  return f.hasConsentClip ? { kind: 'reconsent', label: F.fixReconsent } : { kind: 'record-consent', label: F.fixRecordConsent };
}

const resample = (): CloneDiagnosis['fix'] => ({ kind: 'resample', label: F.fixResample });
const retry = (f: CloneFailureFacts): CloneDiagnosis['fix'] => ({ kind: 'retry', label: F.fixRetry(f.label) });
const provider = (f: CloneFailureFacts): CloneDiagnosis['fix'] => ({ kind: 'provider', label: F.fixProvider(f.label) });
const privacy = (): CloneDiagnosis['fix'] => ({ kind: 'privacy', label: F.fixPrivacy });

/** 按 `details.reason`（Provider 拒绝的具体原因）；不认得的原因交给错误码。 */
function byReason(f: CloneFailureFacts): Omit<CloneDiagnosis, 'detail'> | null {
  switch (f.reason) {
    case 'speaker-mismatch':
      return { cause: F.speakerMismatch, advice: F.speakerMismatchAdvice, fix: consentFix(f) };
    case 'consent-unrecognized':
      return { cause: F.consentUnrecognized, advice: F.consentUnrecognizedAdvice, fix: consentFix(f) };
    case 'source-duration': {
      const range = f.sourceSeconds;
      return {
        cause: F.sourceDuration(f.label, range ? F.rangeSeconds(range.min, range.max) : null),
        advice: F.sourceDurationAdvice(range?.min ?? SAMPLE.good),
        fix: resample(),
      };
    }
    case 'synthetic-audio':
      return { cause: F.synthetic, advice: F.syntheticAdvice, fix: resample() };
    case 'audio-invalid':
      return { cause: F.audioInvalid(f.label), advice: F.audioInvalidAdvice, fix: resample() };
    case 'voice-limit':
      return { cause: F.voiceLimit(f.label), advice: isGoogle(f) ? F.voiceLimitAdviceGoogle : F.voiceLimitAdvice, fix: retry(f) };
    case 'feature-unavailable':
      return { cause: F.feature(f.label), advice: isGoogle(f) ? F.featureAdviceGoogle : F.featureAdvice, fix: provider(f) };
    default:
      return null;
  }
}

/** 按错误码（没有原因、或原因不认得时）。 */
function byCode(f: CloneFailureFacts): Omit<CloneDiagnosis, 'detail'> {
  switch (f.code) {
    case 'PROVIDER_AUTH_FAILED':
      return { cause: F.auth(f.label), advice: F.authAdvice, fix: provider(f) };
    case 'PROVIDER_QUOTA_EXCEEDED':
      return { cause: F.quota(f.label), advice: F.quotaAdvice, fix: retry(f) };
    case 'PROVIDER_UNAVAILABLE':
      return {
        cause: f.status !== null ? F.unavailableStatus(f.label, f.status) : F.unavailable(f.label),
        advice: F.unavailableAdvice,
        fix: retry(f),
      };
    case 'VOICE_CONSENT_REQUIRED':
      return { cause: F.consentRequired, advice: F.consentRequiredAdvice, fix: { kind: 'edit', label: F.fixEdit } };
    case 'VOICE_CONSENT_CLIP_REQUIRED':
      return { cause: F.clipRequired(f.label), advice: F.clipRequiredAdvice, fix: { kind: 'record-consent', label: F.fixRecordConsent } };
    case 'CAPABILITY_NOT_CONFIGURED':
      return { cause: F.notConfigured(f.label), advice: F.notConfiguredAdvice, fix: provider(f) };
    case 'GRANT_REQUIRED':
    case 'GRANT_REVOKED':
      return { cause: F.grant(f.label), advice: f.remedy ?? F.grantAdvice, fix: privacy() };
    case 'BUDGET_EXCEEDED':
      return { cause: F.budget(f.label), advice: f.remedy ?? F.budgetAdvice, fix: privacy() };
    case 'VOICE_CLONE_UNSUPPORTED':
      return { cause: F.unsupported(f.label), advice: null, fix: null };
    case 'PROVIDER_REJECTED':
      return { cause: F.rejected(f.label), advice: genericAdvice(f), fix: retry(f) };
    default:
      return { cause: F.failed(f.label), advice: f.remedy ?? genericAdvice(f), fix: retry(f) };
  }
}

/** 一次没建成的克隆 → 原因、怎么办、一键补救与原话。 */
export function diagnoseCloneFailure(f: CloneFailureFacts): CloneDiagnosis {
  const found = byReason(f) ?? byCode(f);
  const message = f.message.trim();
  return { ...found, detail: message ? F.detail(message) : null };
}
