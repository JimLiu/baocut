import { describe, expect, it } from 'vitest';
import { WORKSPACE_OVERLAY_ATTRIBUTE, createWorkspaceOverlays } from './workspace-overlay.ts';

function fakeBody() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

describe('功能区覆盖层登记', () => {
  it('有覆盖层登记着时 body 带标记，全部撤销后去掉', () => {
    const body = fakeBody();
    const overlays = createWorkspaceOverlays(() => body);
    expect(body.attributes.has(WORKSPACE_OVERLAY_ATTRIBUTE)).toBe(false);
    const peek = overlays.register();
    const card = overlays.register();
    expect(body.attributes.has(WORKSPACE_OVERLAY_ATTRIBUTE)).toBe(true);
    peek();
    expect(body.attributes.has(WORKSPACE_OVERLAY_ATTRIBUTE)).toBe(true);
    card();
    expect(body.attributes.has(WORKSPACE_OVERLAY_ATTRIBUTE)).toBe(false);
    expect(overlays.count()).toBe(0);
  });

  it('撤销函数重复调用只撤销一次，不会提前去掉别人的标记', () => {
    const body = fakeBody();
    const overlays = createWorkspaceOverlays(() => body);
    const drag = overlays.register();
    const peek = overlays.register();
    drag();
    drag();
    expect(overlays.count()).toBe(1);
    expect(body.attributes.has(WORKSPACE_OVERLAY_ATTRIBUTE)).toBe(true);
    peek();
    expect(body.attributes.has(WORKSPACE_OVERLAY_ATTRIBUTE)).toBe(false);
  });

  it('没有 document 时（Node）只计数', () => {
    const overlays = createWorkspaceOverlays(() => null);
    const release = overlays.register();
    expect(overlays.count()).toBe(1);
    release();
    expect(overlays.count()).toBe(0);
  });
});
