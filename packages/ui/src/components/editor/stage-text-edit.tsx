import { useEffect, useRef, type CSSProperties } from 'react';
import type { TextItem } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_COPY } from '../../copy.ts';
import { asObject, resolveLineStyle } from '../../render/text-style.ts';
import type { View } from './stage-boxes.tsx';

const shell = style({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' });
/** 原型 .txtedit：不画第二层焦点环（外面已经有选中框了），光标随字色。 */
const field = style({
  width: 'full',
  outlineStyle: 'none',
  cursor: 'text',
  minWidth: 12,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  userSelect: 'text',
});

/**
 * 就地改字（原型 stage-elements.jsx 的 TextEdit）：在文字的选中框里铺一块可编辑的正文，字体、字号、颜色、对齐按这段文字的样式
 * 换算到舞台显示尺寸，画布上的那份先藏起来（叠加层负责）。进来整段选中；Enter 提交、⇧Enter 换行、Esc 提交并退出、
 * 失焦同样提交。输入法组字中的 Enter 不算。按键一律就地吞掉，编辑器的快捷键在这一格里不生效。
 */
export function StageTextEdit({
  item,
  view,
  canvas,
  onDone,
}: {
  item: TextItem;
  view: View;
  canvas: { width: number; height: number };
  /** `text` 为 null 表示没改；`byKey` 是用 Enter / Esc 结束的（焦点该回到舞台）。 */
  onDone(text: string | null, byKey: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const finish = (byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = (ref.current?.innerText ?? item.text ?? '').replace(/\n+$/, '');
    onDone(value === item.text ? null : value, byKey);
  };

  const line = resolveLineStyle(asObject(item.style), 'original', canvas);
  const k = view.kx;
  const look: CSSProperties = {
    fontFamily: line.fontFamily,
    fontSize: line.fontSize * k,
    fontWeight: line.fontWeight,
    fontStyle: line.italic ? 'italic' : undefined,
    textDecoration: line.underline ? 'underline' : undefined,
    color: line.color,
    letterSpacing: line.letterSpacing * k,
    lineHeight: line.lineHeight,
    textTransform: line.textTransform as CSSProperties['textTransform'],
    textAlign: line.textAlign,
    WebkitTextStroke: line.outline ? `${line.outline.width * k}px ${line.outline.color}` : undefined,
    paintOrder: line.outline ? 'stroke fill' : undefined,
  };

  return (
    <div className={shell} data-stage-editor>
      <div
        ref={ref}
        className={field}
        style={look}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label={STAGE_COPY.textEditor}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onBlur={() => finish(false)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
            event.preventDefault();
            finish(true);
          }
        }}
      >
        {item.text}
      </div>
    </div>
  );
}
