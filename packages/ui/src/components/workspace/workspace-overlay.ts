import { useLayoutEffect } from 'react';

/**
 * 盖在功能区上、但不是模态的覆盖层的登记（Electron 的内嵌网页视图据此让开）。
 *
 * 原生网页视图（宿主的 `WebContentsView`）永远画在渲染进程的 DOM 之上，DOM 里的浮层压不住它。菜单、模态框与 Popover
 * 会给其余节点加 aria-hidden / inert，`workspace-panes.tsx` 的 `useCovered` 据此把网页视图整块隐藏；不加这些属性的覆盖层
 * （标签与分栏的拖动遮罩、侧栏浮出、页签缩略卡）在显示期间登记到这里：计数大于 0 时 `document.body` 带
 * `data-workspace-overlay`，`useCovered` 看到它同样隐藏网页视图，全部撤销后恢复。整块隐藏，不做局部裁切。
 *
 * 侧栏浮层要指针在 Rail 入口上停 100 ms 才出现、缩略卡要在页签上停 500 ms，划过 Rail 或普通地悬停页签不会登记，
 * 网页视图不会因此闪烁。
 */
export const WORKSPACE_OVERLAY_ATTRIBUTE = 'data-workspace-overlay';

interface OverlayTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** 计数器本体：`target` 取挂属性的元素（缺省 `document.body`；测试里给假的）。 */
export function createWorkspaceOverlays(target: () => OverlayTarget | null) {
  let count = 0;
  const sync = () => {
    const element = target();
    if (!element) return;
    if (count > 0) element.setAttribute(WORKSPACE_OVERLAY_ATTRIBUTE, '');
    else element.removeAttribute(WORKSPACE_OVERLAY_ATTRIBUTE);
  };
  return {
    /** 登记一个覆盖层，返回撤销函数（重复调用只撤销一次）。 */
    register(): () => void {
      count += 1;
      sync();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count -= 1;
        sync();
      };
    },
    count: () => count,
  };
}

const overlays = createWorkspaceOverlays(() => (typeof document === 'undefined' ? null : document.body));

export const registerWorkspaceOverlay = overlays.register;

/** `active` 为真期间登记为覆盖层（卸载或变假时撤销）；布局阶段登记，与覆盖层同一帧画出。 */
export function useWorkspaceOverlay(active: boolean): void {
  useLayoutEffect(() => (active ? registerWorkspaceOverlay() : undefined), [active]);
}
