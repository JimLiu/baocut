import { describe, expect, it } from 'vitest';
import { RpcError, type JobRecord, type ModelComponentStatus, type ModelInstallPlan } from '@baocut/protocol';
import {
  bundleActions,
  installFailure,
  installPlanView,
  installProgressView,
  modelProblem,
  removalBody,
  removalEstimate,
  removedToast,
  rpcProblem,
} from './models-install.ts';
import { isBundleInstalled, localGroups } from './models-local.ts';
import { bundle } from './models-test-fixtures.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const QWEN = 'qwen3-asr-0.6b@mlx-4bit';

function plan(patch: Partial<ModelInstallPlan> = {}): ModelInstallPlan {
  return {
    bundleId: QWEN,
    components: [
      { component: 'asr', repo: 'Qwen/Qwen3-ASR-0.6B', revision: 'abc', action: 'download', files: ['a', 'b'], bytes: 1.2 * GB },
      { component: 'vad', repo: 'silero/vad', revision: 'def', action: 'keep', files: [], bytes: null },
    ],
    downloadBytes: 1.2 * GB,
    estimatedBytes: 1.2 * GB,
    confirmBytes: 1.2 * GB,
    resumedBytes: 0,
    availableBytes: 20 * GB,
    source: 'https://huggingface.co',
    upToDate: false,
    ...patch,
  };
}

function component(repo: string, patch: Partial<ModelComponentStatus> = {}): ModelComponentStatus {
  return { component: 'asr', repo, revision: 'r', state: 'installed', bytes: 100 * MB, sharedWith: [], ...patch };
}

function job(patch: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'modelInstall',
    state: 'failed',
    phase: 'downloading',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:0',
    providerId: 'local',
    modelId: QWEN,
    bundleId: QWEN,
    inputHash: 'sha256:0',
    submitter: { kind: 'app' },
    attempt: 1,
    createdAt: '2026-10-03T10:00:00.000Z',
    updatedAt: '2026-10-03T10:00:00.000Z',
    startedAt: null,
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

describe('确认对话框', () => {
  it('确切大小、可用空间、来源与各组件', () => {
    const view = installPlanView(plan());
    expect(view.size).toBe('要下载 1.2 GB');
    expect(view.amount).toBe('1.2 GB');
    expect(view.space).toBe('磁盘可用 20.0 GB');
    expect(view.noSpace).toBeNull();
    expect(view.resumed).toBeNull();
    expect(view.source).toBe('https://huggingface.co');
    expect(view.lines.map((l) => l.value)).toEqual(['1.2 GB · 2 个文件', '已装好，不动']);
  });

  it('大小未知时写明是估计；有续传的部分说出来', () => {
    const view = installPlanView(plan({ downloadBytes: null, resumedBytes: 300 * MB }));
    expect(view.size).toBe('约 1.2 GB（有文件大小未知，按登记的估计）');
    expect(view.amount).toBe('约 1.2 GB');
    expect(view.resumed).toBe('上次已经下载的 300 MB 接着用，不再重下。');
  });

  it('磁盘不够：先说清楚，不让确认', () => {
    const view = installPlanView(plan({ availableBytes: 500 * MB }));
    expect(view.noSpace).toBe('磁盘空间不够：这次要 1.2 GB，模型目录所在的磁盘只剩 500 MB。先清理出空间再下载。');
  });

  it('查不到可用空间时不编', () => {
    const view = installPlanView(plan({ availableBytes: null }));
    expect(view.space).toBeNull();
    expect(view.noSpace).toBeNull();
  });
});

describe('进度', () => {
  it('知道总数时给百分比；不知道时不伪造', () => {
    expect(installProgressView({ jobId: 'j', state: 'downloading', receivedBytes: 300 * MB, totalBytes: 1200 * MB })).toEqual({
      state: 'downloading',
      label: '正在下载 300 MB / 1.2 GB',
      percent: 25,
      running: true,
    });
    const unknown = installProgressView({ jobId: 'j', state: 'downloading', receivedBytes: 300 * MB, totalBytes: null });
    expect(unknown.percent).toBeNull();
    expect(unknown.label).toBe('正在下载 · 已收到 300 MB');
  });

  it('排队、校验时进度条不确定；暂停时可以继续', () => {
    expect(installProgressView({ jobId: 'j', state: 'queued', receivedBytes: 0, totalBytes: 10 })).toMatchObject({ percent: null, running: true });
    expect(installProgressView({ jobId: 'j', state: 'verifying', receivedBytes: 10, totalBytes: 10 })).toMatchObject({ percent: null, running: true });
    expect(installProgressView({ jobId: null, state: 'paused', receivedBytes: 300 * MB, totalBytes: 1200 * MB })).toEqual({
      state: 'paused',
      label: '已暂停 · 留着 300 MB / 1.2 GB，继续时接着下',
      percent: 25,
      running: false,
    });
  });
});

describe('失败与补救', () => {
  it('磁盘满：带上要多少、剩多少，说已下载的会留着', () => {
    const problem = modelProblem('MODEL_DOWNLOAD_NO_SPACE', '模型目录所在的磁盘空间不足', { requiredBytes: 2 * GB, availableBytes: 1 * GB });
    expect(problem.remedy).toBe('这次要 2.0 GB，只剩 1.0 GB。清理出磁盘空间后再下载；已经下载的部分会留着，下次接着下。');
  });

  it('RPC 拒绝按 details.code 认；认不得的用 Runtime 给的 remedy，再没有就只有原话', () => {
    expect(rpcProblem(new RpcError('conflict', '严格离线模式下不下载模型', { code: 'OFFLINE_STRICT' })).remedy).toMatch(/严格离线/);
    expect(rpcProblem(new RpcError('conflict', '奇怪', { code: 'X', remedy: '这样办' }))).toEqual({ message: '奇怪', remedy: '这样办' });
    expect(rpcProblem(new Error('断了'))).toEqual({ message: '断了', remedy: null });
  });

  it('安装任务失败、现在没在装时给出原因；取消的不算', () => {
    const failed = job({ error: { code: 'MODEL_DOWNLOAD_NETWORK', message: '下载 a 失败：timeout' } });
    const idle = bundle(QWEN, { state: 'not-installed' });
    expect(installFailure(idle, [failed])?.message).toBe('下载 a 失败：timeout');
    expect(installFailure(idle, [job({ state: 'cancelled' })])).toBeNull();
    const again = bundle(QWEN, { state: 'downloading', install: { jobId: 'job_2', state: 'downloading', receivedBytes: 1, totalBytes: 2 } });
    expect(installFailure(again, [failed])).toBeNull();
  });

  it('下载来源的补救按设置页上的名字说，不写设置键', () => {
    for (const code of ['MODEL_DOWNLOAD_NETWORK', 'MODEL_DOWNLOAD_INTEGRITY', 'MODEL_DOWNLOAD_SOURCE']) {
      const { remedy } = modelProblem(code, '下载失败', {});
      expect(remedy, code).toContain('「设置 › 通用」的「模型下载来源」');
      expect(remedy, code).not.toMatch(/models\.\w+/);
    }
  });
});

describe('删除估算', () => {
  it('别的已装模型包也用的组件保留，其余算腾出的空间', () => {
    const target = bundle(QWEN, {
      components: [component('Qwen/Qwen3-ASR-0.6B'), component('silero/vad', { component: 'vad', sharedWith: ['b@mlx', 'c@mlx'] })],
    });
    const bundles = [target, bundle('b@mlx'), bundle('c@mlx', { state: 'not-installed' })];
    const estimate = removalEstimate(target, bundles);
    expect(estimate).toEqual({ frees: 100 * MB, kept: [{ repo: 'silero/vad', usedBy: ['b@mlx'] }] });
    expect(removalBody(estimate)).toBe('大约腾出 100 MB。silero/vad 还有 b@mlx 在用，保留。要再用时重新下载。');
  });

  it('没有组件信息时不编数字', () => {
    expect(removalBody(removalEstimate(bundle(QWEN), [bundle(QWEN)]))).toBe('删掉这个模型包独有的文件。要再用时重新下载。');
  });

  it('删完照 Runtime 的结果说', () => {
    expect(removedToast(QWEN, { removed: ['a'], kept: [] })).toBe(`已删除 ${QWEN}`);
    expect(removedToast(QWEN, { removed: [], kept: [{ repo: 'silero/vad', usedBy: ['b@mlx'] }] })).toBe(
      `已删除 ${QWEN} · silero/vad 还有别的模型包在用，保留`,
    );
  });
});

describe('分组与每行能做什么', () => {
  it('组件都装好才算已安装：第一次下载与补齐组件中的在可下载，修复中的留在已安装', () => {
    const fresh = bundle('a@mlx', { state: 'downloading', components: [component('x', { state: 'missing', bytes: null })] });
    const repairing = bundle('b@mlx', { state: 'downloading', components: [component('y')] });
    const partial = bundle('c@mlx', { state: 'not-installed', reason: 'incomplete', components: [component('y'), component('z', { state: 'missing' })] });
    const unsupported = bundle('d@candle', { state: 'error', reason: 'unsupported', components: [component('w', { state: 'missing' })] });
    const groups = localGroups([fresh, repairing, partial, unsupported], 'asr');
    expect(groups.installed.map((b) => b.bundleId)).toEqual(['b@mlx']);
    expect(groups.available.map((b) => b.bundleId)).toEqual(['a@mlx', 'c@mlx', 'd@candle']);
    expect(isBundleInstalled(bundle('e@mlx', { state: 'downloading' }))).toBe(false);
  });

  it('没装：能下载；暂停：继续或丢掉；在装：只能停下', () => {
    expect(bundleActions(bundle(QWEN, { state: 'not-installed' }))).toMatchObject({ install: true, resume: false, remove: false });
    const paused = bundle(QWEN, { state: 'not-installed', install: { jobId: null, state: 'paused', receivedBytes: 5, totalBytes: 10 } });
    expect(bundleActions(paused)).toMatchObject({ install: false, resume: true, discard: true, stop: false });
    const running = bundle(QWEN, { state: 'downloading', install: { jobId: 'j', state: 'downloading', receivedBytes: 5, totalBytes: 10 } });
    expect(bundleActions(running)).toEqual({ install: false, resume: false, stop: true, discard: false, repair: false, remove: false });
  });

  it('装好的能修复、删除；这台电脑不支持的不能下载', () => {
    expect(bundleActions(bundle(QWEN, { state: 'ready' }))).toMatchObject({ repair: true, remove: true, install: false });
    expect(bundleActions(bundle(QWEN, { state: 'not-installed', reason: 'hash-mismatch', components: [component('x')] }))).toMatchObject({
      repair: true,
    });
    expect(bundleActions(bundle('d@candle', { state: 'error', reason: 'unsupported', components: [component('w', { state: 'missing' })] }))).toMatchObject({
      install: false,
      remove: false,
    });
  });
});
