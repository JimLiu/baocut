import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defineCatalog,
  localizeToolStatus,
  partialTranslations,
  pipelineStepLabel,
  refOf,
  setLocale,
  type DriverInfo,
  type ExternalToolStatus,
  type FontFamilyStatus,
  type GrantRequestItem,
  type JobRecord,
  type MessageRef,
  type ModelBundleStatus,
  type ModelCapabilitiesView,
} from '@baocut/protocol';
import { ModelsModelCatalog } from '@baocut/protocol/messages/models/model-catalog.ts';
import { agentProblem, installPlan } from '../components/settings/agent-setup.ts';
import { dubWarnings } from './dub-progress.ts';
import { exportPhaseLabel } from './export-job.ts';
import { liveRow, rowEnd } from './font-library.ts';
import { bundleFacts } from './models-local.ts';
import { cloudProviders } from './models-cloud.ts';
import { grantLine } from './services-mcp.ts';
import { cloudModelOptions } from './tools-models.ts';
import { grantLines } from './tool-runs.ts';
import { queuedDetail } from './tools-records.ts';
import { linkIssue } from './link-import.ts';
import { jobErrorText, jobWaitText, remedyHintText, remedyText } from './localized-text.ts';
import { jobRemedy } from './task-facts.ts';
import { problemText } from './tools-gallery.ts';

// 一个只给测试用的目录：引用存下之后按读者的语言重新生成。
const R = defineCatalog(
  'uiRefTest',
  {
    loadFailed: (p: { name: string }) => `Could not load ${p.name}`,
    freeSpace: 'Free up some disk space, then try again',
    grantHint: 'Grant access to send the transcript',
    crashed: 'The agent CLI crashed',
    viaBrew: 'Homebrew',
    needsNode: 'Node.js 18 or later',
    trimmed: 'Some lines were trimmed',
    notOn: 'Not turned on',
    queued: (p: { ahead: number }) => `Waiting for ${p.ahead} task(s) ahead`,
    purpose: 'Tool "Text to speech"',
    networkFailed: 'Could not reach Google Fonts',
  },
  partialTranslations({
    'zh-Hans': {
      loadFailed: (p: { name: string }) => `无法加载 ${p.name}`,
      freeSpace: '先腾出磁盘空间再试',
      grantHint: '授权外发转写稿',
      crashed: '智能体命令行崩溃了',
      viaBrew: 'Homebrew 安装',
      needsNode: 'Node.js 18 或更新',
      trimmed: '有几行被截掉了',
      notOn: '没有启用',
      queued: (p: { ahead: number }) => `前面还有 ${p.ahead} 个任务`,
      purpose: '工具「语音合成」',
      networkFailed: '连不上 Google Fonts',
    },
  }),
);

/** 在中文下写成（存下的是中文原话），再切到英文读。 */
function stored(make: () => { text: string } & MessageRef): { text: string; ref: MessageRef } {
  const message = make();
  return { text: message.text, ref: refOf(message) };
}

function english(): void {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
}

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('stored Runtime text follows the reader language', () => {
  it('job errors and remedies', () => {
    const error = stored(() => R.loadFailed({ name: 'whisper' }));
    const remedy = stored(() => R.freeSpace());
    const hint = stored(() => R.grantHint());
    expect(error.text).toBe('无法加载 whisper');
    english();
    expect(jobErrorText({ message: error.text, messageRef: error.ref })).toBe('Could not load whisper');
    expect(jobErrorText({ message: 'third-party words' })).toBe('third-party words');
    expect(remedyText({ remedy: remedy.text, remedyRef: remedy.ref })).toBe('Free up some disk space, then try again');
    expect(remedyText({ remedy: remedy.text, remedyRef: 'not a ref' })).toBe('先腾出磁盘空间再试');
    expect(remedyHintText({ hint: hint.text, hintRef: hint.ref })).toBe('Grant access to send the transcript');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(jobErrorText({ message: error.text, messageRef: error.ref })).toBe('无法加载 whisper');
  });

  it('a link import that failed with an unknown code shows the localized reason and remedy', () => {
    const error = stored(() => R.loadFailed({ name: 'yt-dlp' }));
    const remedy = stored(() => R.freeSpace());
    const job = { code: 'SOMETHING_NEW', message: error.text, messageRef: error.ref, details: { remedy: remedy.text, remedyRef: remedy.ref } };
    english();
    const body = linkIssue(job, 'failed')!.body;
    expect(body).toContain('Could not load yt-dlp');
    expect(body).toContain('Free up some disk space, then try again');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(linkIssue(job, 'failed')!.body).toContain('无法加载 yt-dlp');
  });

  it('the remedy hint of a capability that is not configured', () => {
    const hint = stored(() => R.grantHint());
    const job = {
      kind: 'transcribe',
      providerId: 'local',
      error: {
        code: 'CAPABILITY_NOT_CONFIGURED',
        message: 'x',
        details: {
          code: 'CAPABILITY_NOT_CONFIGURED',
          capability: 'transcribe',
          reason: 'no-provider',
          remedy: { action: 'install-model', capability: 'transcribe', hint: hint.text, hintRef: hint.ref },
        },
      },
    } as unknown as Pick<JobRecord, 'kind' | 'providerId' | 'error'>;
    english();
    expect(jobRemedy(job)?.hint).toBe('Grant access to send the transcript');
  });

  it('job warnings', () => {
    const detail = stored(() => R.trimmed());
    const job = { warnings: [{ code: 'output-truncated', detail: detail.text, detailRef: detail.ref }] } as Pick<JobRecord, 'warnings'>;
    english();
    expect(dubWarnings(job)[0]!.detail).toBe('Some lines were trimmed');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(dubWarnings(job)[0]!.detail).toBe('有几行被截掉了');
  });

  it('agent probe details and install options', () => {
    const detail = stored(() => R.crashed());
    const label = stored(() => R.viaBrew());
    const needs = stored(() => R.needsNode());
    const driver = {
      id: 'codex',
      name: 'Codex',
      command: 'codex',
      state: 'error',
      version: '1.0.0',
      minVersion: '0.1.0',
      latestVersion: null,
      detail: detail.text,
      detailRef: detail.ref,
      loginCommand: null,
      executable: '/opt/homebrew/bin/codex',
      realExecutable: '/opt/homebrew/Cellar/codex/1.0.0/bin/codex',
      install: [
        { kind: 'brew', label: label.text, labelRef: label.ref, needs: needs.text, needsRef: needs.ref, command: 'brew install codex', upgrade: 'brew upgrade codex' },
      ],
    } as unknown as DriverInfo;
    english();
    expect(agentProblem(driver)?.body).toContain('The agent CLI crashed');
    expect(installPlan(driver).choices[0]).toMatchObject({ label: 'Homebrew', needs: 'Node.js 18 or later' });
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(agentProblem(driver)?.body).toContain('智能体命令行崩溃了');
    expect(installPlan(driver).choices[0]).toMatchObject({ label: 'Homebrew 安装', needs: 'Node.js 18 或更新' });
  });

  it('tool problems, external tool status and pipeline step names', () => {
    const reason = stored(() => R.loadFailed({ name: 'ffmpeg' }));
    const remedy = stored(() => R.freeSpace());
    const step = stored(() => R.trimmed());
    const problem = { code: 'TOOL_NOT_INSTALLED', message: reason.text, messageRef: reason.ref, remedy: remedy.text, remedyRef: remedy.ref };
    const status = {
      name: 'ffmpeg',
      purpose: step.text,
      purposeRef: step.ref,
      reason: reason.text,
      reasonRef: reason.ref,
      remedy: remedy.text,
      remedyRef: remedy.ref,
      offer: { blockedReason: reason.text, blockedReasonRef: reason.ref },
      update: null,
    } as unknown as ExternalToolStatus;
    english();
    expect(problemText(problem)).toBe('Could not load ffmpeg');
    expect(problemText(problem, true)).toContain('Free up some disk space, then try again');
    expect(localizeToolStatus(status)).toMatchObject({
      purpose: 'Some lines were trimmed',
      reason: 'Could not load ffmpeg',
      remedy: 'Free up some disk space, then try again',
      offer: { blockedReason: 'Could not load ffmpeg' },
    });
    expect(pipelineStepLabel({ label: step.text, labelRef: step.ref })).toBe('Some lines were trimmed');
    expect(pipelineStepLabel({ label: 'Probe' })).toBe('Probe');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(problemText(problem, true)).toContain('先腾出磁盘空间再试');
    expect(localizeToolStatus(status).reason).toBe('无法加载 ffmpeg');
  });
});

describe('model details, queued waits, grant purposes and font errors follow the reader language', () => {
  function back(): void {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  }

  it('a bundle without a manifest and unavailable cloud providers and models', () => {
    const missing = stored(() => ModelsModelCatalog.noManifest({ repo: 'mlx-community/vad' }));
    const bundle = { capability: 'transcribe', backend: 'mlx', device: 'metal', detail: missing.text, detailRef: missing.ref } as ModelBundleStatus;
    const off = stored(() => R.notOn());
    const provider = {
      providerId: 'openai',
      kind: 'online',
      label: 'OpenAI',
      config: { enabled: true, credential: 'set' },
      models: [{ modelId: 'whisper-1', label: 'Whisper', available: false, detail: off.text, detailRef: off.ref }],
      available: true,
    };
    const view = {
      transcribe: { providers: [provider] },
      synthesizeSpeech: { providers: [] },
      generateImage: { providers: [] },
      generateText: { providers: [{ ...provider, models: [], available: false, detail: off.text, detailRef: off.ref }] },
    } as unknown as ModelCapabilitiesView;
    english();
    expect(bundleFacts(bundle)).toContain('mlx-community/vad has no manifest');
    expect(cloudProviders(view, 'generateText')[0]!.detail).toBe('Not turned on');
    expect(cloudModelOptions(view, 'transcribe', true)[0]!.why).toBe('Not turned on');
    back();
    expect(bundleFacts(bundle)).toContain('mlx-community/vad 没有清单');
    expect(cloudProviders(view, 'generateText')[0]!.detail).toBe('没有启用');
  });

  it('what a queued job waits for', () => {
    const wait = stored(() => R.queued({ ahead: 2 }));
    const job = { state: 'queued', phase: 'queued', wait: { reason: 'concurrency', ahead: 2, detail: wait.text, detailRef: wait.ref, since: '' } } as unknown as JobRecord;
    english();
    expect(jobWaitText(job.wait)).toBe('Waiting for 2 task(s) ahead');
    expect(queuedDetail(job)).toBe('Waiting for 2 task(s) ahead');
    expect(exportPhaseLabel(job)).toBe('Waiting for 2 task(s) ahead');
    expect(jobWaitText(null)).toBeNull();
    back();
    expect(queuedDetail(job)).toBe('前面还有 2 个任务');
  });

  it('the purpose of an outbound transfer waiting for approval', () => {
    const purpose = stored(() => R.purpose());
    const item = {
      capability: 'synthesizeSpeech',
      dataKinds: ['transcript'],
      recipient: 'openai',
      videoId: null,
      purpose: purpose.text,
      purposeRef: purpose.ref,
      reason: 'none',
      cost: 'unknown',
      estimate: null,
      maxCalls: null,
    } as GrantRequestItem;
    english();
    expect(grantLine(item)).toContain('Tool "Text to speech"');
    expect(grantLines([item], new Map())[0]!.what).toContain('Tool "Text to speech"');
    back();
    expect(grantLine(item)).toContain('工具「语音合成」');
  });

  it('why a font download failed', () => {
    const failed = stored(() => R.networkFailed());
    const status = {
      family: 'Noto Sans',
      state: 'failed',
      downloaded: [],
      job: null,
      error: { code: 'FONT_DOWNLOAD_NETWORK', message: failed.text, messageRef: failed.ref, at: '' },
    } as unknown as FontFamilyStatus;
    english();
    expect(rowEnd(liveRow(status, undefined))).toMatchObject({ kind: 'retry', message: 'Could not reach Google Fonts' });
    back();
    expect(rowEnd(liveRow(status, undefined))).toMatchObject({ kind: 'retry', message: '连不上 Google Fonts' });
  });
});
