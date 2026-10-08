import { afterEach, describe, expect, it } from 'vitest';
import type { AgentsView, DriverInfo } from '@baocut/protocol';
import { defaultDriver, useConnection } from './connection-store.ts';

const driver = (id: 'claude' | 'codex', isDefault = false) => ({ id, isDefault }) as DriverInfo;

describe('连接镜像里的 Agent 列表', () => {
  afterEach(() => useConnection.setState({ drivers: null, checking: [], agentPreferences: null }));

  it('setAgents 整份替换：探测结果、首次探测中的 Driver 与偏好', () => {
    const preferences = { drivers: {}, rules: [] } as unknown as AgentsView['preferences'];
    useConnection.getState().setAgents({ drivers: [], checking: ['claude', 'codex'], preferences });
    expect(useConnection.getState()).toMatchObject({ drivers: [], checking: ['claude', 'codex'], agentPreferences: preferences });
    useConnection.getState().setAgents({ drivers: [driver('codex', true)], checking: ['claude'], preferences });
    expect(useConnection.getState()).toMatchObject({ drivers: [{ id: 'codex' }], checking: ['claude'] });
  });

  it('defaultDriver：标了默认的优先；没标默认、又有在检测的，先不下结论', () => {
    expect(defaultDriver(null, [])).toBeNull();
    expect(defaultDriver([driver('claude'), driver('codex', true)], ['claude'])?.id).toBe('codex');
    // 默认的那个多半还在检测：不拿第一个顶上。
    expect(defaultDriver([driver('claude')], ['codex'])).toBeNull();
    expect(defaultDriver([driver('claude'), driver('codex')], [])?.id).toBe('claude');
  });
});
