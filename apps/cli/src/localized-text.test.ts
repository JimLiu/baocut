import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defineCatalog,
  partialTranslations,
  refOf,
  setLocale,
  type FontFamilyStatus,
  type Grant,
  type GrantRevokeResult,
  type JobRecord,
  type ModelBundleStatus,
  type PendingApproval,
  type ResourcesSnapshot,
} from '@baocut/protocol';
import { ModelsModelCatalog } from '@baocut/protocol/messages/models/model-catalog.ts';
import { formatFontFamilies } from './admin/fonts-output.ts';
import { formatApprovalGrants, formatGrants, formatRevoke } from './admin/grants-output.ts';
import { formatReconcileResult, formatResources } from './admin/jobs-output.ts';
import { formatBundleLines, installFailureLines } from './admin/models-output.ts';
import { renderError } from './envelope.ts';

// 一个只给测试用的目录：Runtime 在中文下写成的文字带着引用，CLI 在英文下按引用重新生成。
const R = defineCatalog(
  'cliRefTest',
  {
    noSpace: 'Free up some disk space, then try again',
    grantHint: (p: { recipient: string }) => `Grant ${p.recipient} access to the transcript`,
    defaultPurpose: (p: { provider: string }) => `Default grant for ${p.provider}`,
    stale: 'The video changed after the job started',
    queued: (p: { ahead: number }) => `Waiting for ${p.ahead} task(s) ahead`,
    purpose: 'Tool "Text to speech"',
    revokeNote: 'Data already sent cannot be recalled',
    networkFailed: 'Could not reach Google Fonts',
  },
  partialTranslations({
    'zh-Hans': {
      noSpace: '先腾出磁盘空间再试',
      grantHint: (p: { recipient: string }) => `给 ${p.recipient} 发放转写稿的授权`,
      defaultPurpose: (p: { provider: string }) => `${p.provider} 的默认授权`,
      stale: '任务开始后视频改了',
      queued: (p: { ahead: number }) => `前面还有 ${p.ahead} 个任务`,
      purpose: '工具「语音合成」',
      revokeNote: '已经交出的数据无法收回',
      networkFailed: '连不上 Google Fonts',
    },
  }),
);

function english(): void {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
}

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('CLI shows stored Runtime text in its own language', () => {
  it('remedies: plain strings with remedyRef, and grant hints with hintRef', () => {
    const remedy = R.noSpace();
    const hint = R.grantHint({ recipient: 'openai' });
    const plain = { remedy: remedy.text, remedyRef: refOf(remedy) };
    const grant = { remedy: { hint: hint.text, hintRef: refOf(hint), commands: ['baocut grants create --recipient openai'] } };
    // 失败的信封把错误 details 摊在顶层（cli.ts），补救与它的引用跟着上来。
    const lines = (details: object) => renderError({ code: 'X', message: 'm', ...details }).split('\n');
    english();
    expect(lines(plain)[1]).toBe('  Free up some disk space, then try again');
    expect(lines(plain).join('\n')).not.toContain('remedyRef');
    expect(lines(grant)[1]).toBe('  Grant openai access to the transcript');
    expect(lines(grant)[2]).toBe('    baocut grants create --recipient openai');
    expect(installFailureLines({ code: 'MODEL_INSTALL_FAILED', message: 'x', details: plain })).toEqual([
      expect.stringContaining('Free up some disk space, then try again'),
    ]);
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(lines(plain)[1]).toBe('  先腾出磁盘空间再试');
    expect(lines({ remedy: '没有引用的原话' })[1]).toBe('  没有引用的原话');
  });

  it('grant purposes written by the Runtime', () => {
    const purpose = R.defaultPurpose({ provider: 'OpenAI' });
    const grant = {
      grantId: 'grt_1',
      dataKinds: ['audio'],
      recipient: 'openai',
      scope: { videoId: null },
      purpose: purpose.text,
      purposeRef: refOf(purpose),
      budgetMode: 'per-call-unknown-cost',
      budgetCap: null,
      maxCalls: null,
      expiresAt: null,
      generation: 1,
      taskId: null,
      once: false,
      origin: 'provider-enable',
      approvalId: null,
      state: 'active',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      revokedAt: null,
      usage: { calls: 0, reservedCalls: 0, amount: null, reservedAmount: null, unknownCostCalls: 0 },
    } as unknown as Grant;
    english();
    expect(formatGrants([grant])[0]).toContain('Default grant for OpenAI');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(formatGrants([grant])[0]).toContain('OpenAI 的默认授权');
  });

  it('the reason an application was not committed', () => {
    const stale = R.stale();
    const job = {
      jobId: 'job_1',
      state: 'needs-reconciliation',
      attempt: 1,
      error: null,
      cancellation: null,
      applications: [{ state: 'rejected', videoId: 'vid_1', receipt: null, error: { code: 'STALE_JOB_INPUT', message: stale.text, messageRef: refOf(stale) } }],
    } as unknown as JobRecord;
    english();
    expect(formatReconcileResult('apply', job).join('\n')).toContain('The video changed after the job started');
  });
});

describe('CLI shows model details, queued waits, grant purposes and font errors in its own language', () => {
  function back(): void {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  }

  it('a model bundle without a manifest', () => {
    const missing = ModelsModelCatalog.noManifest({ repo: 'mlx-community/vad' });
    const bundle = {
      bundleId: 'vad',
      capability: 'transcribe',
      backend: 'mlx',
      device: 'metal',
      state: 'not-installed',
      reason: 'missing-manifest',
      detail: missing.text,
      detailRef: refOf(missing),
    } as ModelBundleStatus;
    english();
    expect(formatBundleLines(bundle)[0]).toContain('— mlx-community/vad has no manifest');
    back();
    expect(formatBundleLines(bundle)[0]).toContain('— mlx-community/vad 没有清单');
  });

  it('what a queued job waits for', () => {
    const wait = R.queued({ ahead: 2 });
    const none = { memory: 0, gpuMemory: null, cpuThreads: 0, scratchDisk: null };
    const snapshot = {
      capacity: {
        ...none,
        unifiedMemory: true,
        sources: { memory: 'system', gpuMemory: 'unknown', cpuThreads: 'system', scratchDisk: 'unknown' },
      },
      reserves: { system: none, interactive: none },
      leased: none,
      available: { interactive: none, background: none },
      leases: [],
      holders: [],
      waiting: [
        {
          owner: 'job_1',
          label: 'transcribe',
          priority: 'background',
          demand: {},
          holder: null,
          queue: null,
          wait: { reason: 'concurrency', ahead: 2, detail: wait.text, detailRef: refOf(wait), since: '' },
        },
      ],
    } as unknown as ResourcesSnapshot;
    english();
    expect(formatResources(snapshot).at(-1)).toContain('Waiting for 2 task(s) ahead');
    back();
    expect(formatResources(snapshot).at(-1)).toContain('前面还有 2 个任务');
  });

  it('approval purposes and the revoke note', () => {
    const purpose = R.purpose();
    const note = R.revokeNote();
    const approval = {
      grants: [
        {
          capability: 'synthesizeSpeech',
          dataKinds: ['text'],
          recipient: 'openai',
          videoId: null,
          purpose: purpose.text,
          purposeRef: refOf(purpose),
          reason: 'none',
          cost: 'unknown',
          estimate: null,
          maxCalls: null,
        },
      ],
    } as unknown as PendingApproval;
    const revoked = {
      grant: { grantId: 'grant_1', recipient: 'openai', dataKinds: ['text'] },
      alreadySent: { calls: 0, amount: null, unknownCostCalls: 0 },
      runningJobs: [],
      note: note.text,
      noteRef: refOf(note),
    } as unknown as GrantRevokeResult;
    english();
    expect(formatApprovalGrants(approval)[0]).toContain('Tool "Text to speech"');
    expect(formatRevoke(revoked).at(-1)).toBe('Data already sent cannot be recalled');
    back();
    expect(formatApprovalGrants(approval)[0]).toContain('工具「语音合成」');
    expect(formatRevoke(revoked).at(-1)).toBe('已经交出的数据无法收回');
  });

  it('why a font download failed', () => {
    const failed = R.networkFailed();
    const family = {
      family: 'Noto Sans',
      state: 'failed',
      category: null,
      scripts: [],
      licence: null,
      downloaded: [],
      job: null,
      error: { code: 'FONT_DOWNLOAD_NETWORK', message: failed.text, messageRef: refOf(failed), at: '' },
    } as unknown as FontFamilyStatus;
    english();
    expect(formatFontFamilies([family], 1)[0]).toContain('Could not reach Google Fonts');
    back();
    expect(formatFontFamilies([family], 1)[0]).toContain('连不上 Google Fonts');
  });
});
