import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView, ProviderCapabilityView } from '@baocut/protocol';
import { agentSwitchOf, agentSwitchProvider, agentSwitchRow, agentSwitchToast, CLAUDE_SWITCH, CODEX_SWITCH } from './agent-switch.ts';

function provider(patch: Partial<ProviderCapabilityView> = {}, enabled = false): ProviderCapabilityView {
  return {
    providerId: CODEX_SWITCH.providerId,
    kind: 'agent',
    label: 'Codex',
    config: { enabled, enabledAt: enabled ? '2026-10-03T00:00:00.000Z' : null, credential: 'none' },
    models: [],
    available: false,
    unavailableReason: 'not-configured',
    detail: '没有启用',
    ...patch,
  };
}

const codex = { id: 'codex', state: 'ready' } as const;

describe('agentSwitchProvider', () => {
  it('从图片生成的能力视图里取 agent:codex，没有时为 null', () => {
    const view = { generateImage: { default: null, effective: null, providers: [provider()] } } as unknown as ModelCapabilitiesView;
    expect(agentSwitchProvider(view, CODEX_SWITCH)?.providerId).toBe('agent:codex');
    expect(agentSwitchProvider({ generateImage: { default: null, effective: null, providers: [] } } as unknown as ModelCapabilitiesView, CODEX_SWITCH)).toBeNull();
    expect(agentSwitchProvider(null, CODEX_SWITCH)).toBeNull();
  });
});

describe('agentSwitchRow', () => {
  it('Codex 没装、不是 Codex、Runtime 没带这个 Provider 时不显示', () => {
    expect(agentSwitchRow(CODEX_SWITCH, provider(), { id: 'codex', state: 'not-installed' }, 'done')).toBeNull();
    expect(agentSwitchRow(CODEX_SWITCH, provider(), { id: 'claude', state: 'ready' }, 'done')).toBeNull();
    expect(agentSwitchRow(CODEX_SWITCH, null, codex, 'done')).toBeNull();
  });

  it('没启用也没探测过：只知道「没有启用」，先不让拨', () => {
    expect(agentSwitchRow(CODEX_SWITCH, provider(), codex, 'pending')).toEqual({ enabled: false, ready: false, canEnable: false, checking: true, why: null });
  });

  it('探测过、只差没启用：可以打开', () => {
    expect(agentSwitchRow(CODEX_SWITCH, provider(), codex, 'done')).toEqual({ enabled: false, ready: false, canEnable: true, checking: false, why: null });
  });

  it('探测失败：不说能打开，给一句怎么办', () => {
    const row = agentSwitchRow(CODEX_SWITCH, provider(), codex, 'failed');
    expect(row?.canEnable).toBe(false);
    expect(row?.checking).toBe(false);
    expect(row?.why).toContain('重新检测');
  });

  it('没登录：不能打开，说要登录', () => {
    const row = agentSwitchRow(CODEX_SWITCH, provider({ unavailableReason: 'signed-out', detail: '没有登录' }), { id: 'codex', state: 'signed-out' }, 'done');
    expect(row).toMatchObject({ enabled: false, canEnable: false, checking: false });
    expect(row?.why).toContain('登录');
  });

  it('版本太旧：原因整句用 Provider 的 detail（最低版本在里面，界面不写死）', () => {
    const detail = 'Codex 的版本是 0.150.0，至少要 0.158.0：升级 Codex CLI（例如 npm install -g @openai/codex@latest），然后重新检查';
    const row = agentSwitchRow(CODEX_SWITCH, provider({ unavailableReason: 'outdated', detail }), codex, 'done');
    expect(row?.canEnable).toBe(false);
    expect(row?.why).toBe(`${detail}。`);
  });

  it('其他不可用：带上 detail', () => {
    const row = agentSwitchRow(CODEX_SWITCH, provider({ unavailableReason: 'unsupported', detail: '没有拿到 Codex 的状态' }), codex, 'done');
    expect(row?.why).toBe('Codex 现在画不了图 · 没有拿到 Codex 的状态。');
  });

  it('开着且能用：已打开', () => {
    const row = agentSwitchRow(CODEX_SWITCH, provider({ available: true, unavailableReason: undefined, detail: undefined }, true), codex, 'pending');
    expect(row).toEqual({ enabled: true, ready: true, canEnable: true, checking: false, why: null });
  });

  it('能用但没开：可以打开，没有「已打开」', () => {
    const row = agentSwitchRow(CODEX_SWITCH, provider({ available: true, unavailableReason: undefined }, false), codex, 'pending');
    expect(row).toMatchObject({ enabled: false, ready: false, canEnable: true, why: null });
  });

  it('开着却画不了（后来退出登录）：原因照说，开关仍是开着的（让用户关得掉）', () => {
    const row = agentSwitchRow(CODEX_SWITCH, provider({ unavailableReason: 'signed-out', detail: '没有登录' }, true), { id: 'codex', state: 'signed-out' }, 'pending');
    expect(row).toMatchObject({ enabled: true, ready: false, canEnable: false, checking: false });
    expect(row?.why).toContain('登录');
  });
});

describe('agentSwitchToast', () => {
  it('打开与关闭各一句', () => {
    expect(agentSwitchToast(CODEX_SWITCH, true)).toContain('已打开 Codex 画图');
    expect(agentSwitchToast(CODEX_SWITCH, false)).toBe('已关闭 Codex 画图和写文字');
  });
});

describe('Claude Code 的开关', () => {
  const claude = { id: 'claude', state: 'ready' } as const;
  const textProvider = (patch: Partial<ProviderCapabilityView> = {}, enabled = false) =>
    provider({ providerId: CLAUDE_SWITCH.providerId, label: 'Claude Code', ...patch }, enabled);

  it('只有 Codex 与 Claude Code 有开关', () => {
    expect(agentSwitchOf('codex')).toBe(CODEX_SWITCH);
    expect(agentSwitchOf('claude')).toBe(CLAUDE_SWITCH);
    expect(agentSwitchOf('opencode')).toBeNull();
  });

  it('看文本生成的视图：图片生成里没有它', () => {
    const view = {
      generateImage: { default: null, effective: null, providers: [provider()] },
      generateText: { default: null, effective: null, providers: [provider(), textProvider()] },
    } as unknown as ModelCapabilitiesView;
    expect(agentSwitchProvider(view, CLAUDE_SWITCH)?.providerId).toBe('agent:claude');
    expect(agentSwitchProvider(view, CLAUDE_SWITCH, 'generateImage')).toBeNull();
  });

  it('原因写 Claude Code 自己的，不写画图', () => {
    expect(agentSwitchRow(CLAUDE_SWITCH, textProvider({ unavailableReason: 'signed-out' }), claude, 'done')?.why).toBe(CLAUDE_SWITCH.copy.signedOut);
    expect(agentSwitchRow(CLAUDE_SWITCH, textProvider({ unavailableReason: 'unsupported', detail: '状态未知' }), claude, 'done')?.why).toBe(
      CLAUDE_SWITCH.copy.unavailable('状态未知。'),
    );
    expect(agentSwitchRow(CLAUDE_SWITCH, textProvider(), claude, 'failed')?.why).toBe(CLAUDE_SWITCH.copy.probeFailed);
    expect(agentSwitchToast(CLAUDE_SWITCH, true)).toBe(CLAUDE_SWITCH.copy.turnedOn);
  });

  it('不是它的 Driver、没装时没有这一行', () => {
    expect(agentSwitchRow(CLAUDE_SWITCH, textProvider(), { id: 'codex', state: 'ready' }, 'done')).toBeNull();
    expect(agentSwitchRow(CLAUDE_SWITCH, textProvider(), { id: 'claude', state: 'not-installed' }, 'done')).toBeNull();
  });
});
