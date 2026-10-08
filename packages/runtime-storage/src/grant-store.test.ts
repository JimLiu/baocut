import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, estimateCallCost } from '@baocut/protocol';
import { GrantStore, type GrantCall } from './grant-store.ts';

describe('GrantStore', () => {
  let dir: string;
  let file: string;
  let now: Date;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-grants-'));
    file = path.join(dir, 'store', 'grants.json');
    now = new Date('2026-10-01T00:00:00Z');
  });

  const opened: GrantStore[] = [];

  afterEach(async () => {
    // 写盘在后台串行进行：删目录前等它写完。
    await Promise.all(opened.splice(0).map((store) => store.flush()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const open = async () => {
    const store = await GrantStore.open(file, { now: () => now });
    opened.push(store);
    return store;
  };

  const call = (overrides: Partial<GrantCall> = {}): GrantCall => ({
    recipient: 'openai',
    dataKinds: ['audio'],
    videoId: 'vid_a',
    taskId: null,
    estimate: null,
    ...overrides,
  });

  function persistent(store: GrantStore, overrides: Partial<Parameters<GrantStore['create']>[0]> = {}) {
    return store.create({
      dataKinds: ['audio'],
      recipient: 'openai',
      purpose: '转写',
      budgetMode: 'per-call-unknown-cost',
      origin: 'user',
      ...overrides,
    });
  }

  describe('匹配', () => {
    it('按数据种类、接收方与范围匹配', async () => {
      const store = await open();
      const grant = persistent(store, { dataKinds: ['audio', 'transcript'], scope: { videoId: 'vid_a' } });

      expect(store.evaluate(call())).toMatchObject({ status: 'covered', grant: { grantId: grant.grantId } });
      expect(store.evaluate(call({ dataKinds: ['audio', 'transcript'] })).status).toBe('covered');
      // 批准音频不等于批准原视频。
      expect(store.evaluate(call({ dataKinds: ['audio', 'video'] })).status).toBe('none');
      expect(store.evaluate(call({ recipient: 'google' })).status).toBe('none');
      expect(store.evaluate(call({ videoId: 'vid_b' })).status).toBe('none');
      expect(store.evaluate(call({ videoId: null })).status).toBe('none');
    });

    it('全部视频的授权覆盖任何视频与不属于视频的调用；任务授权只覆盖那个任务', async () => {
      const store = await open();
      persistent(store);
      const task = persistent(store, { taskId: 'task_1', dataKinds: ['frames'] });
      expect(store.evaluate(call({ videoId: 'vid_z' })).status).toBe('covered');
      expect(store.evaluate(call({ videoId: null })).status).toBe('covered');
      expect(store.evaluate(call({ dataKinds: ['frames'], taskId: 'task_1' }))).toMatchObject({ grant: { grantId: task.grantId } });
      expect(store.evaluate(call({ dataKinds: ['frames'], taskId: 'task_2' })).status).toBe('none');
    });

    it('优先用最具体的授权', async () => {
      const store = await open();
      persistent(store);
      const video = persistent(store, { scope: { videoId: 'vid_a' } });
      const task = persistent(store, { taskId: 'task_1' });
      expect(store.evaluate(call()).status === 'covered' && store.evaluate(call())).toMatchObject({ grant: { grantId: video.grantId } });
      expect(store.evaluate(call({ taskId: 'task_1' }))).toMatchObject({ grant: { grantId: task.grantId } });
    });

    it('「只这一次」的授权只被点名的那次调用使用', async () => {
      const store = await open();
      const once = persistent(store, { once: true, origin: 'approval' });
      expect(once.maxCalls).toBe(1);
      expect(store.evaluate(call()).status).toBe('none');
      const first = store.admit(call({ grantId: once.grantId }), { jobId: 'job_1' });
      expect(first.ok).toBe(true);
      expect(store.admit(call({ grantId: once.grantId })).ok).toBe(false);
      if (!first.ok) return;
      await store.start(first.reservation.reservationId);
      store.settle(first.reservation.reservationId, { kind: 'completed' });
      expect(store.get(once.grantId)!.state).toBe('exhausted');
      expect(store.evaluate(call({ grantId: once.grantId }))).toMatchObject({ status: 'exhausted', measure: 'calls' });
    });

    it('到期的授权不再覆盖，报告为曾经覆盖它的那条', async () => {
      const store = await open();
      const grant = persistent(store, { expiresAt: '2026-10-02T00:00:00Z' });
      expect(store.evaluate(call()).status).toBe('covered');
      now = new Date('2026-10-03T00:00:00Z');
      expect(store.evaluate(call())).toMatchObject({ status: 'none', revoked: { grantId: grant.grantId, state: 'expired' } });
    });
  });

  describe('撤销与代', () => {
    it('撤销之后不再覆盖新的调用，排队中按旧代预留的调用开始时被拒绝', async () => {
      const store = await open();
      const grant = persistent(store);
      const queued = store.admit(call(), { jobId: 'job_q' });
      const running = store.admit(call(), { jobId: 'job_r' });
      if (!queued.ok || !running.ok) throw new Error('应该覆盖');
      expect(await store.start(running.reservation.reservationId)).toEqual({ ok: true });
      const result = store.revoke(grant.grantId);
      expect(result.grant).toMatchObject({ state: 'revoked', generation: 2 });
      expect(result.runningJobs).toEqual(['job_r']);
      expect(result.noteRef).toEqual({ key: 'runtimeStorageGrants.revokeNote' });
      expect(store.evaluate(call())).toMatchObject({ status: 'none', revoked: { grantId: grant.grantId } });
      expect(await store.start(queued.reservation.reservationId)).toMatchObject({ ok: false, grant: { grantId: grant.grantId } });
      expect(store.settle(queued.reservation.reservationId, { kind: 'failed' })).toMatchObject({ calls: 0, basis: 'released' });
      // 已经开始的照常结束并计入用量：已经交出的数据如实报告。
      expect(store.settle(running.reservation.reservationId, { kind: 'completed' })).toMatchObject({ calls: 1, basis: 'unknown' });
      expect(store.get(grant.grantId)!.usage).toMatchObject({ calls: 1, reservedCalls: 0, unknownCostCalls: 1 });
      // 重复撤销不再加代。
      expect(store.revoke(grant.grantId).grant.generation).toBe(2);
      expect(store.revoke(grant.grantId).alreadySent).toMatchObject({ calls: 1, unknownCostCalls: 1 });
    });

    it('收紧时代加一，按旧代预留的调用开始时被拒绝；放宽不加代', async () => {
      const store = await open();
      const grant = persistent(store, { dataKinds: ['audio', 'transcript'] });
      const before = store.admit(call(), { jobId: 'job_1' });
      if (!before.ok) throw new Error('应该覆盖');
      expect(store.update({ grantId: grant.grantId, purpose: '换个说法' }).generation).toBe(1);
      expect(store.update({ grantId: grant.grantId, maxCalls: 10 }).generation).toBe(2);
      expect((await store.start(before.reservation.reservationId)).ok).toBe(false);
      expect(store.update({ grantId: grant.grantId, maxCalls: 20 }).generation).toBe(2);
      expect(store.update({ grantId: grant.grantId, dataKinds: ['audio'] }).generation).toBe(3);
      expect(store.update({ grantId: grant.grantId, scope: { videoId: 'vid_a' } }).generation).toBe(4);
      expect(store.update({ grantId: grant.grantId, scope: { videoId: null } }).generation).toBe(4);
      store.revoke(grant.grantId);
      expect(() => store.update({ grantId: grant.grantId, purpose: 'x' })).toThrow(RpcError);
    });
  });

  describe('预留与结算', () => {
    it('次数上限计入预留中的调用', async () => {
      const store = await open();
      const grant = persistent(store, { maxCalls: 2 });
      const a = store.admit(call());
      const b = store.admit(call());
      const c = store.admit(call());
      expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
      expect(c.ok || ('evaluation' in c && c.evaluation)).toMatchObject({
        status: 'exhausted',
        measure: 'calls',
        grant: { grantId: grant.grantId },
      });
      // 没开始就结束的预留全部释放，名额回来。
      if (!a.ok) return;
      expect(store.settle(a.reservation.reservationId, { kind: 'failed' })).toMatchObject({ calls: 0, basis: 'released' });
      expect(store.admit(call()).ok).toBe(true);
    });

    it('并行的预留不会一起越过上限', async () => {
      const store = await open();
      const grant = persistent(store, { maxCalls: 3 });
      const results = await Promise.all(Array.from({ length: 20 }, async () => store.admit(call())));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      expect(store.get(grant.grantId)!.usage.reservedCalls).toBe(3);
    });

    it('金额上限：按估算预留，完成时按报告或估算计，失败时保守扣除', async () => {
      const store = await open();
      const grant = persistent(store, { budgetMode: 'estimate-cap', budgetCap: { amount: '1.00', currency: 'USD' } });
      const estimate = estimateCallCost({ currency: 'USD', amount: '0.40', unit: 'request' }, {});
      const a = store.admit(call({ estimate }));
      const b = store.admit(call({ estimate }));
      const c = store.admit(call({ estimate }));
      expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
      expect(c.ok || ('evaluation' in c && c.evaluation)).toMatchObject({ status: 'exhausted', measure: 'amount' });
      if (!a.ok || !b.ok) return;
      expect(a.reservation.amount).toEqual({ amount: '0.40', currency: 'USD' });
      expect(store.get(grant.grantId)!.usage).toMatchObject({ reservedCalls: 2, reservedAmount: '0.80', amount: '0.00' });

      await store.start(a.reservation.reservationId);
      expect(store.settle(a.reservation.reservationId, { kind: 'completed', reported: { amount: '0.25', currency: 'USD' } })).toMatchObject(
        {
          calls: 1,
          amount: { amount: '0.25', currency: 'USD' },
          basis: 'reported',
        },
      );
      await store.start(b.reservation.reservationId);
      expect(store.settle(b.reservation.reservationId, { kind: 'failed' })).toMatchObject({
        calls: 1,
        amount: { amount: '0.40', currency: 'USD' },
        basis: 'conservative',
      });
      expect(store.get(grant.grantId)!.usage).toMatchObject({ calls: 2, amount: '0.65', reservedAmount: '0.00' });
      // 还剩 0.35，下一笔 0.40 放不下。
      expect(store.admit(call({ estimate })).ok).toBe(false);
      expect(store.admit(call({ estimate: { amount: '0.35', currency: 'USD' } })).ok).toBe(true);
    });

    it('有金额上限而估不出金额（没有价格、币种不同）时无法保证上限', async () => {
      const store = await open();
      persistent(store, { budgetMode: 'estimate-cap', budgetCap: { amount: '5', currency: 'USD' } });
      expect(store.evaluate(call()).status).toBe('unverifiable');
      expect(store.evaluate(call({ estimate: { amount: '0.1', currency: 'EUR' } })).status).toBe('unverifiable');
      // 另有一条金额未知的授权时用它。
      persistent(store, { budgetMode: 'per-call-unknown-cost' });
      expect(store.evaluate(call()).status).toBe('covered');
    });

    it('重试再预留一次：重试也消耗预算', async () => {
      const store = await open();
      const grant = persistent(store, { maxCalls: 2 });
      const first = store.admit(call(), { jobId: 'job_1' });
      if (!first.ok) throw new Error('应该覆盖');
      await store.start(first.reservation.reservationId);
      store.settle(first.reservation.reservationId, { kind: 'failed' });
      const retry = store.admit(call({ grantId: grant.grantId }), { jobId: 'job_1' });
      expect(retry.ok).toBe(true);
      if (!retry.ok) return;
      await store.start(retry.reservation.reservationId);
      store.settle(retry.reservation.reservationId, { kind: 'failed' });
      expect(store.admit(call()).ok).toBe(false);
      expect(store.get(grant.grantId)!.usage).toMatchObject({ calls: 2, unknownCostCalls: 2 });
    });
  });

  describe('持久化', () => {
    it('写盘（0600）并在重新打开时恢复；孤儿预留按开始与否结算', async () => {
      const store = await open();
      const grant = persistent(store, { maxCalls: 5 });
      const started = store.admit(call(), { jobId: 'job_a' });
      store.admit(call(), { jobId: 'job_b' });
      if (!started.ok) throw new Error('应该覆盖');
      await store.start(started.reservation.reservationId);
      await store.flush();
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);

      const reopened = await open();
      expect(reopened.get(grant.grantId)!.usage).toMatchObject({ calls: 0, reservedCalls: 2 });
      expect(reopened.settleOrphans()).toBe(2);
      expect(reopened.get(grant.grantId)!.usage).toMatchObject({ calls: 1, reservedCalls: 0, unknownCostCalls: 1 });
    });

    it('「已开始」落盘之后 start 才放行：之后崩溃，重启时按已开始保守结算，不会释放', async () => {
      const store = await open();
      const grant = persistent(store, { maxCalls: 5 });
      const admitted = store.admit(call(), { jobId: 'job_a' });
      if (!admitted.ok) throw new Error('应该覆盖');
      expect(await store.start(admitted.reservation.reservationId)).toEqual({ ok: true });
      // 不等 flush：start 兑现时磁盘上已经是「已开始」（随后的崩溃丢不掉它）。
      const onDisk = JSON.parse(await fs.readFile(file, 'utf8')) as { reservations: Array<{ reservationId: string; started: boolean }> };
      expect(onDisk.reservations).toContainEqual(
        expect.objectContaining({ reservationId: admitted.reservation.reservationId, started: true }),
      );
      // 经 open() 打开：结算孤儿预留的后台写盘在删目录前等它写完。
      const reopened = await open();
      expect(reopened.settleOrphans()).toBe(1);
      expect(reopened.get(grant.grantId)!.usage).toMatchObject({ calls: 1, reservedCalls: 0, unknownCostCalls: 1 });
    });

    it('「已开始」写不进磁盘时不放行，撤回开始；flush 不会因为一直写不进去而卡住', async () => {
      const store = await open();
      persistent(store);
      const admitted = store.admit(call(), { jobId: 'job_a' });
      if (!admitted.ok) throw new Error('应该覆盖');
      await store.flush();
      const storeDir = path.dirname(file);
      await fs.chmod(storeDir, 0o500);
      try {
        expect(await store.start(admitted.reservation.reservationId)).toMatchObject({ ok: false, unsaved: true });
        expect(store.pending(admitted.reservation.reservationId)).toBe(true);
        await store.flush();
      } finally {
        await fs.chmod(storeDir, 0o700);
      }
      await store.flush();
      const onDisk = JSON.parse(await fs.readFile(file, 'utf8')) as { reservations: Array<{ started: boolean }> };
      expect(onDisk.reservations.map((r) => r.started)).toEqual([false]);
    });
  });

  describe('启用 Provider 时的默认授权', () => {
    it('同一次启用只发放一次；撤销后不补发，重新启用才发放；停用撤销默认授权', async () => {
      const store = await open();
      const first = store.ensureProviderGrant({ recipient: 'openai', dataKinds: ['audio'], enabledAt: 't1', label: 'OpenAI' })!;
      expect(first).toMatchObject({ origin: 'provider-enable', budgetMode: 'per-call-unknown-cost', maxCalls: null, budgetCap: null });
      expect(
        store.ensureProviderGrant({ recipient: 'openai', dataKinds: ['audio', 'document'], enabledAt: 't1', label: 'OpenAI' }),
      ).toMatchObject({
        grantId: first.grantId,
        dataKinds: ['audio', 'document'],
        generation: 1,
      });
      store.revoke(first.grantId);
      expect(store.ensureProviderGrant({ recipient: 'openai', dataKinds: ['audio'], enabledAt: 't1', label: 'OpenAI' })).toBeNull();
      const second = store.ensureProviderGrant({ recipient: 'openai', dataKinds: ['audio'], enabledAt: 't2', label: 'OpenAI' })!;
      expect(second.grantId).not.toBe(first.grantId);
      const user = persistent(store);
      expect(store.revokeProviderGrants('openai')).toBe(1);
      expect(store.get(second.grantId)!.state).toBe('revoked');
      expect(store.get(user.grantId)!.state).toBe('active');
    });
  });

  describe('任务预算', () => {
    const usd = (amount: string) => ({ amount, currency: 'USD' });
    const priced = (amount: string) => estimateCallCost({ currency: 'USD', amount, unit: 'request' }, {});

    it('次数上限跨 Provider 合计；超出时不预留，授权的预留也不占', async () => {
      const store = await open();
      persistent(store);
      const google = persistent(store, { recipient: 'google' });
      const policy = store.setTaskBudget('task_1', { maxCalls: 2, cap: null });
      expect(policy).toMatchObject({ taskId: 'task_1', maxCalls: 2, usage: { calls: 0, reservedCalls: 0 } });
      const a = store.admit(call({ taskId: 'task_1' }));
      const b = store.admit(call({ taskId: 'task_1', recipient: 'google' }));
      const c = store.admit(call({ taskId: 'task_1' }));
      expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
      expect('task' in c && c.task).toMatchObject({ status: 'exhausted', measure: 'calls', policy: { taskId: 'task_1' } });
      expect(store.get(google.grantId)!.usage.reservedCalls).toBe(1);
      // 别的任务、不在任务里的调用不受这个预算限制。
      expect(store.admit(call({ taskId: 'task_2' })).ok).toBe(true);
      expect(store.admit(call()).ok).toBe(true);
      expect(store.taskBudget('task_1')!.usage.reservedCalls).toBe(2);
    });

    it('金额上限：同币种估算合计；估不出、币种不同时无法保证', async () => {
      const store = await open();
      persistent(store);
      persistent(store, { recipient: 'google' });
      store.setTaskBudget('task_1', { maxCalls: null, cap: usd('1.00') });
      const a = store.admit(call({ taskId: 'task_1', estimate: priced('0.40') }));
      const b = store.admit(call({ taskId: 'task_1', recipient: 'google', estimate: priced('0.40') }));
      const c = store.admit(call({ taskId: 'task_1', estimate: priced('0.40') }));
      expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
      expect('task' in c && c.task).toMatchObject({ status: 'exhausted', measure: 'amount' });
      expect(store.evaluateTask({ taskId: 'task_1', estimate: null })).toMatchObject({ status: 'unverifiable' });
      expect(store.evaluateTask({ taskId: 'task_1', estimate: { amount: '0.01', currency: 'EUR' } })).toMatchObject({
        status: 'unverifiable',
      });
      expect(store.taskBudget('task_1')!.usage.reserved).toEqual([usd('0.80')]);
    });

    it('结算只记一次：完成按报告或估算，失败保守扣除，没开始的释放；金额未知之后金额上限无法保证', async () => {
      const store = await open();
      persistent(store);
      store.setTaskBudget('task_1', { maxCalls: null, cap: null });
      const done = store.admit(call({ taskId: 'task_1', estimate: priced('0.30') }));
      const failed = store.admit(call({ taskId: 'task_1', estimate: priced('0.20') }));
      const released = store.admit(call({ taskId: 'task_1', estimate: priced('0.50') }));
      const unknown = store.admit(call({ taskId: 'task_1' }));
      if (!done.ok || !failed.ok || !released.ok || !unknown.ok) throw new Error('应当预留');
      await store.start(done.reservation.reservationId);
      await store.start(failed.reservation.reservationId);
      await store.start(unknown.reservation.reservationId);
      store.settle(done.reservation.reservationId, { kind: 'completed', reported: { amount: '0.25', currency: 'EUR' } });
      store.settle(done.reservation.reservationId, { kind: 'completed' });
      store.settle(failed.reservation.reservationId, { kind: 'failed' });
      store.settle(released.reservation.reservationId, { kind: 'failed' });
      store.settle(unknown.reservation.reservationId, { kind: 'completed' });
      expect(store.taskBudget('task_1')!.usage).toEqual({
        calls: 3,
        reservedCalls: 0,
        spent: [
          { amount: '0.25', currency: 'EUR' },
          { amount: '0.20', currency: 'USD' },
        ],
        reserved: [],
        unknownCostCalls: 1,
      });
      // 之后设金额上限：已用里有别的币种与金额未知的调用，总额无法保证。
      store.setTaskBudget('task_1', { maxCalls: null, cap: usd('10') });
      expect(store.evaluateTask({ taskId: 'task_1', estimate: priced('0.01') })).toMatchObject({ status: 'unverifiable' });
    });

    it('崩溃之后：开始过的孤儿预留保守地记进任务预算，只记一次；没开始的释放', async () => {
      const store = await open();
      persistent(store);
      store.setTaskBudget('task_1', { maxCalls: 5, cap: usd('5') });
      const started = store.admit(call({ taskId: 'task_1', estimate: priced('0.70') }), { jobId: 'job_a' });
      const queued = store.admit(call({ taskId: 'task_1', estimate: priced('0.90') }), { jobId: 'job_b' });
      if (!started.ok || !queued.ok) throw new Error('应当预留');
      await store.start(started.reservation.reservationId);
      await store.flush();

      // 「重启」：从磁盘读回，结算孤儿预留两次。
      const reopened = await open();
      expect(reopened.taskBudget('task_1')!.usage.reservedCalls).toBe(2);
      expect(reopened.settleOrphans()).toBe(2);
      expect(reopened.settleOrphans()).toBe(0);
      expect(reopened.taskBudget('task_1')!.usage).toMatchObject({ calls: 1, reservedCalls: 0, spent: [usd('0.70')] });
      await reopened.flush();
      const again = await open();
      expect(again.taskBudget('task_1')!.usage).toMatchObject({ calls: 1, spent: [usd('0.70')] });
    });

    it('早先没有任务预算的账本照常读入', async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, grants: [], reservations: [] }));
      const store = await open();
      expect(store.taskBudget('task_1')).toBeNull();
      expect(store.evaluateTask({ taskId: 'task_1', estimate: null })).toBeNull();
    });
  });

  it('发放时校验预算方式与金额', async () => {
    const store = await open();
    expect(() => persistent(store, { budgetMode: 'estimate-cap' })).toThrow(/budgetCap/);
    expect(() => persistent(store, { budgetCap: { amount: '1', currency: 'USD' } })).toThrow(RpcError);
    expect(() => persistent(store, { budgetMode: 'estimate-cap', budgetCap: { amount: '1.1234567', currency: 'USD' } })).toThrow(RpcError);
    expect(() => persistent(store, { budgetMode: 'estimate-cap', budgetCap: { amount: '1', currency: 'usd' } })).toThrow(RpcError);
    expect(() => persistent(store, { expiresAt: '2026-09-01T00:00:00Z' })).toThrow(RpcError);
  });
});
