import { describe, expect, it, vi } from 'vitest';
import { RpcError, type ModelInstallPlan } from '@baocut/protocol';
import type { HostBridge } from '../../host.ts';
import { RuntimeSession } from '../../runtime/session.ts';
import { bundle } from '../../model/models-test-fixtures.ts';
import { confirmInstall, planInstall, removeBundle, startSelfTest, stopInstall } from './local-model-actions.ts';

/**
 * 本地模型包的命令走真的 `RuntimeSession`（追加的薄方法），只把 `client.request` 换成假的：记下方法与参数，按方法回一个结果。
 * 不下载、不跑 Worker——安装与检查都停在这一层。
 */

const QWEN = 'qwen3-asr-0.6b@mlx-4bit';

function plan(patch: Partial<ModelInstallPlan> = {}): ModelInstallPlan {
  return {
    bundleId: QWEN,
    components: [{ component: 'asr', repo: 'Qwen/Qwen3-ASR-0.6B', revision: 'abc', action: 'download', files: ['a.safetensors'], bytes: 400 }],
    downloadBytes: 400,
    estimatedBytes: 400,
    confirmBytes: 400,
    resumedBytes: 0,
    availableBytes: 10_000,
    source: 'https://huggingface.co',
    upToDate: false,
    ...patch,
  };
}

type Reply = (params: Record<string, unknown>) => unknown;

function fakeSession(replies: Record<string, Reply>) {
  const session = new RuntimeSession({} as HostBridge);
  const calls: [string, Record<string, unknown>][] = [];
  vi.spyOn(session.client, 'request').mockImplementation((async (method: string, params: Record<string, unknown>) => {
    calls.push([method, params]);
    const reply = replies[method];
    if (!reply) throw new Error(`没有料到的调用 ${method}`);
    return reply(params);
  }) as never);
  return { session, calls };
}

describe('安装与修复：两步确认', () => {
  it('第一步只要计划，不带 confirmBytes 与 commandId', async () => {
    const { session, calls } = fakeSession({ 'models.install': () => ({ plan: plan(), jobId: null }), 'models.repair': () => ({ plan: plan(), jobId: null }) });
    await planInstall(session, 'install', QWEN);
    await planInstall(session, 'repair', QWEN);
    expect(calls).toEqual([
      ['models.install', { bundleId: QWEN }],
      ['models.repair', { bundleId: QWEN }],
    ]);
  });

  it('第二步原样交回 confirmBytes（带 commandId），拿到任务', async () => {
    const { session, calls } = fakeSession({ 'models.install': () => ({ plan: plan(), jobId: 'job_1' }) });
    expect(await confirmInstall(session, 'install', plan())).toEqual({ kind: 'started', jobId: 'job_1' });
    expect(calls[0]![1]).toMatchObject({ bundleId: QWEN, confirmBytes: 400 });
    expect(calls[0]![1]).toHaveProperty('commandId');
  });

  it('大小变了：带回新计划让对话框重新确认，不算失败', async () => {
    const next = plan({ confirmBytes: 520, downloadBytes: 520 });
    const error = new RpcError('conflict', '要下载的字节数变了，请按新的计划重新确认', { code: 'MODEL_INSTALL_SIZE_CHANGED', plan: next });
    const { session } = fakeSession({
      'models.repair': () => {
        throw error;
      },
    });
    expect(await confirmInstall(session, 'repair', plan())).toEqual({ kind: 'replan', plan: next });
  });

  it('已经齐全：没有任务', async () => {
    const done = plan({ upToDate: true, confirmBytes: 0, downloadBytes: 0 });
    const { session } = fakeSession({ 'models.repair': () => ({ plan: done, jobId: null }) });
    expect(await confirmInstall(session, 'repair', done)).toEqual({ kind: 'up-to-date', plan: done });
  });

  it('严格离线、磁盘不够这些拒绝原样抛出', async () => {
    const error = new RpcError('conflict', '严格离线模式下不下载模型', { code: 'OFFLINE_STRICT' });
    const { session } = fakeSession({
      'models.install': () => {
        throw error;
      },
    });
    await expect(confirmInstall(session, 'install', plan())).rejects.toBe(error);
  });
});

describe('停下、删除与检查', () => {
  it('暂停保留已下载的；取消下载时一并删掉', async () => {
    const { session, calls } = fakeSession({ 'models.cancelInstall': () => ({ bundle: bundle(QWEN, { state: 'not-installed' }) }) });
    await stopInstall(session, QWEN, false);
    await stopInstall(session, QWEN, true);
    expect(calls).toEqual([
      ['models.cancelInstall', { bundleId: QWEN }],
      ['models.cancelInstall', { bundleId: QWEN, discard: true }],
    ]);
  });

  it('删除返回 Runtime 实际删了什么、留了什么；在用时原样抛出', async () => {
    const result = { removed: ['Qwen/Qwen3-ASR-0.6B'], kept: [{ repo: 'silero/vad', usedBy: ['b@mlx'] }], bundle: bundle(QWEN, { state: 'not-installed' }) };
    const { session } = fakeSession({ 'models.remove': () => result });
    expect(await removeBundle(session, QWEN)).toEqual(result);

    const busy = new RpcError('conflict', '模型包正在使用', { code: 'MODEL_IN_USE', bundleId: QWEN, jobIds: ['job_2'] });
    const { session: other } = fakeSession({
      'models.remove': () => {
        throw busy;
      },
    });
    await expect(removeBundle(other, QWEN)).rejects.toBe(busy);
  });

  it('检查提交一个任务（带 commandId）', async () => {
    const { session, calls } = fakeSession({ 'models.test': () => ({ jobId: 'job_3' }) });
    expect(await startSelfTest(session, QWEN)).toBe('job_3');
    expect(calls[0]![0]).toBe('models.test');
    expect(calls[0]![1]).toMatchObject({ bundleId: QWEN });
    expect(calls[0]![1]).toHaveProperty('commandId');
  });
});
