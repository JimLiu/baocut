import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalSubject } from '@baocut/protocol';
import { ApprovalService, type ApprovalRequestInput, type ApprovalServiceEvent } from './approval-service.ts';

const conversation: ApprovalSubject = {
  kind: 'conversation',
  conversationId: 'conv_1',
  conversationTitle: 't',
  projectId: null,
  taskId: 'task_1',
};
const service: ApprovalSubject = { kind: 'service', serviceId: 'mcp', clientId: 'cli_1', clientName: 'Claude Desktop' };

function input(patch: Partial<ApprovalRequestInput> = {}): ApprovalRequestInput {
  return {
    subject: conversation,
    action: { kind: 'tool', name: 'edits_apply', targets: ['a.bcut'], summary: '加轨道' },
    risk: 'edit',
    basis: { kind: 'mode', mode: 'ask' },
    timeoutMs: null,
    ...patch,
  };
}

describe('ApprovalService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('查表：会话按模式，对外服务按等级', () => {
    const approvals = new ApprovalService();
    expect(approvals.decide({ kind: 'mode', mode: 'autoAcceptEdits' }, 'edit')).toBe('allow');
    expect(approvals.decide({ kind: 'mode', mode: 'autoAcceptEdits' }, 'command')).toBe('ask');
    expect(approvals.decide({ kind: 'mode', mode: 'plan' }, 'edit')).toBe('deny');
    expect(approvals.decide({ kind: 'service', level: 'ask' }, 'edit')).toBe('ask');
    expect(approvals.decide({ kind: 'service', level: 'auto' }, 'high')).toBe('allow');
    expect(approvals.decide({ kind: 'service', level: 'read' }, 'edit')).toBe('deny');
    expect(approvals.decide({ kind: 'service', level: 'read' }, 'read')).toBe('allow');
  });

  it('待处理、允许（含 forSession）与拒绝；结束时先同步调用 onSettled，再通知；处理过的再处理是 already-resolved', async () => {
    const approvals = new ApprovalService();
    const events: ApprovalServiceEvent[] = [];
    approvals.subscribe((event) => events.push(event));
    const order: string[] = [];
    approvals.subscribe((event) => order.push(`event:${event.type}`));

    const first = approvals.request(input({ approvalId: 'ap1', onSettled: (r) => order.push(`settled:${r.outcome}`) }));
    expect(first.approvalId).toBe('ap1');
    expect(approvals.pending()).toEqual([
      expect.objectContaining({ approvalId: 'ap1', risk: 'edit', expiresAt: null, subject: conversation }),
    ]);
    // 同一个号已被占用：另起一个。
    const second = approvals.request(input({ approvalId: 'ap1' }));
    expect(second.approvalId).not.toBe('ap1');
    expect(second.approvalId).toMatch(/^apv_/);

    expect(approvals.respond('ap1', 'allow', { forSession: true })).toEqual({ status: 'allowed' });
    expect(await first.resolution).toEqual({ outcome: 'allowed', forSession: true });
    expect(order).toEqual(['event:requested', 'event:requested', 'settled:allowed', 'event:resolved']);
    expect(approvals.respond('ap1', 'deny')).toEqual({ status: 'already-resolved' });

    expect(approvals.respond(second.approvalId, 'deny', { forSession: true })).toEqual({ status: 'denied' });
    expect(await second.resolution).toEqual({ outcome: 'denied', forSession: false });
    expect(approvals.pending()).toEqual([]);
    expect(events.filter((e) => e.type === 'resolved').map((e) => e.type === 'resolved' && e.outcome)).toEqual(['allowed', 'denied']);
    expect(approvals.respond('missing', 'allow')).toEqual({ status: 'already-resolved' });
  });

  it('带外发授权的审批（§12.5）：列出要授权的数据；允许时带回选择（默认只这一次）；不能「这个任务里不再问」；不涉及外发的不收选择', async () => {
    const approvals = new ApprovalService();
    const grants = [
      {
        capability: 'synthesizeSpeech' as const,
        dataKinds: ['document' as const],
        recipient: 'openai',
        videoId: null,
        purpose: '配音',
        reason: 'none' as const,
        cost: 'unknown' as const,
        estimate: null,
        maxCalls: null,
      },
    ];
    const outbound = approvals.request(input({ approvalId: 'out1', risk: 'high', grants }));
    expect(approvals.get('out1')?.grants).toEqual(grants);
    expect(approvals.respond('out1', 'allow', { forSession: true, grant: { persist: true, scope: 'all', maxCalls: 3 } })).toEqual({
      status: 'allowed',
    });
    expect(await outbound.resolution).toEqual({
      outcome: 'allowed',
      forSession: false,
      grant: { persist: true, scope: 'all', maxCalls: 3 },
    });

    const plain = approvals.request(input({ approvalId: 'out2', risk: 'high', grants }));
    approvals.respond('out2', 'allow');
    expect(await plain.resolution).toEqual({ outcome: 'allowed', forSession: false, grant: { persist: false } });

    const denied = approvals.request(input({ approvalId: 'out3', risk: 'high', grants }));
    approvals.respond('out3', 'deny', { grant: { persist: true } });
    expect(await denied.resolution).toEqual({ outcome: 'denied', forSession: false });

    approvals.request(input({ approvalId: 'local' }));
    expect(() => approvals.respond('local', 'allow', { grant: { persist: false } })).toThrow(/不涉及数据外发/);
    expect(approvals.get('local')).not.toBeNull();
    expect(approvals.get('local')?.grants).toBeUndefined();
  });

  it('会话审批没有时限；服务审批到时按 timeout 结束', async () => {
    vi.useFakeTimers();
    const approvals = new ApprovalService();
    const conv = approvals.request(input());
    const svc = approvals.request(input({ subject: service, basis: { kind: 'service', level: 'ask' }, timeoutMs: 50_000 }));
    const pending = approvals.get(svc.approvalId)!;
    expect(Date.parse(pending.expiresAt!) - Date.parse(pending.createdAt)).toBe(50_000);
    vi.advanceTimersByTime(50_000);
    expect(await svc.resolution).toEqual({ outcome: 'timeout', forSession: false });
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(approvals.pending().map((a) => a.approvalId)).toEqual([conv.approvalId]);
  });

  it('取消：单条、按条件、中止信号；已中止的信号直接取消，不进列表', async () => {
    const approvals = new ApprovalService();
    const one = approvals.request(input());
    const svcA = approvals.request(input({ subject: service, timeoutMs: 1000 }));
    const svcB = approvals.request(input({ subject: service, timeoutMs: 1000 }));
    const controller = new AbortController();
    const aborted = approvals.request(input({ signal: controller.signal }));

    expect(approvals.cancel(one.approvalId)).toBe(true);
    expect(approvals.cancel(one.approvalId)).toBe(false);
    expect(await one.resolution).toEqual({ outcome: 'cancelled', forSession: false });

    expect(approvals.cancelWhere((a) => a.subject.kind === 'service')).toBe(2);
    expect((await svcA.resolution).outcome).toBe('cancelled');
    expect((await svcB.resolution).outcome).toBe('cancelled');

    controller.abort();
    expect((await aborted.resolution).outcome).toBe('cancelled');
    expect(approvals.pending()).toEqual([]);

    const settled: string[] = [];
    const early = approvals.request(input({ signal: AbortSignal.abort(), onSettled: (r) => settled.push(r.outcome) }));
    expect(await early.resolution).toEqual({ outcome: 'cancelled', forSession: false });
    expect(settled).toEqual(['cancelled']);
    expect(approvals.pending()).toEqual([]);
  });

  it('onSettled 或订阅方出错不影响结局', async () => {
    const approvals = new ApprovalService();
    approvals.subscribe(() => {
      throw new Error('listener');
    });
    const { approvalId, resolution } = approvals.request(input({ onSettled: () => {} }));
    expect(approvals.respond(approvalId, 'allow')).toEqual({ status: 'allowed' });
    expect((await resolution).outcome).toBe('allowed');
  });
});
