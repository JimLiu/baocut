import { describe, expect, it } from 'vitest';
import type { JobRecord, LibraryEntrySummary } from '@baocut/protocol';
import { fixtureView } from './models-test-fixtures.ts';
import {
  cloneProviders,
  cloneRows,
  createVoiceRequest,
  deleteBody,
  editVoiceRequest,
  errorText,
  formForFile,
  formFromEntry,
  handoffOutcome,
  isVoiceAudioPath,
  jobCloneFailure,
  rpcCloneFailure,
  rpcErrorText,
  validateVoiceForm,
  voiceChips,
  voiceLanguageOptions,
  voiceMeta,
  voicePackageName,
  voiceConsentStatement,
  cloneAttemptKey,
  type CloneAttempt,
  type CloneProvider,
  type VoiceEntry,
} from './voices-library.ts';

const ELEVEN: CloneProvider = {
  providerId: 'elevenlabs',
  label: 'ElevenLabs',
  available: true,
  detail: null,
  requiresConsentClip: false,
  sourceSeconds: null,
};
const GEMINI: CloneProvider = {
  providerId: 'google',
  label: 'Google Gemini',
  available: true,
  detail: null,
  requiresConsentClip: true,
  sourceSeconds: { min: 10, max: 30 },
};

function summary(patch: Partial<LibraryEntrySummary> = {}): LibraryEntrySummary {
  return {
    library: 'voices',
    id: 'voc_1',
    version: 3,
    contentHash: 'sha256:c',
    name: '主播',
    kind: 'voice',
    updatedAt: '2026-10-03T08:00:00.000Z',
    consentDeclared: true,
    clones: [],
    ...patch,
  };
}

function entry(patch: Partial<VoiceEntry['content']> = {}): VoiceEntry {
  return {
    library: 'voices',
    id: 'voc_1',
    version: 3,
    contentHash: 'sha256:c',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-03T08:00:00.000Z',
    content: {
      name: '主播',
      language: 'zh-CN',
      transcript: '大家好，欢迎收看。',
      origin: 'imported',
      consent: { declared: true, declaredAt: '2026-10-01T00:00:00.000Z', statement: '我本人的声音（旧的说法）' },
      reference: { sha256: 'sha256:r', byteLength: 240 * 1024, mediaType: 'audio/wav', fileName: 'ref.wav' },
      ...patch,
    },
  };
}

function cloneJob(patch: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'voiceClone',
    state: 'running',
    providerId: 'elevenlabs',
    library: { entries: [{ library: 'voices', id: 'voc_1', version: 3, contentHash: 'sha256:c' }] },
    createdAt: '2026-10-03T08:00:00.000Z',
    error: null,
    ...patch,
  } as JobRecord;
}

describe('能克隆的 Provider', () => {
  it('只列登记了的、能克隆的；不可用时带 Runtime 的说明', () => {
    expect(cloneProviders(fixtureView())).toEqual([
      { providerId: 'elevenlabs', label: 'ElevenLabs', available: false, detail: '没有启用', requiresConsentClip: false, sourceSeconds: null },
    ]);
    expect(cloneProviders(null)).toEqual([]);
  });
});

describe('一只音色在各 Provider 上的克隆', () => {
  it('没有克隆、声明了、Provider 可用：可以上传', () => {
    const [row] = cloneRows(summary(), [ELEVEN], []);
    expect(row).toMatchObject({ providerId: 'elevenlabs', state: 'none', running: false, failure: null, create: { enabled: true, why: null }, removable: false });
  });

  it('没有本人声明：不能上传，说清楚为什么', () => {
    const [row] = cloneRows(summary({ consentDeclared: false }), [ELEVEN], []);
    expect(row!.create).toMatchObject({ enabled: false });
    expect(row!.create!.why).toContain('不上传到第三方');
  });

  it('要授权声明录音的 Provider：音色没有录音时不能上传，说去 ⋯ 里录', () => {
    const strict = { ...ELEVEN, providerId: 'strict', label: 'Strict', requiresConsentClip: true };
    const [row] = cloneRows(summary(), [strict], []);
    expect(row!.create).toMatchObject({ enabled: false });
    expect(row!.create!.why).toContain('授权声明');
    const [ok] = cloneRows(summary({ consentClip: true }), [strict], []);
    expect(ok!.create).toMatchObject({ enabled: true, why: null });
    expect(errorText('VOICE_CONSENT_CLIP_REQUIRED', '要录音', null)).toContain('⋯');
  });

  it('Provider 没启用：不能上传，带上 Runtime 的说明', () => {
    const [row] = cloneRows(summary(), [{ ...ELEVEN, available: false, detail: '没有设置密钥' }], []);
    expect(row!.create!.enabled).toBe(false);
    expect(row!.create!.why).toContain('没有设置密钥');
  });

  it('有效的克隆不再给上传；过期的可以重新上传，也可以删', () => {
    const [valid] = cloneRows(summary({ clones: [{ providerId: 'elevenlabs', state: 'valid' }] }), [ELEVEN], []);
    expect(valid).toMatchObject({ state: 'valid', create: null, removable: true });
    const [stale] = cloneRows(summary({ clones: [{ providerId: 'elevenlabs', state: 'stale' }] }), [ELEVEN], []);
    expect(stale).toMatchObject({ state: 'stale', create: { enabled: true }, removable: true });
  });

  it('在跑的克隆任务：不能再上传、也不能删；只认这只音色、这个 Provider 的任务', () => {
    const other = cloneJob({ jobId: 'job_x', library: { entries: [{ library: 'voices', id: 'voc_2', version: 1, contentHash: 'sha256:x' }] } });
    expect(cloneRows(summary(), [ELEVEN], [other])[0]!.running).toBe(false);
    const [row] = cloneRows(summary({ clones: [{ providerId: 'elevenlabs', state: 'stale' }] }), [ELEVEN], [cloneJob({})]);
    expect(row).toMatchObject({ running: true, removable: false, create: { enabled: false } });
  });

  it('最近一次失败、之后没建成：给原因与补救', () => {
    const failed = cloneJob({
      state: 'failed',
      error: { code: 'GRANT_REQUIRED', message: '把音频交给 ElevenLabs 需要用户授权', details: { remedy: { hint: '请在设置里发放授权' } } },
    } as Partial<JobRecord>);
    expect(cloneRows(summary(), [ELEVEN], [failed])[0]!.failure).toEqual({
      providerId: 'elevenlabs',
      label: 'ElevenLabs',
      code: 'GRANT_REQUIRED',
      reason: null,
      status: null,
      message: '把音频交给 ElevenLabs 需要用户授权',
      remedy: '请在设置里发放授权',
      sourceSeconds: null,
      hasConsentClip: false,
    });
    // 已经有有效克隆时不提旧的失败。
    expect(cloneRows(summary({ clones: [{ providerId: 'elevenlabs', state: 'valid' }] }), [ELEVEN], [failed])[0]!.failure).toBeNull();
  });

  it('任务失败带着 Provider 拒绝的原因与 HTTP 状态；这家收的时长与有没有授权声明录音一起交给诊断', () => {
    const failed = cloneJob({
      providerId: 'google',
      state: 'failed',
      error: { code: 'PROVIDER_REJECTED', message: 'speaker mismatch', details: { providerId: 'google', status: 400, reason: 'speaker-mismatch' } },
    } as Partial<JobRecord>);
    expect(cloneRows(summary({ consentClip: true }), [GEMINI], [failed])[0]!.failure).toMatchObject({
      code: 'PROVIDER_REJECTED',
      reason: 'speaker-mismatch',
      status: 400,
      message: 'speaker mismatch',
      sourceSeconds: { min: 10, max: 30 },
      hasConsentClip: true,
    });
  });

  describe('这次运行里界面发起的上传', () => {
    const now = Date.parse('2026-10-03T08:10:00.000Z');
    const key = cloneAttemptKey('voc_1', 'elevenlabs');
    const submitted = (at: number): Record<string, CloneAttempt> => ({ [key]: { kind: 'submitted', jobId: 'job_new', at } });

    it('拿到任务 ID、任务还没送回来：当作在跑，最多 30 秒', () => {
      expect(cloneRows(summary(), [ELEVEN], [], submitted(now - 1000), now)[0]).toMatchObject({ running: true, removable: false, failure: null });
      expect(cloneRows(summary(), [ELEVEN], [], submitted(now - 30_000), now)[0]!.running).toBe(false);
    });

    it('任务送回来之后看任务本身', () => {
      const done = cloneJob({ jobId: 'job_new', state: 'completed', createdAt: '2026-10-03T08:09:59.000Z' });
      expect(cloneRows(summary(), [ELEVEN], [done], submitted(now - 1000), now)[0]!.running).toBe(false);
    });

    it('提交时就被拒：比这家最近一次任务新时当作这次的失败，错误码在 details.code', () => {
      const error = Object.assign(new Error('没有覆盖音频的授权'), { details: { code: 'GRANT_REQUIRED', remedy: { hint: '去隐私与权限' } } });
      const rejected = { [key]: { kind: 'rejected', error, at: now } } as Record<string, CloneAttempt>;
      const older = cloneJob({ state: 'failed', error: { code: 'PROVIDER_UNAVAILABLE', message: '旧的失败' } } as Partial<JobRecord>);
      expect(cloneRows(summary(), [ELEVEN], [older], rejected, now)[0]!.failure).toMatchObject({
        code: 'GRANT_REQUIRED',
        message: '没有覆盖音频的授权',
        remedy: '去隐私与权限',
      });
      // 被拒之后又建了任务：看任务。
      const newer = cloneJob({ createdAt: '2026-10-03T08:11:00.000Z', state: 'failed', error: { code: 'PROVIDER_UNAVAILABLE', message: '新的失败' } } as Partial<JobRecord>);
      expect(cloneRows(summary(), [ELEVEN], [newer], rejected, now)[0]!.failure).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: '新的失败' });
    });
  });

  it('条目里记着、这个 Runtime 却不登记的 Provider 也列出来，好让人删', () => {
    const rows = cloneRows(summary({ clones: [{ providerId: 'minimax', state: 'valid' }] }), [ELEVEN], []);
    expect(rows.map((r) => r.providerId)).toEqual(['elevenlabs', 'minimax']);
    expect(rows[1]).toMatchObject({ label: 'minimax', removable: true, create: null });
  });
});

describe('诊断用的事实', () => {
  const context = { providerId: 'google', label: 'Google Gemini', sourceSeconds: { min: 10, max: 30 }, hasConsentClip: false };

  it('任务的错误：原因与状态只认对的类型', () => {
    expect(
      jobCloneFailure({ code: 'PROVIDER_REJECTED', message: 'nope', details: { reason: 'voice-limit', status: 429 } } as NonNullable<JobRecord['error']>, context),
    ).toMatchObject({ code: 'PROVIDER_REJECTED', reason: 'voice-limit', status: 429, message: 'nope', remedy: null });
    expect(
      jobCloneFailure({ code: 'PROVIDER_REJECTED', message: 'x', details: { reason: 3, status: '400' } } as unknown as NonNullable<JobRecord['error']>, context),
    ).toMatchObject({ reason: null, status: null });
  });

  it('提交时的拒绝：不是 Error 也照样写成一句', () => {
    expect(rpcCloneFailure('boom', context)).toMatchObject({ code: null, reason: null, status: null, message: 'boom' });
    expect(rpcCloneFailure(Object.assign(new Error('没有声明'), { details: { code: 'VOICE_CONSENT_REQUIRED' } }), context)).toMatchObject({
      code: 'VOICE_CONSENT_REQUIRED',
      message: '没有声明',
    });
  });
});

describe('从模型页过来、存好之后的回程条', () => {
  const row = (patch: Partial<ReturnType<typeof cloneRows>[number]>) => ({
    ...cloneRows(summary(), [ELEVEN], [])[0]!,
    ...patch,
  });

  it('不是从云端过来：只说存好了', () => {
    expect(handoffOutcome(undefined, [])).toBe('saved');
    expect(handoffOutcome({ kind: 'local', id: 'indextts2' }, [row({})])).toBe('saved');
  });

  it('云端那家：在传、建好、没建成、这次没传', () => {
    const target = { kind: 'cloud' as const, id: 'elevenlabs' };
    expect(handoffOutcome(target, [row({ running: true })])).toBe('uploading');
    expect(handoffOutcome(target, [row({ state: 'valid' })])).toBe('ready');
    const failure = rpcCloneFailure('x', { providerId: 'elevenlabs', label: 'ElevenLabs', sourceSeconds: null, hasConsentClip: false });
    expect(handoffOutcome(target, [row({ failure })])).toBe('failed');
    expect(handoffOutcome(target, [row({})])).toBe('not-uploaded');
    expect(handoffOutcome({ kind: 'cloud', id: 'google' }, [row({})])).toBe('not-uploaded');
  });
});

describe('一行的显示', () => {
  it('标签：未说明是否本人，各家克隆的状态', () => {
    expect(voiceChips(summary({ consentDeclared: false, clones: [{ providerId: 'elevenlabs', state: 'stale' }] }), [ELEVEN])).toEqual([
      { label: '未说明是否本人', tone: 'neutral' },
      { label: 'ElevenLabs 克隆已过期', tone: 'notice' },
    ]);
    expect(voiceChips(summary({ clones: [{ providerId: 'elevenlabs', state: 'valid' }] }), [ELEVEN])).toEqual([{ label: 'ElevenLabs 已克隆', tone: 'positive' }]);
  });

  it('说明行：语言、格式与大小、来源、什么时候改的', () => {
    const now = Date.parse('2026-10-03T08:05:00.000Z');
    expect(voiceMeta(entry(), now)).toBe('中文（中国） · WAV 240 KB · 从文件导入 · 5 分钟前改过');
    expect(voiceMeta(entry({ language: null, origin: 'recorded' }), now)).toMatch(/^语言未注明 · WAV 240 KB · 在应用里录的/);
  });
});

describe('新建与编辑', () => {
  it('从文件新建：名字先用文件名，声明默认不勾', () => {
    expect(formForFile('/Users/me/录音/主播 参考.wav')).toEqual({ name: '主播 参考', language: '', transcript: '', consent: false });
  });

  it('校验：名字必填、最多 200 字；逐字稿最多 10000 字', () => {
    expect(validateVoiceForm({ name: '  ', language: '', transcript: '', consent: false }).name).toBe('给音色起个名字');
    expect(validateVoiceForm({ name: '名'.repeat(201), language: '', transcript: '', consent: false }).name).toContain('200');
    expect(validateVoiceForm({ name: '好', language: '', transcript: '字'.repeat(10_001), consent: false }).transcript).toContain('10000');
    expect(validateVoiceForm({ name: '好', language: '', transcript: '', consent: true })).toEqual({ name: null, transcript: null });
  });

  it('新建请求：带文件路径，来源 imported；勾了声明用固定的一句，不知道语言给 null', () => {
    expect(createVoiceRequest({ name: ' 主播 ', language: '', transcript: ' 你好 ', consent: true }, '/a/ref.wav')).toEqual({
      library: 'voices',
      content: { name: '主播', language: null, transcript: '你好', origin: 'imported', consent: { declared: true, statement: voiceConsentStatement() } },
      source: { path: '/a/ref.wav' },
    });
  });

  it('编辑请求：不带文件、带版本号；声明还勾着时沿用原话（Runtime 才保留原来的声明时间）', () => {
    const e = entry();
    const request = editVoiceRequest({ ...formFromEntry(e), name: '新名字' }, e);
    expect(request).toEqual({
      library: 'voices',
      id: 'voc_1',
      expectedVersion: 3,
      content: {
        name: '新名字',
        language: 'zh-CN',
        transcript: '大家好，欢迎收看。',
        origin: 'imported',
        consent: { declared: true, statement: '我本人的声音（旧的说法）' },
      },
    });
    expect(request).not.toHaveProperty('source');
    expect(editVoiceRequest({ ...formFromEntry(e), consent: false }, e).content).toMatchObject({ consent: { declared: false, statement: null } });
  });

  it('语言下拉：不知道 + 常用；条目里的语言不在常用里也列出来', () => {
    const keys = voiceLanguageOptions('').map((o) => o.key);
    expect(keys[0]).toBe('');
    expect(keys).toContain('zh');
    expect(voiceLanguageOptions('zh-CN').map((o) => o.key)).toContain('zh-CN');
  });

  it('选文件的粗筛与导出的默认文件名', () => {
    expect(isVoiceAudioPath('/a/b.WAV')).toBe(true);
    expect(isVoiceAudioPath('/a/b.m4a')).toBe(false);
    expect(voicePackageName('主播/旁白: 第 1 版')).toBe('主播 旁白 第 1 版.bcvoice');
    expect(voicePackageName('...')).toBe('voice.bcvoice');
  });
});

describe('删除与错误', () => {
  it('删除确认：有克隆时说会先删克隆、删不掉不删音色', () => {
    expect(deleteBody(summary(), [ELEVEN])).toBe('用了它的视频下次生成时会退回默认音色；已经生成的配音不受影响。');
    expect(deleteBody(summary({ clones: [{ providerId: 'elevenlabs', state: 'stale' }] }), [ELEVEN])).toContain('会先删掉 ElevenLabs 上的克隆');
  });

  it('错误码补一句怎么办；认不得的用 Runtime 给的 remedy', () => {
    expect(errorText('VOICE_CONSENT_REQUIRED', '音色没有授权声明', null)).toContain('勾上声明');
    expect(errorText('CAPABILITY_NOT_CONFIGURED', 'ElevenLabs 没有启用', null)).toContain('API 提供方');
    expect(errorText('SOMETHING', '出错了', { remedy: '换一个文件' })).toBe('出错了。换一个文件');
    expect(rpcErrorText(Object.assign(new Error('版本对不上'), { details: { code: 'LIBRARY_VERSION_CONFLICT' } }))).toContain('换成最新的内容');
  });
});
