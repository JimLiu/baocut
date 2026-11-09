import { describe, expect, it } from 'vitest';
import { CLONE_FAILURE_COPY as F } from '../components/models/voices-copy.ts';
import { SAMPLE } from './voice-capture.ts';
import { diagnoseCloneFailure, type CloneFailureFacts } from './voice-clone-failure.ts';

const GEMINI: CloneFailureFacts = {
  providerId: 'google',
  label: 'Google Gemini',
  code: 'PROVIDER_REJECTED',
  reason: null,
  status: 400,
  message: 'Request contains an invalid argument.',
  remedy: null,
  sourceSeconds: { min: 10, max: 30 },
  hasConsentClip: true,
};
const ELEVEN: CloneFailureFacts = { ...GEMINI, providerId: 'elevenlabs', label: 'ElevenLabs', sourceSeconds: null, hasConsentClip: false };

const gemini = (patch: Partial<CloneFailureFacts>) => diagnoseCloneFailure({ ...GEMINI, ...patch });
const eleven = (patch: Partial<CloneFailureFacts>) => diagnoseCloneFailure({ ...ELEVEN, ...patch });

/** 命令协议规范 §11.3：`voiceClone` 被拒时 `details.reason` 的全部取值。 */
const REASONS = ['speaker-mismatch', 'consent-unrecognized', 'source-duration', 'synthetic-audio', 'audio-invalid', 'voice-limit', 'feature-unavailable'];

describe('Provider 拒绝的原因（details.reason）', () => {
  it('每个原因都有自己的说法与一键补救，不落到笼统的「没接受」', () => {
    for (const reason of REASONS) {
      const d = gemini({ reason });
      expect(d.cause, reason).not.toBe(F.rejected('Google Gemini'));
      expect(d.advice, reason).toBeTruthy();
      expect(d.fix, reason).not.toBeNull();
    }
  });

  it('两段不像同一个人、没认出授权声明：重录授权声明；还没有录音时是「录」', () => {
    expect(gemini({ reason: 'speaker-mismatch' })).toMatchObject({
      cause: F.speakerMismatch,
      advice: F.speakerMismatchAdvice,
      fix: { kind: 'reconsent', label: F.fixReconsent },
    });
    expect(gemini({ reason: 'consent-unrecognized' })).toMatchObject({
      cause: F.consentUnrecognized,
      advice: F.consentUnrecognizedAdvice,
      fix: { kind: 'reconsent' },
    });
    expect(gemini({ reason: 'speaker-mismatch', hasConsentClip: false }).fix).toEqual({ kind: 'record-consent', label: F.fixRecordConsent });
    expect(gemini({ reason: 'consent-unrecognized', hasConsentClip: false }).fix).toEqual({ kind: 'record-consent', label: F.fixRecordConsent });
  });

  it('样本时长不合：范围取能力视图报的；没报时不写范围，建议按云端的下限', () => {
    expect(gemini({ reason: 'source-duration' })).toEqual({
      cause: F.sourceDuration('Google Gemini', F.rangeSeconds(10, 30)),
      advice: F.sourceDurationAdvice(10),
      fix: { kind: 'resample', label: F.fixResample },
      detail: F.detail('Request contains an invalid argument.'),
    });
    expect(gemini({ reason: 'source-duration', sourceSeconds: { min: 15, max: 60 } }).cause).toBe(F.sourceDuration('Google Gemini', F.rangeSeconds(15, 60)));
    expect(gemini({ reason: 'source-duration', sourceSeconds: null })).toMatchObject({
      cause: F.sourceDuration('Google Gemini', null),
      advice: F.sourceDurationAdvice(SAMPLE.good),
    });
    expect(eleven({ reason: 'source-duration' }).cause).toBe(F.sourceDuration('ElevenLabs', null));
  });

  it('合成录音、音频读不了：录一段新样本', () => {
    expect(gemini({ reason: 'synthetic-audio' })).toMatchObject({ cause: F.synthetic, advice: F.syntheticAdvice, fix: { kind: 'resample' } });
    expect(gemini({ reason: 'audio-invalid', status: 413 })).toMatchObject({
      cause: F.audioInvalid('Google Gemini'),
      advice: F.audioInvalidAdvice,
      fix: { kind: 'resample' },
    });
  });

  it('音色存满了：删掉不用的再传；Gemini 说项目的上限', () => {
    expect(gemini({ reason: 'voice-limit', status: 429 })).toMatchObject({
      cause: F.voiceLimit('Google Gemini'),
      advice: F.voiceLimitAdviceGoogle,
      fix: { kind: 'retry', label: F.fixRetry('Google Gemini') },
    });
    expect(eleven({ reason: 'voice-limit' }).advice).toBe(F.voiceLimitAdvice);
  });

  it('这把密钥还不能克隆（付费层级、结算、地区、权限）：打开这家的设置；Gemini 说付费层级', () => {
    expect(gemini({ reason: 'feature-unavailable', status: 403 })).toMatchObject({
      cause: F.feature('Google Gemini'),
      advice: F.featureAdviceGoogle,
      fix: { kind: 'provider', label: F.fixProvider('Google Gemini') },
    });
    expect(eleven({ reason: 'feature-unavailable' }).advice).toBe(F.featureAdvice);
  });

  it('不认得的原因按错误码走', () => {
    expect(gemini({ reason: 'something-new' }).cause).toBe(F.rejected('Google Gemini'));
  });
});

describe('错误码', () => {
  it('被拒但没说原因：这家的自查建议（Gemini 按报的时长），可以重试，原话放在最后', () => {
    expect(gemini({})).toEqual({
      cause: F.rejected('Google Gemini'),
      advice: F.adviceGoogle(10, 30),
      fix: { kind: 'retry', label: F.fixRetry('Google Gemini') },
      detail: F.detail('Request contains an invalid argument.'),
    });
    expect(gemini({ sourceSeconds: null }).advice).toBe(F.advice);
    expect(eleven({}).advice).toBe(F.advice);
  });

  it('密钥、限速、连不上', () => {
    expect(gemini({ code: 'PROVIDER_AUTH_FAILED' })).toMatchObject({ cause: F.auth('Google Gemini'), advice: F.authAdvice, fix: { kind: 'provider' } });
    expect(gemini({ code: 'PROVIDER_QUOTA_EXCEEDED' })).toMatchObject({ cause: F.quota('Google Gemini'), advice: F.quotaAdvice, fix: { kind: 'retry' } });
    expect(gemini({ code: 'PROVIDER_UNAVAILABLE', status: 503 })).toMatchObject({
      cause: F.unavailableStatus('Google Gemini', 503),
      advice: F.unavailableAdvice,
      fix: { kind: 'retry' },
    });
    expect(gemini({ code: 'PROVIDER_UNAVAILABLE', status: null }).cause).toBe(F.unavailable('Google Gemini'));
  });

  it('提交时的检查：本人声明、授权声明录音、没启用、不支持', () => {
    expect(gemini({ code: 'VOICE_CONSENT_REQUIRED' })).toMatchObject({
      cause: F.consentRequired,
      advice: F.consentRequiredAdvice,
      fix: { kind: 'edit', label: F.fixEdit },
    });
    expect(gemini({ code: 'VOICE_CONSENT_CLIP_REQUIRED' })).toMatchObject({
      cause: F.clipRequired('Google Gemini'),
      advice: F.clipRequiredAdvice,
      fix: { kind: 'record-consent', label: F.fixRecordConsent },
    });
    expect(gemini({ code: 'CAPABILITY_NOT_CONFIGURED' })).toMatchObject({
      cause: F.notConfigured('Google Gemini'),
      advice: F.notConfiguredAdvice,
      fix: { kind: 'provider' },
    });
    expect(gemini({ code: 'VOICE_CLONE_UNSUPPORTED' })).toMatchObject({ cause: F.unsupported('Google Gemini'), advice: null, fix: null });
  });

  it('外发授权与预算：去隐私与权限；Runtime 给了补救时用它的', () => {
    for (const code of ['GRANT_REQUIRED', 'GRANT_REVOKED']) {
      expect(gemini({ code })).toMatchObject({ cause: F.grant('Google Gemini'), advice: F.grantAdvice, fix: { kind: 'privacy', label: F.fixPrivacy } });
    }
    expect(gemini({ code: 'GRANT_REQUIRED', remedy: 'baocut grants create …' }).advice).toBe('baocut grants create …');
    expect(gemini({ code: 'BUDGET_EXCEEDED' })).toMatchObject({ cause: F.budget('Google Gemini'), advice: F.budgetAdvice, fix: { kind: 'privacy' } });
    expect(gemini({ code: 'BUDGET_EXCEEDED', remedy: '提高上限' }).advice).toBe('提高上限');
  });

  it('别的错误（含没有错误码）：笼统的失败，优先用 Runtime 的补救，可以重试', () => {
    expect(eleven({ code: 'INTERNAL', remedy: '重启 BaoCut' })).toMatchObject({
      cause: F.failed('ElevenLabs'),
      advice: '重启 BaoCut',
      fix: { kind: 'retry', label: F.fixRetry('ElevenLabs') },
    });
    expect(gemini({ code: null }).advice).toBe(F.adviceGoogle(10, 30));
    expect(eleven({ code: null }).advice).toBe(F.advice);
  });
});

describe('原话', () => {
  it('去掉首尾空白放在「详情」里；没有原话时不写', () => {
    expect(gemini({ message: '  Voice limit reached.\n' }).detail).toBe(F.detail('Voice limit reached.'));
    expect(gemini({ message: '   ' }).detail).toBeNull();
    expect(gemini({ message: '' }).detail).toBeNull();
  });
});
