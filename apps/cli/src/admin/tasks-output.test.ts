import { describe, expect, it } from 'vitest';
import type { TaskContract, TaskContractView } from '@baocut/protocol';
import { formatContract, formatContractHistory, formatContractList, parseTasksArgs } from './tasks-output.ts';

function contract(patch: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'task_1',
    revision: 2,
    conversationId: 'conv_1',
    videoId: 'vid_1',
    baseVideoRevision: '7',
    goal: '把开头剪短',
    scope: { videoId: 'vid_1', videoRevision: '7', sequenceId: null, itemIds: ['itm_1'], timeRange: null },
    constraints: [{ constraintId: 'cons_1', kind: 'style', text: '字幕不超过两行' }],
    protectedRefs: [
      {
        protectionId: 'prot_1',
        videoId: 'vid_1',
        target: { kind: 'interval', sequenceId: 'seq_1', span: { fromFrame: 0, durationFrames: 90 }, trackIds: ['trk_1'] },
        origin: { by: 'user', revision: 2, at: '2026-10-01T00:00:00.000Z' },
        note: '片头',
      },
    ],
    deliverables: [{ kind: 'video-change', requiredStage: 'committed' }],
    autonomy: 'ask',
    permissionScopeRef: 'prj_1',
    budgetPolicyRef: 'tbp_1',
    acceptanceChecks: [{ checkId: 'check_1', kind: 'review', description: '字幕和口播对得上', required: true }],
    supersedes: null,
    change: { by: 'user', reason: 'updated', fields: ['protectedRefs'], at: '2026-10-01T00:00:00.000Z' },
    ...patch,
  };
}

const view: TaskContractView = {
  contract: contract(),
  latestRevision: 3,
  budget: {
    policyId: 'tbp_1',
    taskId: 'task_1',
    maxCalls: 5,
    cap: { amount: '2.00', currency: 'USD' },
    usage: {
      calls: 2,
      reservedCalls: 1,
      spent: [{ amount: '0.30', currency: 'USD' }],
      reserved: [{ amount: '0.10', currency: 'USD' }],
      unknownCostCalls: 0,
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
};

describe('baocut tasks', () => {
  it('参数：contract 可带修订号，history，list 要会话', () => {
    expect(parseTasksArgs(['contract', 'task_1'], {})).toEqual({ kind: 'contract', taskId: 'task_1' });
    expect(parseTasksArgs(['contract', 'task_1'], { revision: '2' })).toEqual({ kind: 'contract', taskId: 'task_1', revision: 2 });
    expect(parseTasksArgs(['history', 'task_1'], {})).toEqual({ kind: 'history', taskId: 'task_1' });
    expect(parseTasksArgs(['list'], { conversation: 'conv_1' })).toEqual({ kind: 'list', conversationId: 'conv_1' });
    expect(() => parseTasksArgs(['contract'], {})).toThrow('用法');
    expect(() => parseTasksArgs(['contract', 'task_1'], { revision: '0' })).toThrow('--revision');
    expect(() => parseTasksArgs(['list'], {})).toThrow('用法');
    expect(() => parseTasksArgs(['update', 'task_1'], {})).toThrow('用法');
  });

  it('合同：全部字段、预算用量、保护与检查结果', () => {
    const lines = formatContract(view, [
      {
        resultId: 'chk_1',
        checkId: 'check_1',
        contractRevision: 2,
        outcome: 'passed',
        note: '逐句核对',
        recordedBy: 'agent',
        recordedAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    expect(lines[0]).toBe('任务 task_1  合同修订 2（最新是修订 3）  用户修改：protectedRefs，2026-10-01T00:00:00.000Z');
    expect(lines).toContain('目标：把开头剪短');
    expect(lines).toContain('预算：2+1 预留/5 次，已用 0.30 USD，预留 0.10 USD，上限 2.00 USD');
    expect(lines).toContain('  prot_1  视频 vid_1：序列 seq_1 的第 0–90 帧（轨道 trk_1）（片头）');
    expect(lines).toContain('  check_1  [review，必过] 字幕和口播对得上 — 通过（智能体记录：逐句核对）');
    expect(lines.some((l) => l.startsWith('访问模式：'))).toBe(true);
  });

  it('没有预算策略、没有保护与检查', () => {
    const lines = formatContract({
      contract: contract({ protectedRefs: [], acceptanceChecks: [], constraints: [], budgetPolicyRef: null }),
      latestRevision: 2,
      budget: null,
    });
    expect(lines[0]).toContain('（最新）');
    expect(lines).toEqual(expect.arrayContaining(['预算：不限（只受各授权的预算约束）', '约束：无', '不要改动：无', '验收检查：无']));
  });

  it('修订历史与会话的任务列表', () => {
    expect(formatContractHistory([contract({ revision: 1, change: { by: 'runtime', reason: 'created', fields: [], at: 't' } })])).toEqual([
      expect.stringContaining('修订 1  Runtime 默认建立，t'),
    ]);
    expect(formatContractList([contract()])[0]).toMatch(/^task_1 {2}修订 2 {2}/);
    expect(formatContractList([])).toEqual(['这个会话还没有任务']);
  });
});
