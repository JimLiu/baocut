import { describe, expect, it } from 'vitest';
import type { AgentSetupRun } from '@baocut/protocol';
import { agentSetupTaskRow, setupFailureReason, setupTaskId } from './agent-setup-task.ts';

const run = (over: Partial<AgentSetupRun> = {}): AgentSetupRun => ({
  runId: 'run_1',
  driverId: 'codex',
  action: 'install',
  kind: 'npm',
  command: 'npm install -g @openai/codex',
  state: 'running',
  exitCode: null,
  output: [],
  droppedLines: 0,
  startedAt: '2026-10-16T10:00:00.000Z',
  endedAt: null,
  error: null,
  ...over,
});

describe('Agent 安装在后台任务里的那一行', () => {
  it('在跑：转圈、能停，标题写装的是哪家，在哪写实际运行的命令', () => {
    const row = agentSetupTaskRow(run(), 'Codex CLI');
    expect(row).toMatchObject({
      id: setupTaskId('run_1'),
      origin: 'agent-setup',
      kind: 'agentInstall',
      title: '安装 Agent · Codex CLI',
      where: 'npm install -g @openai/codex · 本机',
      live: true,
      tone: 'accent',
      progress: 'indet',
      pct: null,
      action: { type: 'cancelSetup', runId: 'run_1' },
      error: null,
    });
  });

  it('跑完：成功、停止、失败各一种色调；失败写退出码或没能启动的原因', () => {
    const done = agentSetupTaskRow(run({ state: 'completed', exitCode: 0, endedAt: '2026-10-16T10:01:00.000Z' }), 'Codex CLI');
    expect(done).toMatchObject({ live: false, tone: 'positive', progress: null, action: null, error: null });
    expect(agentSetupTaskRow(run({ state: 'cancelled' }), 'Codex CLI').tone).toBe('neutral');
    const failed = agentSetupTaskRow(run({ state: 'failed', exitCode: 1, action: 'upgrade' }), 'Codex CLI');
    expect(failed).toMatchObject({ kind: 'agentUpgrade', title: '升级 Agent · Codex CLI', tone: 'negative' });
    expect(failed.error).toContain(setupFailureReason({ exitCode: 1, error: null }));
    expect(setupFailureReason({ exitCode: null, error: 'spawn npm ENOENT' })).toContain('spawn npm ENOENT');
  });
});
