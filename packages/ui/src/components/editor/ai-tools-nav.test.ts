import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiToolAgentRun, syncAiToolAgentRuns, useAiToolAgentRuns } from './ai-tools-nav.ts';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

const KEY = 'baocut.ai-tool-agent-runs';
const run = { conversationId: 'c1', taskId: 't1', handedAt: '2026-10-10T08:00:00Z' };

/** 模拟重启：存下的原样留着，内存里清空，再从本机读回来。 */
async function restart() {
  const saved = localStorage.getItem(KEY);
  useAiToolAgentRuns.setState({ runs: {} });
  if (saved) localStorage.setItem(KEY, saved);
  await useAiToolAgentRuns.persist.rehydrate();
}

describe('留在原地的工具页：重启后接上', () => {
  beforeEach(async () => {
    useAiToolAgentRuns.setState({ runs: {} });
    localStorage.removeItem(KEY);
    await useAiToolAgentRuns.persist.rehydrate();
  });

  it('这次交出去的不带 restored；重启后读回来的都标上', async () => {
    setAiToolAgentRun('aitool:v1:cleanup', run);
    expect(useAiToolAgentRuns.getState().runs['aitool:v1:cleanup']).toEqual(run);
    await restart();
    expect(useAiToolAgentRuns.getState().runs['aitool:v1:cleanup']).toEqual({ ...run, restored: true });
  });

  it('目录读到后：任务还在跑的接上，跑完的丢掉', async () => {
    setAiToolAgentRun('aitool:v1:cleanup', run);
    setAiToolAgentRun('aitool:v1:stale', { ...run, conversationId: 'c2', taskId: 't2' });
    await restart();
    const conversations = [
      { id: 'c1', activeTaskId: 't1' },
      { id: 'c2', activeTaskId: null },
    ];
    syncAiToolAgentRuns({ ready: false, conversations, queued: () => false });
    expect(Object.values(useAiToolAgentRuns.getState().runs).every((r) => r.restored)).toBe(true);
    syncAiToolAgentRuns({ ready: true, conversations, queued: () => false });
    expect(useAiToolAgentRuns.getState().runs).toEqual({ 'aitool:v1:cleanup': run });
  });

  it('形状不对的记录读回来时丢掉', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { runs: { a: { conversationId: 1 }, b: run } }, version: 1 }));
    await useAiToolAgentRuns.persist.rehydrate();
    expect(useAiToolAgentRuns.getState().runs).toEqual({ b: { ...run, restored: true } });
  });
});
