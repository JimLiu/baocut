import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView, ProviderCapabilityView } from '@baocut/protocol';
import { CODEX_IMAGE_PROVIDER, codexImageProvider, codexImageRow, codexImageToast } from './codex-image.ts';

function provider(patch: Partial<ProviderCapabilityView> = {}, enabled = false): ProviderCapabilityView {
  return {
    providerId: CODEX_IMAGE_PROVIDER,
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

describe('codexImageProvider', () => {
  it('从图片生成的能力视图里取 agent:codex，没有时为 null', () => {
    const view = { generateImage: { default: null, effective: null, providers: [provider()] } } as unknown as ModelCapabilitiesView;
    expect(codexImageProvider(view)?.providerId).toBe('agent:codex');
    expect(codexImageProvider({ generateImage: { default: null, effective: null, providers: [] } } as unknown as ModelCapabilitiesView)).toBeNull();
    expect(codexImageProvider(null)).toBeNull();
  });
});

describe('codexImageRow', () => {
  it('Codex 没装、不是 Codex、Runtime 没带这个 Provider 时不显示', () => {
    expect(codexImageRow(provider(), { id: 'codex', state: 'not-installed' }, 'done')).toBeNull();
    expect(codexImageRow(provider(), { id: 'claude', state: 'ready' }, 'done')).toBeNull();
    expect(codexImageRow(null, codex, 'done')).toBeNull();
  });

  it('没启用也没探测过：只知道「没有启用」，先不让拨', () => {
    expect(codexImageRow(provider(), codex, 'pending')).toEqual({ enabled: false, ready: false, canEnable: false, checking: true, why: null });
  });

  it('探测过、只差没启用：可以打开', () => {
    expect(codexImageRow(provider(), codex, 'done')).toEqual({ enabled: false, ready: false, canEnable: true, checking: false, why: null });
  });

  it('探测失败：不说能打开，给一句怎么办', () => {
    const row = codexImageRow(provider(), codex, 'failed');
    expect(row?.canEnable).toBe(false);
    expect(row?.checking).toBe(false);
    expect(row?.why).toContain('重新检测');
  });

  it('没登录：不能打开，说要登录', () => {
    const row = codexImageRow(provider({ unavailableReason: 'signed-out', detail: '没有登录' }), { id: 'codex', state: 'signed-out' }, 'done');
    expect(row).toMatchObject({ enabled: false, canEnable: false, checking: false });
    expect(row?.why).toContain('登录');
  });

  it('版本太旧：原因整句用 Provider 的 detail（最低版本在里面，界面不写死）', () => {
    const detail = 'Codex 的版本是 0.150.0，至少要 0.158.0：升级 Codex CLI（例如 npm install -g @openai/codex@latest），然后重新检查';
    const row = codexImageRow(provider({ unavailableReason: 'outdated', detail }), codex, 'done');
    expect(row?.canEnable).toBe(false);
    expect(row?.why).toBe(`${detail}。`);
  });

  it('其他不可用：带上 detail', () => {
    const row = codexImageRow(provider({ unavailableReason: 'unsupported', detail: '没有拿到 Codex 的状态' }), codex, 'done');
    expect(row?.why).toBe('Codex 现在画不了图 · 没有拿到 Codex 的状态。');
  });

  it('开着且能用：已打开', () => {
    const row = codexImageRow(provider({ available: true, unavailableReason: undefined, detail: undefined }, true), codex, 'pending');
    expect(row).toEqual({ enabled: true, ready: true, canEnable: true, checking: false, why: null });
  });

  it('能用但没开：可以打开，没有「已打开」', () => {
    const row = codexImageRow(provider({ available: true, unavailableReason: undefined }, false), codex, 'pending');
    expect(row).toMatchObject({ enabled: false, ready: false, canEnable: true, why: null });
  });

  it('开着却画不了（后来退出登录）：原因照说，开关仍是开着的（让用户关得掉）', () => {
    const row = codexImageRow(provider({ unavailableReason: 'signed-out', detail: '没有登录' }, true), { id: 'codex', state: 'signed-out' }, 'pending');
    expect(row).toMatchObject({ enabled: true, ready: false, canEnable: false, checking: false });
    expect(row?.why).toContain('登录');
  });
});

describe('codexImageToast', () => {
  it('打开与关闭各一句', () => {
    expect(codexImageToast(true)).toContain('已打开 Codex 画图');
    expect(codexImageToast(false)).toBe('已关闭 Codex 画图');
  });
});
