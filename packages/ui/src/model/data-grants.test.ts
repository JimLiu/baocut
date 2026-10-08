import { describe, expect, it } from 'vitest';
import type { Grant } from '@baocut/protocol';
import {
  endedCount,
  grantFacts,
  grantStateLabel,
  grantTitle,
  listedGrants,
  recipientName,
  revokeConfirmText,
  revokeResultLine,
  usageLine,
} from './data-grants.ts';

const grant = (patch: Partial<Grant> & Pick<Grant, 'grantId'>): Grant => ({
  dataKinds: ['document'],
  recipient: 'openai',
  scope: { videoId: null },
  purpose: '生成文本',
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
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-01T09:00:00Z',
  revokedAt: null,
  usage: { calls: 0, reservedCalls: 0, amount: null, reservedAmount: null, unknownCostCalls: 0 },
  ...patch,
});

const labels = new Map([['openai', 'OpenAI']]);

describe('数据外发授权', () => {
  it('有效的在前、新的在前；不显示已结束的时只列有效的', () => {
    const list = [
      grant({ grantId: 'old', createdAt: '2026-10-01T09:00:00Z' }),
      grant({ grantId: 'revoked', state: 'revoked', createdAt: '2026-10-03T09:00:00Z' }),
      grant({ grantId: 'new', createdAt: '2026-10-02T09:00:00Z' }),
    ];
    expect(listedGrants(list, false).map((g) => g.grantId)).toEqual(['new', 'old']);
    expect(listedGrants(list, true).map((g) => g.grantId)).toEqual(['new', 'old', 'revoked']);
    expect(endedCount(list)).toBe(1);
    expect(grantStateLabel('exhausted')).toBe('额度用完');
  });

  it('接收方：模型视图里的名字，其次自建服务商的名字、Agent 的名字，最后照写 ID', () => {
    expect(recipientName('openai', labels)).toBe('OpenAI');
    expect(recipientName('custom:本地网关', labels)).toBe('本地网关');
    expect(recipientName('agent:codex', labels)).toBe('Codex');
    expect(recipientName('google', labels)).toBe('google');
    expect(grantTitle(grant({ grantId: 'g', dataKinds: ['document', 'transcript'] }), labels)).toBe('OpenAI · 文本与提示词、文稿与译文');
  });

  it('说明行：范围、预算、次数、用量、来源、到期', () => {
    expect(grantFacts(grant({ grantId: 'g' }), null)).toBe('全部视频 · 金额未知，只按次数计 · 次数不限 · 还没用过 · 启用服务商时默认发放');
    const capped = grant({
      grantId: 'c',
      scope: { videoId: 'v1' },
      budgetMode: 'estimate-cap',
      budgetCap: { amount: '5.00', currency: 'USD' },
      maxCalls: 20,
      origin: 'approval',
      expiresAt: '2026-10-05T12:00:00',
      usage: { calls: 3, reservedCalls: 1, amount: '0.42', reservedAmount: '0.10', unknownCostCalls: 0 },
    });
    expect(grantFacts(capped, '访谈')).toBe(
      '只限视频「访谈」 · 金额上限 5.00 USD · 最多 20 次 · 已用 3 次（0.42 USD），1 次进行中（预留 0.10 USD） · 审批时发放 · 2026-10-05 到期',
    );
    expect(grantFacts({ ...capped, scope: { videoId: 'gone' } }, null)).toMatch(/^只限一个视频 · /);
    expect(grantFacts(grant({ grantId: 'o', once: true, maxCalls: 1, taskId: 't' }), null)).toContain('只限一个任务 · 金额未知，只按次数计 · 只这一次');
  });

  it('用量：金额未知的照写次数', () => {
    expect(usageLine(grant({ grantId: 'g', usage: { calls: 2, reservedCalls: 0, amount: null, reservedAmount: null, unknownCostCalls: 2 } }))).toBe(
      '已用 2 次，2 次金额未知',
    );
  });

  it('撤销：确认写清拦得住什么；结果照 Runtime 报的已交出部分说', () => {
    expect(revokeConfirmText(grant({ grantId: 'g' }))).toBe('撤销之后，用到这条授权的新调用和排队中的调用都会被拒绝。');
    expect(revokeConfirmText(grant({ grantId: 'g', usage: { calls: 3, reservedCalls: 1, amount: null, reservedAmount: null, unknownCostCalls: 0 } }))).toBe(
      '撤销之后，用到这条授权的新调用和排队中的调用都会被拒绝。正在执行的 1 次会照常结束；已经交出的 3 次调用的数据与可能产生的费用无法撤回。',
    );
    const g = grant({ grantId: 'g', state: 'revoked' });
    expect(revokeResultLine({ grant: g, alreadySent: { calls: 0, amount: null, unknownCostCalls: 0 }, runningJobs: [], note: '' })).toBe('已撤销');
    expect(
      revokeResultLine({
        grant: g,
        alreadySent: { calls: 3, amount: { amount: '0.42', currency: 'USD' }, unknownCostCalls: 1 },
        runningJobs: ['j1'],
        note: '',
      }),
    ).toBe('已撤销 · 之前交出过 3 次（0.42 USD，另有 1 次金额未知） · 1 个正在执行的任务照常结束');
  });
});
