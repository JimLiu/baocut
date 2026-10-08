import { describe, expect, it } from 'vitest';
import { RpcError, type JobRecord, type ModelBundleStatus, type ModelComponentStatus, type ModelInstallPlan } from '@baocut/protocol';
import {
  bundleActions,
  canDownload,
  downloadableBundle,
  downloadView,
  installFailure,
  installPlanView,
  installProgressView,
  modelProblem,
  removalBody,
  removalEstimate,
  removedToast,
  rpcProblem,
  separationDownload,
} from './models-install.ts';
import { installingPlacement, isBundleInstalled, localGroups } from './models-local.ts';
import { bundle } from './models-test-fixtures.ts';
import { fmtSize } from './task-facts.ts';

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
  it('自己的文件在盘上就在已安装：修复中的、权重在缺组件的都是；第一次下载中的、只有别人装上的公共组件的在可下载', () => {
    const fresh = bundle('a@mlx', { state: 'downloading', components: [component('x', { state: 'missing', bytes: null })] });
    const repairing = bundle('b@mlx', { state: 'downloading', components: [component('y')] });
    const partial = bundle('c@mlx', { state: 'not-installed', reason: 'incomplete', components: [component('c'), component('z', { state: 'missing' })] });
    const unsupported = bundle('d@candle', { state: 'error', reason: 'unsupported', components: [component('w', { state: 'missing' })] });
    // y 是 b 装上的公共组件，e 自己的 v 还没下。
    const borrowed = bundle('e@mlx', { state: 'not-installed', reason: 'incomplete', components: [component('y'), component('v', { state: 'missing' })] });
    const groups = localGroups([fresh, repairing, partial, unsupported, borrowed], 'asr');
    expect(groups.installed.map((b) => b.bundleId)).toEqual(['b@mlx', 'c@mlx']);
    expect(groups.available.map((b) => b.bundleId)).toEqual(['a@mlx', 'd@candle', 'e@mlx']);
    expect(isBundleInstalled(partial)).toBe(false);
    expect(isBundleInstalled(bundle('f@mlx', { state: 'downloading' }))).toBe(false);
  });

  it('下载中的行不换组：按记着的那一组放，下载结束再按文件归组', () => {
    const running = { jobId: 'j', state: 'downloading' as const, receivedBytes: 5, totalBytes: 10 };
    const start = bundle('a@mlx', { state: 'downloading', install: running, components: [component('w', { state: 'missing' }), component('v', { state: 'missing' })] });
    const placed = installingPlacement(localGroups([start], 'asr'));
    expect(placed).toEqual(new Map([['a@mlx', false]]));
    // 权重先装上了：还在可下载，不在下载途中跳组。
    const midway = { ...start, components: [component('w'), component('v', { state: 'missing' })] };
    expect(localGroups([midway], 'asr').installed.map((b) => b.bundleId)).toEqual(['a@mlx']);
    expect(localGroups([midway], 'asr', placed).available.map((b) => b.bundleId)).toEqual(['a@mlx']);
    // 下完了：不再看记着的。
    const done = bundle('a@mlx', { state: 'installed', components: [component('w'), component('v')] });
    expect(localGroups([done], 'asr', placed).installed.map((b) => b.bundleId)).toEqual(['a@mlx']);
    expect(installingPlacement(localGroups([done], 'asr', placed))).toEqual(new Map());
  });

  it('没装：能下载；暂停：继续或丢掉；在装：只能停下', () => {
    expect(bundleActions(bundle(QWEN, { state: 'not-installed' }))).toMatchObject({ install: true, resume: false, remove: false });
    const paused = bundle(QWEN, { state: 'not-installed', install: { jobId: null, state: 'paused', receivedBytes: 5, totalBytes: 10 } });
    expect(bundleActions(paused)).toMatchObject({ install: false, resume: true, discard: true, stop: false });
    const running = bundle(QWEN, { state: 'downloading', install: { jobId: 'j', state: 'downloading', receivedBytes: 5, totalBytes: 10 } });
    expect(bundleActions(running)).toEqual({
      install: false,
      complete: false,
      resume: false,
      stop: true,
      discard: false,
      repair: false,
      remove: false,
    });
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

  it('装好了、缺可选组件：能补齐（只下缺的），不算没装；在装、暂停、跑不了的不给补齐', () => {
    const aligner = component('aufklarer/aligner', { component: 'aligner', optional: true, state: 'missing', bytes: null });
    const half = bundle(QWEN, { state: 'ready', components: [component('w'), aligner] });
    expect(isBundleInstalled(half)).toBe(true);
    expect(bundleActions(half)).toMatchObject({ complete: true, install: false, repair: true, remove: true });
    expect(bundleActions(bundle(QWEN, { state: 'ready', components: [component('w'), { ...aligner, state: 'installed' }] })).complete).toBe(false);
    const running = { ...half, install: { jobId: 'j', state: 'downloading' as const, receivedBytes: 5, totalBytes: 10 } };
    expect(bundleActions(running)).toMatchObject({ complete: false, stop: true });
    const paused = { ...half, install: { jobId: null, state: 'paused' as const, receivedBytes: 5, totalBytes: 10 } };
    expect(bundleActions(paused)).toMatchObject({ complete: false, resume: true });
    expect(bundleActions({ ...half, state: 'error', reason: 'worker-missing' }).complete).toBe(false);
    // 必需组件缺：没装好，走「下载」，不是补齐
    const partial = bundle(QWEN, { state: 'not-installed', reason: 'incomplete', components: [component('w', { state: 'missing' }), aligner] });
    expect(bundleActions(partial)).toMatchObject({ complete: false, install: true });
  });

  it('权重在、缺公共组件（ownFiles）：给补齐不给下载，能修复、删除；只有别人装上的公共组件的走下载、不给删', () => {
    const vad = component('silero/vad', { component: 'vad', state: 'missing', bytes: null });
    const half = bundle(QWEN, { state: 'not-installed', reason: 'incomplete', components: [component('w'), vad] });
    expect(bundleActions(half, true)).toEqual({
      install: false,
      complete: true,
      resume: false,
      stop: false,
      discard: false,
      repair: true,
      remove: true,
    });
    // 不给 ownFiles 时按装好没有算。
    expect(bundleActions(half)).toMatchObject({ install: true, complete: false, repair: false, remove: false });
    // 跑不了的不给补齐、修复，照样能删。
    expect(bundleActions({ ...half, state: 'error', reason: 'worker-missing' }, true)).toMatchObject({
      install: false,
      complete: false,
      repair: false,
      remove: true,
    });
    const borrowed = bundle(QWEN, { state: 'not-installed', reason: 'incomplete', components: [component('w', { state: 'missing' }), { ...vad, state: 'installed' }] });
    expect(bundleActions(borrowed, false)).toMatchObject({ install: true, complete: false, repair: false, remove: false });
  });
});

describe('就地下载（工具页、转录设置、配音的「下载 {大小}」）', () => {
  const missing = (bundleId: string, patch: Partial<ModelBundleStatus> = {}) =>
    bundle(bundleId, { state: 'not-installed', components: [component('w', { state: 'missing' })], estimatedBytes: 1.2 * GB, ...patch });
  const ready = (bundleId: string) => bundle(bundleId, { state: 'ready', components: [component('w')] });

  it('没装好、这台电脑也跑得了才能下载', () => {
    expect(canDownload(missing(QWEN))).toBe(true);
    expect(canDownload(ready(QWEN))).toBe(false);
    expect(canDownload(missing(QWEN, { state: 'error', reason: 'unsupported' }))).toBe(false);
    expect(canDownload(missing(QWEN, { state: 'error', reason: 'worker-missing' }))).toBe(false);
  });

  it('只认本机的模型，按模型 ID 找模型包；云端、装好了的、找不到的为 null', () => {
    const bundles = [missing(QWEN), ready('kokoro-82m')];
    expect(downloadableBundle(bundles, { providerId: 'local', modelId: QWEN })?.bundleId).toBe(QWEN);
    expect(downloadableBundle(bundles, { providerId: 'openai', modelId: QWEN })).toBeNull();
    expect(downloadableBundle(bundles, { providerId: 'local', modelId: 'kokoro-82m' })).toBeNull();
    expect(downloadableBundle(bundles, { providerId: 'local', modelId: 'gone' })).toBeNull();
    expect(downloadableBundle(bundles, null)).toBeNull();
  });

  it('分离模型：按 ID 排第一只能下载的（与 Runtime 挑分离默认值同序）；都下载不了时 null', () => {
    const sep = (bundleId: string, patch: Partial<ModelBundleStatus> = {}) => missing(bundleId, { capability: 'separate', ...patch });
    const list = [missing(QWEN), sep('z@mlx'), sep('a@candle', { state: 'error', reason: 'unsupported' }), sep('b@mlx')];
    expect(separationDownload(list)?.bundleId).toBe('b@mlx');
    expect(separationDownload([missing(QWEN), sep('a@candle', { state: 'error', reason: 'unsupported' })])).toBeNull();
  });

  it('下载的样子：大小先用下载任务的总量、再用估计值；在下写百分比，停在一半是暂停', () => {
    expect(downloadView(missing(QWEN))).toEqual({ state: 'idle', size: fmtSize(1.2 * GB), percent: null });
    const { estimatedBytes: _, ...unknown } = missing(QWEN);
    expect(downloadView(unknown)).toEqual({ state: 'idle', size: null, percent: null });
    const running = missing(QWEN, { install: { jobId: 'j', state: 'downloading', receivedBytes: 0.6 * GB, totalBytes: 2 * GB } });
    expect(downloadView(running)).toEqual({ state: 'running', size: fmtSize(2 * GB), percent: 30 });
    const queued = missing(QWEN, { install: { jobId: 'j', state: 'queued', receivedBytes: 0, totalBytes: null } });
    expect(downloadView(queued)).toEqual({ state: 'running', size: fmtSize(1.2 * GB), percent: null });
    const paused = missing(QWEN, { install: { jobId: null, state: 'paused', receivedBytes: 5, totalBytes: 10 } });
    expect(downloadView(paused).state).toBe('paused');
  });
});
