import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Sequence } from '@baocut/protocol';
import Lock from '@react-spectrum/s2/icons/Lock';
import TemplateIcon from '@react-spectrum/s2/icons/Template';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ratioLockOf } from '../../model/template-layers.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { TemplateThumb } from './template-thumb.tsx';
import { useTemplateStudio } from './use-template-studio.ts';
import { ratioLabel } from './use-template-actions.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

const icon = iconStyle({ size: 'XS' });
const label = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const headLock = style({ flexShrink: 0, display: 'flex', marginEnd: 8, '--iconPrimary': { type: 'fill', value: 'gray-600' } });
/** 模板块（原型 `.ttpl`）：贯穿全片，不能拖也不能裁；点一下打开模板属性页。 */
const block = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  paddingX: 4,
  overflow: 'hidden',
  borderRadius: 'sm',
  borderStyle: 'solid',
  borderWidth: { default: 1, isSelected: 2 },
  borderColor: { default: 'indigo-400', isSelected: 'indigo-800' },
  backgroundColor: { default: 'indigo-200', isSelected: 'indigo-300' },
  color: 'indigo-1100',
  font: 'ui-xs',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const name = style({ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 });
const lockTag = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flexShrink: 0,
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'indigo-300',
});
const span = style({ flexShrink: 0, marginStart: 'auto', opacity: 0.75 });

/** 时间线上的模板行（原型 timeline-rows.jsx `TemplateBlock`）：模板是序列的参数、不是轨，行头只有图标、名字，锁着画幅时挂一枚锁。 */
export function TemplateRow({
  sequence,
  height,
  rowClass,
  headerClass,
  laneClass,
  laneWidth,
  xOf,
  duration,
}: {
  sequence: Sequence;
  height: number;
  rowClass: string;
  headerClass: string;
  laneClass: string;
  laneWidth: number;
  xOf(seconds: number): number;
  duration: number;
}) {
  const focused = useEditor((s) => s.templateFocus && s.selection.length === 0);
  const editable = useVideo((s) => canEdit(s.video));
  const studio = useTemplateStudio();
  const tpl = sequence.template;
  if (!tpl) return null;
  const lock = ratioLockOf(tpl);
  const lockNote = lock ? TC.lockTip(lock.name, ratioLabel(lock.ratio)) : null;
  const x0 = xOf(0);
  const width = Math.max(2, xOf(duration) - x0);
  const blockHeight = height - 8;
  // 不让空白处的框选从这一行起手，点块也不清掉选区以外的东西：打开模板页本身会清片段选区。
  const hold = (event: ReactPointerEvent) => event.stopPropagation();
  const open = () => useEditor.getState().focusTemplate(true);
  return (
    <div className={rowClass} style={{ height }}>
      <div className={headerClass} onPointerDown={hold}>
        <TemplateIcon styles={icon} />
        <span className={label} title={TC.laneNamed(tpl.name)}>
          {TC.pageTitleEmpty}
        </span>
        {lockNote ? (
          <span className={headLock} title={lockNote} aria-label={lockNote}>
            <Lock styles={icon} />
          </span>
        ) : null}
      </div>
      <div className={laneClass} style={{ width: laneWidth }} onPointerDown={hold}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={focused}
          aria-label={TC.laneNamed(tpl.name)}
          className={block({ isSelected: focused })}
          style={{ left: x0, width }}
          title={lockNote ? `${TC.laneTip(tpl.name)} · ${lockNote}` : TC.laneTip(tpl.name)}
          onClick={open}
          // 双击进版面编辑器（原型 timeline-rows）。
          onDoubleClick={() => {
            if (editable) studio.editVideo(sequence);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              open();
            }
          }}
        >
          {width >= 96 ? <TemplateThumb doc={tpl} height={blockHeight - 4} /> : null}
          {width >= 48 ? (
            <>
              <TemplateIcon styles={icon} />
              <span className={name}>{tpl.name}</span>
              {lock && width >= 160 ? (
                <span className={lockTag}>
                  <Lock styles={icon} />
                  {ratioLabel(lock.ratio)}
                </span>
              ) : null}
              {width >= 260 ? <span className={span}>{TC.wholeVideo}</span> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
