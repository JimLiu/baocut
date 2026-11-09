import { describe, expect, test } from 'vitest';
import { decideRuntimeReuse, idleExceptSeeker, mismatchFacts, sameRuntimeVersion, type FoundActivity, type FoundRuntime, type RuntimeIdentity } from './runtime-reuse.ts';

// CLI 独立使用与发布 §4.2 的组合：版本同或不同、空闲或忙、拉起者，桌面端与 CLI 各一遍。

const OWN: RuntimeIdentity = { runtimeVersion: '0.5.0', protocolVersion: '0.6', interfaceVersion: '2', build: 'abc1234' };
const SAME: FoundRuntime = { ...OWN, launchedBy: 'cli' };
const IDLE: FoundActivity = { connections: { desktop: 0, cli: 0, agent: 0 }, activeJobs: 0 };
const BUSY: FoundActivity = { ...IDLE, activeJobs: 2 };

function decide(seeker: 'desktop' | 'cli', found: FoundRuntime, activity: FoundActivity | null) {
  return decideRuntimeReuse({ seeker, own: OWN, found, activity }).action;
}

describe('1. 版本相同：复用', () => {
  test('桌面端：runtimeVersion 与 build 都相同', () => {
    expect(decide('desktop', SAME, null)).toBe('reuse');
    expect(decide('desktop', { ...SAME, launchedBy: null }, BUSY)).toBe('reuse');
  });

  test('桌面端：自己的 build 查不出时只比 runtimeVersion', () => {
    expect(sameRuntimeVersion('desktop', { ...OWN, build: null }, { ...SAME, build: 'other' })).toBe(true);
  });

  test('CLI：接口版本相同，runtimeVersion 与 build 不同也复用', () => {
    expect(decide('cli', { ...SAME, runtimeVersion: '0.4.0', build: 'old' }, null)).toBe('reuse');
  });
});

describe('2. 版本不同、CLI 拉起、空闲：替换', () => {
  test('桌面端：build 不同', () => {
    expect(decide('desktop', { ...SAME, build: 'old1234' }, IDLE)).toBe('replace');
  });

  test('桌面端：旧版 Runtime 的发现信息没有 build，按不同', () => {
    expect(decide('desktop', { ...SAME, build: undefined }, IDLE)).toBe('replace');
  });

  test('桌面端：自己的桌面端连接不算在用', () => {
    expect(decide('desktop', { ...SAME, runtimeVersion: '0.4.0' }, { ...IDLE, connections: { desktop: 2, cli: 0, agent: 0 } })).toBe('replace');
  });

  test('CLI：接口版本不同；发起方自己的那条 CLI 连接不算', () => {
    expect(decide('cli', { ...SAME, interfaceVersion: '1' }, { ...IDLE, connections: { desktop: 0, cli: 1, agent: 0 } })).toBe('replace');
  });

  test('CLI：旧版 Runtime 的发现信息没有 interfaceVersion，按不同', () => {
    expect(decide('cli', { ...SAME, interfaceVersion: undefined }, IDLE)).toBe('replace');
  });
});

describe('3. 版本不同、忙着或不是 CLI 拉起的', () => {
  test('CLI：有任务时拒绝', () => {
    expect(decide('cli', { ...SAME, interfaceVersion: '1' }, BUSY)).toBe('refuse');
  });

  test('CLI：有别的 CLI 连接或桌面端连着时拒绝', () => {
    expect(decide('cli', { ...SAME, interfaceVersion: '1' }, { ...IDLE, connections: { desktop: 0, cli: 2, agent: 0 } })).toBe('refuse');
    expect(decide('cli', { ...SAME, interfaceVersion: '1' }, { ...IDLE, connections: { desktop: 1, cli: 1, agent: 0 } })).toBe('refuse');
  });

  test('CLI：桌面端拉起的，空闲也不替换', () => {
    expect(decide('cli', { ...SAME, interfaceVersion: '1', launchedBy: null }, IDLE)).toBe('refuse');
  });

  test('CLI：问不到忙不忙（协议版本不同）时拒绝', () => {
    expect(decide('cli', { ...SAME, interfaceVersion: '1', protocolVersion: '0.5' }, null)).toBe('refuse');
  });

  test('桌面端，协议版本相同：忙着时先连上用', () => {
    expect(decide('desktop', { ...SAME, build: 'old1234' }, BUSY)).toBe('reuse-until-idle');
    expect(decide('desktop', { ...SAME, build: 'old1234' }, { ...IDLE, connections: { desktop: 1, cli: 1, agent: 0 } })).toBe('reuse-until-idle');
  });

  test('桌面端，协议版本相同：不是 CLI 拉起的，先连上用（不替换）', () => {
    expect(decide('desktop', { ...SAME, build: 'old1234', launchedBy: null }, IDLE)).toBe('reuse-until-idle');
  });

  test('桌面端，协议版本不同：不连，等它做完', () => {
    expect(decide('desktop', { ...SAME, protocolVersion: '0.5', runtimeVersion: '0.4.0' }, null)).toBe('wait');
    expect(decide('desktop', { ...SAME, protocolVersion: '0.5', runtimeVersion: '0.4.0', launchedBy: null }, null)).toBe('wait');
  });
});

describe('4. 协议版本不同：忙闲取自握手的拒绝（§4.3）', () => {
  test('任务数与连接数都在时才有忙闲；旧版没报的、不成形的那项是 null', () => {
    expect(mismatchFacts({ runtime: '0.5', launchedBy: 'cli', activeJobs: 0, connections: IDLE.connections })).toEqual({ activeJobs: 0, activity: IDLE });
    expect(mismatchFacts({ launchedBy: 'cli', activeJobs: 2 })).toEqual({ activeJobs: 2, activity: null });
    expect(mismatchFacts({ activeJobs: -1, connections: IDLE.connections })).toEqual({ activeJobs: null, activity: null });
    expect(mismatchFacts({ activeJobs: 0, connections: { desktop: 0, cli: '1', agent: 0 } })).toEqual({ activeJobs: 0, activity: null });
    expect(mismatchFacts(undefined)).toEqual({ activeJobs: null, activity: null });
  });

  test('CLI：发起方没握上手，不在连接数里，一条 CLI 连接也算在用', () => {
    const found = { ...SAME, protocolVersion: '0.5', interfaceVersion: '1' };
    const input = { seeker: 'cli' as const, own: OWN, found, seekerCounted: false };
    expect(decideRuntimeReuse({ ...input, activity: IDLE }).action).toBe('replace');
    expect(decideRuntimeReuse({ ...input, activity: { ...IDLE, connections: { desktop: 0, cli: 1, agent: 0 } } }).action).toBe('refuse');
    expect(decideRuntimeReuse({ ...input, activity: null }).action).toBe('refuse');
  });
});

test('空闲的判断与 runtime.stop 的拒绝条件一致', () => {
  expect(idleExceptSeeker('cli', { ...IDLE, connections: { desktop: 0, cli: 1, agent: 3 } })).toBe(true);
  expect(idleExceptSeeker('desktop', { ...IDLE, connections: { desktop: 3, cli: 0, agent: 0 } })).toBe(true);
  expect(idleExceptSeeker('desktop', { ...IDLE, connections: { desktop: 0, cli: 1, agent: 0 } })).toBe(false);
  expect(idleExceptSeeker('desktop', BUSY)).toBe(false);
});
