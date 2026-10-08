import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { tabPreviewPosition } from '../../model/shell-peek.ts';
import { useWorkspaceOverlay } from './workspace-overlay.ts';

/** 宽 280（同 model/shell-peek.ts `TAB_PREVIEW_WIDTH`；宏只收字面量）。 */
const card = style({
  position: 'fixed',
  zIndex: 60,
  width: 280,
  boxSizing: 'border-box',
  overflow: 'hidden',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
  // 卡片挂在 body 上、在 S2 Provider 之外：字体自己给。
  font: 'ui-sm',
  color: 'gray-900',
  boxShadow: 'elevated',
  pointerEvents: 'none',
});
/** 缩略图区：底边分隔线与克隆的缩放见 app.css `.bc-tab-preview-image`。 */
const image = style({
  position: 'relative',
  height: 175,
  overflow: 'hidden',
  backgroundColor: 'gray-50',
  '--bc-tab-preview-line': { type: 'borderColor', value: 'gray-100' },
});
const titleText = style({
  display: 'block',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  paddingTop: 8,
  paddingX: 12,
  fontSize: '[12px]',
  fontWeight: 'bold',
});
const pathText = style({
  display: 'block',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  paddingTop: 4,
  paddingBottom: 8,
  paddingX: 12,
  fontSize: '[11px]',
  color: 'gray-600',
});

/**
 * 页签悬停缩略卡（产品设计 §3.3「页签条」；原型 home-shell-chrome.jsx `WorkspaceTabPreview`）：把该页签的面板克隆成
 * 不可交互的副本，按比例缩进卡片；网页框、音视频与脚本去掉，画布逐像素复制。面板找不到就留白；内嵌的原生网页视图
 * 不在 DOM 里，截不到，那一块同样留白。卡片显示期间网页视图让开（`workspace-overlay.ts`），否则卡片会被它盖住。
 */
export function WorkspaceTabPreview({
  panelId,
  rect,
  title,
  subtitle,
}: {
  panelId: string;
  rect: { left: number; bottom: number };
  title: string;
  subtitle: string;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  // 挂载期间（悬停 500 ms 之后）登记为覆盖层：Electron 的内嵌网页视图暂时隐藏，像菜单一样。
  useWorkspaceOverlay(true);
  useLayoutEffect(() => {
    const pane = document.getElementById(panelId);
    const host = target.current;
    if (!pane || !host) {
      setEmpty(true);
      return;
    }
    const copy = pane.cloneNode(true) as HTMLElement;
    for (const name of ['hidden', 'id', 'role', 'aria-labelledby', 'aria-controls', 'tabindex']) copy.removeAttribute(name);
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    copy.querySelectorAll('iframe, video, audio, script').forEach((el) => el.remove());
    copy.querySelectorAll<HTMLElement>('[hidden]').forEach((el) => {
      el.hidden = false;
    });
    for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('[style]')]) {
      if (el.style.getPropertyPriority('display') === 'important') el.style.removeProperty('display');
    }
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    copy.classList.add('bc-tab-preview-clone');
    const originals = pane.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((el, i) => {
      const source = originals[i];
      if (!source) return;
      try {
        el.width = source.width;
        el.height = source.height;
        el.getContext('2d')?.drawImage(source, 0, 0);
      } catch {
        // 画布被跨域内容污染或没有 2D 上下文：这一块留白。
      }
    });
    host.replaceChildren(copy);
    setEmpty(false);
  }, [panelId]);
  return createPortal(
    <div className={card} role="tooltip" style={tabPreviewPosition(rect, window.innerWidth)} data-tab-preview="">
      <div ref={target} className={`${image} bc-tab-preview-image`} data-empty={empty || undefined} />
      <strong className={titleText}>{title}</strong>
      <span className={pathText}>{subtitle}</span>
    </div>,
    document.body,
  );
}
