import { describe, expect, it } from 'vitest';
import type { Grant, GrantRevokeResult, PendingApproval } from '@baocut/protocol';
import {
  formatApprovalGrants,
  formatGrants,
  formatRevoke,
  formatUsage,
  parseApprovalGrantChoice,
  parseGrantsArgs,
  usageLabel,
} from './grants-output.ts';

function grant(patch: Partial<Grant> = {}): Grant {
  return {
    grantId: 'grt_1',
    dataKinds: ['audio'],
    recipient: 'openai',
    scope: { videoId: null },
    purpose: '转写访谈',
    budgetMode: 'per-call-unknown-cost',
    budgetCap: null,
    maxCalls: null,
    expiresAt: null,
    generation: 1,
    taskId: null,
    once: false,
    origin: 'user',
    approvalId: null,
    state: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    revokedAt: null,
    usage: { calls: 0, reservedCalls: 0, amount: null, reservedAmount: null, unknownCostCalls: 0 },
    ...patch,
  };
}

describe('baocut grants 的参数', () => {
  it('list：默认只看有效的；可以按服务商、视频过滤，--include-ended 也列出结束的', () => {
    expect(parseGrantsArgs([], {})).toEqual({ kind: 'list', params: {} });
    expect(parseGrantsArgs(['list'], { recipient: 'openai', video: 'vid_1', includeEnded: true })).toEqual({
      kind: 'list',
      params: { recipient: 'openai', videoId: 'vid_1', includeEnded: true },
    });
  });

  it('create：接收方、数据种类与用途必填；有金额上限时是 estimate-cap，否则按次计金额未知', () => {
    expect(parseGrantsArgs(['create'], { recipient: 'openai', data: 'audio,transcript', purpose: '转写' })).toEqual({
      kind: 'create',
      params: {
        recipient: 'openai',
        dataKinds: ['audio', 'transcript'],
        purpose: '转写',
        scope: { videoId: null },
        budgetMode: 'per-call-unknown-cost',
      },
    });
    expect(
      parseGrantsArgs(['create'], {
        recipient: 'openai',
        data: 'document',
        purpose: '配音',
        video: 'vid_1',
        maxCalls: '20',
        budget: '2.50',
        currency: 'usd',
        expires: '2026-12-31T23:59:59Z',
      }),
    ).toEqual({
      kind: 'create',
      params: {
        recipient: 'openai',
        dataKinds: ['document'],
        purpose: '配音',
        scope: { videoId: 'vid_1' },
        budgetMode: 'estimate-cap',
        budgetCap: { amount: '2.50', currency: 'USD' },
        maxCalls: 20,
        expiresAt: '2026-12-31T23:59:59.000Z',
      },
    });
    expect(() => parseGrantsArgs(['create'], { data: 'audio', purpose: 'x' })).toThrow(/--recipient/);
    expect(() => parseGrantsArgs(['create'], { recipient: 'openai', data: 'audio,pixels', purpose: 'x' })).toThrow(/pixels/);
    expect(() => parseGrantsArgs(['create'], { recipient: 'openai', data: 'audio', purpose: 'x', budget: '1.5' })).toThrow(/--currency/);
    expect(() => parseGrantsArgs(['create'], { recipient: 'openai', data: 'audio', purpose: 'x', budget: '1e3', currency: 'USD' })).toThrow(
      /--budget/,
    );
    expect(() => parseGrantsArgs(['create'], { recipient: 'openai', data: 'audio', purpose: 'x', maxCalls: '0' })).toThrow(/--max-calls/);
  });

  it('update：给出的字段替换；none 清除上限与到期；接收方不能改；什么都不给是错', () => {
    expect(parseGrantsArgs(['update', 'grt_1'], { maxCalls: 'none', budget: 'none', expires: 'none', video: 'all' })).toEqual({
      kind: 'update',
      params: { grantId: 'grt_1', maxCalls: null, budgetCap: null, expiresAt: null, scope: { videoId: null } },
    });
    expect(parseGrantsArgs(['update', 'grt_1'], { data: 'audio' })).toEqual({
      kind: 'update',
      params: { grantId: 'grt_1', dataKinds: ['audio'] },
    });
    expect(() => parseGrantsArgs(['update', 'grt_1'], {})).toThrow(/没有要修改的/);
    expect(() => parseGrantsArgs(['update', 'grt_1'], { recipient: 'google' })).toThrow(/接收方/);
    expect(() => parseGrantsArgs(['update'], { data: 'audio' })).toThrow(/用法/);
  });

  it('revoke / usage 要授权 id', () => {
    expect(parseGrantsArgs(['revoke', 'grt_1'], {})).toEqual({ kind: 'revoke', grantId: 'grt_1' });
    expect(parseGrantsArgs(['usage', 'grt_1'], {})).toEqual({ kind: 'usage', grantId: 'grt_1' });
    expect(() => parseGrantsArgs(['revoke'], {})).toThrow(/用法/);
    expect(() => parseGrantsArgs(['nope'], {})).toThrow(/用法/);
  });
});

describe('baocut approvals allow 的授权选择', () => {
  it('不给 --persist 时不带（只这一次）；给了时带范围与上限；范围与上限离开 --persist 是错', () => {
    expect(parseApprovalGrantChoice({})).toBeUndefined();
    expect(parseApprovalGrantChoice({ persist: true })).toEqual({ persist: true });
    expect(parseApprovalGrantChoice({ persist: true, scope: 'all', maxCalls: '5', budget: '3', currency: 'EUR' })).toEqual({
      persist: true,
      scope: 'all',
      maxCalls: 5,
      budgetCap: { amount: '3', currency: 'EUR' },
    });
    expect(() => parseApprovalGrantChoice({ maxCalls: '5' })).toThrow(/--persist/);
    expect(() => parseApprovalGrantChoice({ persist: true, scope: 'project' })).toThrow(/--scope/);
  });
});

describe('baocut grants 的输出', () => {
  it('没有授权时说明后果；一条一行：状态、接收方、数据、范围、用量与来源', () => {
    expect(formatGrants([])[0]).toMatch(/没有授权/);
    const [line] = formatGrants([
      grant({ maxCalls: 10, usage: { calls: 3, reservedCalls: 1, amount: null, reservedAmount: null, unknownCostCalls: 3 } }),
    ]);
    expect(line).toContain('grt_1');
    expect(line).toContain('[有效] openai ← 音频');
    expect(line).toContain('全部视频');
    expect(line).toContain('用量 3+1 预留/10 次（3 次金额未知）');
    expect(line).toContain('用户发放：转写访谈');
    const [scoped] = formatGrants([
      grant({ scope: { videoId: 'vid_1' }, taskId: 'tsk_1', once: true, state: 'revoked', origin: 'approval' }),
    ]);
    expect(scoped).toContain('[已撤销]');
    expect(scoped).toContain('视频 vid_1，只限任务 tsk_1，只这一次');
  });

  it('有金额上限时显示金额用量', () => {
    expect(
      usageLabel(
        grant({
          budgetMode: 'estimate-cap',
          budgetCap: { amount: '5', currency: 'USD' },
          usage: { calls: 2, reservedCalls: 1, amount: '0.4', reservedAmount: '0.2', unknownCostCalls: 0 },
        }),
      ),
    ).toBe('2+1 预留 次，0.4+0.2 预留/5 USD');
  });

  it('撤销如实列出已经交出的与还在执行的', () => {
    const result: GrantRevokeResult = {
      grant: grant({ state: 'revoked' }),
      alreadySent: { calls: 4, amount: null, unknownCostCalls: 4 },
      runningJobs: ['job_a'],
      note: '已经交出的数据与已经产生的费用无法靠撤销收回。',
    };
    const lines = formatRevoke(result);
    expect(lines[0]).toContain('已撤销 grt_1');
    expect(lines[1]).toBe('已经交出：4 次调用（4 次金额未知）');
    expect(lines[2]).toContain('job_a');
    expect(lines[3]).toContain('无法');
  });

  it('用量报告列出用过它的任务的预留与结算', () => {
    const lines = formatUsage({
      grant: grant(),
      jobs: [
        {
          jobId: 'job_a',
          state: 'completed',
          reserved: { calls: 1, amount: null },
          settled: { calls: 1, amount: null, basis: 'unknown', at: '2026-10-01T00:00:00.000Z' },
        },
        { jobId: 'job_b', state: 'running', reserved: { calls: 1, amount: null }, settled: null },
      ],
    });
    expect(lines[1]).toBe('  job_a  completed  预留 1 次 —  结算 1 次 —（unknown）');
    expect(lines[2]).toBe('  job_b  running  预留 1 次 —  未结算');
    expect(formatUsage({ grant: grant(), jobs: [] })[1]).toMatch(/还没有任务/);
  });

  it('审批里要授权的外发：接收方、数据、用途、估算与原因', () => {
    const approval = {
      grants: [
        {
          capability: 'synthesizeSpeech',
          dataKinds: ['document'],
          recipient: 'elevenlabs',
          videoId: 'vid_1',
          purpose: '合成语音（120 个字符）',
          reason: 'revoked',
          cost: 'unknown',
          estimate: null,
          maxCalls: 3,
        },
      ],
    } as unknown as PendingApproval;
    expect(formatApprovalGrants(approval)).toEqual([
      '    外发：elevenlabs ← 文本与提示词（视频 vid_1）：合成语音（120 个字符），金额未知，至多 3 次，授权已撤销或到期',
    ]);
    expect(formatApprovalGrants({} as PendingApproval)).toEqual([]);
  });
});
