import { describe, expect, it } from 'vitest';
import type { PendingApproval } from '@baocut/protocol';
import { describeApprovalRequest, formatApprovals, formatMode, parseApprovalsArgs, parseModeOption } from './approvals-output.ts';

describe('--mode', () => {
  it('连字符写法对应协议里的值，不给时为 undefined', () => {
    expect(parseModeOption('ask')).toBe('ask');
    expect(parseModeOption('auto-accept-edits')).toBe('autoAcceptEdits');
    expect(parseModeOption('auto')).toBe('auto');
    expect(parseModeOption('full-access')).toBe('fullAccess');
    expect(parseModeOption('plan')).toBe('plan');
    expect(parseModeOption(undefined)).toBeUndefined();
  });

  it('不认识的值报错（旧值 controlled、authorized 不再接受）', () => {
    expect(() => parseModeOption('yolo')).toThrow(/不认识的访问模式：yolo/);
    expect(() => parseModeOption('controlled')).toThrow(/不认识的访问模式/);
  });

  it('给人看的写法', () => {
    expect(formatMode('autoAcceptEdits')).toBe('自动接受修改（auto-accept-edits）');
    expect(formatMode('auto')).toBe('自动（auto）');
  });
});

describe('baocut approvals 的参数', () => {
  it('list、allow、deny', () => {
    expect(parseApprovalsArgs([])).toEqual({ kind: 'list' });
    expect(parseApprovalsArgs(['list'])).toEqual({ kind: 'list' });
    expect(parseApprovalsArgs(['allow', 'apv_1'])).toEqual({ kind: 'respond', approvalId: 'apv_1', decision: 'allow' });
    expect(parseApprovalsArgs(['deny', 'sap_2'])).toEqual({ kind: 'respond', approvalId: 'sap_2', decision: 'deny' });
  });

  it('缺参数或多余参数给出用法', () => {
    expect(() => parseApprovalsArgs(['allow'])).toThrow(/用法/);
    expect(() => parseApprovalsArgs(['deny', 'a', 'b'])).toThrow(/用法/);
    expect(() => parseApprovalsArgs(['list', 'x'])).toThrow(/用法/);
    expect(() => parseApprovalsArgs(['accept', 'a'])).toThrow(/用法/);
  });
});

describe('baocut approvals 的输出', () => {
  const now = Date.parse('2026-10-03T00:00:00.000Z');
  const conversation: PendingApproval = {
    approvalId: 'apv_1',
    subject: { kind: 'conversation', conversationId: 'conv_1', conversationTitle: '剪片头', projectId: null, taskId: 'task_1' },
    action: { kind: 'tool', name: 'artifacts_save', targets: ['out/a.png'], summary: '覆盖已有文件 out/a.png' },
    risk: 'high',
    basis: { kind: 'mode', mode: 'auto' },
    createdAt: '2026-10-03T00:00:00.000Z',
    expiresAt: null,
  };
  const service: PendingApproval = {
    approvalId: 'sap_2',
    subject: { kind: 'service', serviceId: 'mcp', clientId: 'cli_1', clientName: 'Claude Desktop' },
    action: { kind: 'tool', name: 'edits_apply', targets: ['demo'], summary: '删掉 3 段' },
    risk: 'edit',
    basis: { kind: 'service', level: 'ask' },
    createdAt: '2026-10-03T00:00:00.000Z',
    expiresAt: '2026-10-03T00:00:50.000Z',
  };

  it('一条一行：来自谁、动作、风险、依据与时限', () => {
    expect(formatApprovals([conversation, service], now)).toEqual([
      'apv_1  会话「剪片头」  artifacts_save → out/a.png  [高风险] 覆盖已有文件 out/a.png（模式 自动（auto））',
      'sap_2  服务 mcp · Claude Desktop  edits_apply → demo  [修改] 删掉 3 段（等级 ask，50 秒后按拒绝处理）',
    ]);
  });

  it('没有待处理的', () => {
    expect(formatApprovals([])).toEqual(['没有待处理的审批']);
  });

  it('会话里的审批提示', () => {
    expect(describeApprovalRequest({ kind: 'command', command: 'ls', cwd: '/p', reason: null })).toBe('运行命令：ls');
    expect(describeApprovalRequest({ kind: 'file-change', files: ['a.ts', 'b.ts'], reason: null })).toBe('修改文件：a.ts, b.ts');
    expect(describeApprovalRequest({ kind: 'tool', tool: 'jobs_cancel', files: [], reason: '取消任务 job_1' })).toBe('调用 jobs_cancel');
    expect(describeApprovalRequest({ kind: 'tool', tool: 'edits_apply', files: ['demo'], reason: null })).toBe('调用 edits_apply：demo');
  });
});
