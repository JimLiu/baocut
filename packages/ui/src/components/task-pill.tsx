import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { Id } from '@baocut/protocol';
import { ProgressBar, ProgressCircle } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { TASK_PILL_COPY } from '../copy.ts';
import { pillCard, pillFace, pillList, type PillCardRow } from '../model/task-pill.ts';
import { useShell } from '../state/shell-store.ts';
import { actionTitle, useTaskAction } from './tasks/use-task-actions.ts';
import { useTaskRows } from './tasks/use-task-rows.ts';
import { useNow } from './use-now.ts';

/** 原型 task-pill.jsx：停 250ms 才弹卡，离开 150ms 才收（从胶囊挪进卡片时不闪）。 */
const OPEN_MS = 250;
const CLOSE_MS = 150;

/** 原型 ui.css `.tpillw` `.tpill` `.tpill__go` `.tpill__x` `.tpill__more`。 */
const wrap = style({ position: 'relative', display: 'inline-flex' });
const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 24,
  paddingEnd: 2,
  borderRadius: 'full',
  backgroundColor: 'blue-200',
  color: 'blue-1000',
});
const focusRing = {
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
} as const;
const go = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '[6px]',
  height: 24,
  margin: 0,
  paddingY: 0,
  paddingStart: '[10px]',
  paddingEnd: 8,
  borderWidth: 0,
  borderRadius: 'full',
  font: 'ui-sm',
  fontWeight: 'medium',
  color: 'blue-1000',
  whiteSpace: 'nowrap',
  backgroundColor: { default: 'transparent', isHovered: 'blue-300' },
  cursor: 'default',
  ...focusRing,
});
const spinner = style({ display: 'flex' });
const more = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 16,
  paddingX: '[6px]',
  borderRadius: 'full',
  backgroundColor: 'blue-900',
  // `font` 简写会连带设 `color: 'body'`，写在它后面才不被盖掉。
  font: 'ui-xs',
  color: 'gray-25',
  fontWeight: 'bold',
});
const close = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: { default: 0, isShown: 20 },
  height: 20,
  margin: 0,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'full',
  overflow: 'hidden',
  opacity: { default: 0, isShown: 1 },
  transition: 'all',
  color: 'blue-1000',
  backgroundColor: { default: 'transparent', isHovered: 'blue-300' },
  cursor: 'default',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  ...focusRing,
});
const closeIcon = iconStyle({ size: 'XS' });

/** 原型 `.tpcard`：右对齐弹在胶囊下面；多条时外边距收紧、每行自带内边距。 */
const card = style({
  position: 'absolute',
  top: '[calc(100% + 6px)]',
  insetEnd: 0,
  zIndex: 50,
  boxSizing: 'border-box',
  width: 300,
  display: 'flex',
  flexDirection: 'column',
  gap: { default: 4, isMulti: 0 },
  padding: { default: 12, isMulti: '[6px]' },
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'layer-2',
  boxShadow: 'elevated',
});
const cardHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  paddingTop: '[6px]',
  paddingX: 8,
  paddingBottom: 8,
  marginBottom: 4,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-800',
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const allLink = style({
  margin: 0,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  backgroundColor: 'transparent',
  font: 'ui-sm',
  fontWeight: 'medium',
  color: 'blue-900',
  textDecoration: { default: 'none', isHovered: 'underline' },
  cursor: 'default',
  ...focusRing,
});
const row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: { default: '[6px]', isMulti: 4 },
  boxSizing: 'border-box',
  width: 'full',
  margin: 0,
  padding: { default: 0, isMulti: 8 },
  borderWidth: 0,
  borderRadius: 'default',
  textAlign: 'start',
  color: 'gray-800',
  backgroundColor: { default: 'transparent', isMulti: { isHovered: 'gray-100' } },
  transition: 'colors',
  cursor: 'default',
  ...focusRing,
});
const rowTop = style({ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 });
const rowTitle = style({
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
  font: { default: 'ui', isMulti: 'ui-sm' },
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const rowState = style({ flexShrink: 0, font: 'ui-sm', color: 'gray-700' });
const rowSub = style({ font: 'ui-sm', color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const rowMeta = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const overflowLine = style({
  paddingTop: 8,
  paddingX: 8,
  paddingBottom: 4,
  marginTop: 4,
  font: 'ui-sm',
  color: 'gray-600',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});

/** 数字不跳宽（原型 `font-variant-numeric: tabular-nums`；style macro 没有这一项）。 */
const tabular = { fontVariantNumeric: 'tabular-nums' } as const;

function CardRow({ r, multi, onOpen }: { r: PillCardRow; multi: boolean; onOpen: () => void }) {
  return (
    <RACButton className={(state) => row({ ...state, isMulti: multi })} onPress={onOpen}>
      <span className={rowTop}>
        <span className={rowTitle({ isMulti: multi })}>{r.title}</span>
        {r.state ? (
          <span className={rowState} style={tabular}>
            {r.state}
          </span>
        ) : null}
      </span>
      {r.progress !== null ? (
        <ProgressBar
          size="S"
          aria-label={r.title}
          isIndeterminate={r.progress === 'indet'}
          value={r.progress === 'indet' ? undefined : r.progress}
        />
      ) : null}
      {r.detail ? <span className={rowSub}>{r.detail}</span> : null}
      {r.meta ? <span className={rowMeta}>{r.meta}</span> : null}
    </RACButton>
  );
}

/**
 * 视频栏的任务胶囊（原型 task-pill.jsx、shell.jsx `MovieActions`）：只报这个视频的后台任务，念表头那一条，
 * 其余是「+N」；停上去弹卡。只有一条时点胶囊去它的详情、悬停露出 × 取消或停止；多条时点胶囊去任务页，× 不出现
 * （不知道要取消哪一条），卡里每行点进各自的详情。没有任务时不画。
 */
export function TaskPill({ videoId }: { videoId: Id | null }) {
  const { rows } = useTaskRows();
  const goTo = useShell((s) => s.go);
  const act = useTaskAction();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const list = pillList(rows, { videoId, mineOnly: true });
  const face = pillFace(list);
  const now = useNow(1000, open && !!face);
  if (!face) return null;

  const { head } = face;
  const later = (on: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(on), on ? OPEN_MS : CLOSE_MS);
  };
  const shut = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  const goTask = (id: Id) => {
    shut();
    goTo({ tab: 'tasks', taskId: id });
  };
  const goAll = () => {
    shut();
    goTo({ tab: 'tasks' });
  };
  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) later(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      shut();
    }
  };
  const view = open ? pillCard(list, videoId, now) : null;

  return (
    <span
      className={wrap}
      onMouseEnter={() => later(true)}
      onMouseLeave={() => later(false)}
      onFocus={() => later(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <span className={pill} data-testid="video-bar-task-pill" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <RACButton className={go} onPress={() => (face.more ? goAll() : goTask(head.id))}>
          <span className={spinner} aria-hidden="true">
            <ProgressCircle size="S" isIndeterminate aria-label={face.label} />
          </span>
          <span style={tabular}>{face.label}</span>
          {face.more ? (
            <span className={more} style={tabular}>
              +{face.more}
            </span>
          ) : null}
        </RACButton>
        {!face.more && head.action ? (
          <RACButton
            className={(state) => close({ ...state, isShown: hovered || state.isFocusVisible })}
            aria-label={actionTitle(head.action, head.kind)}
            onPress={() => act(head.action!)}
          >
            <Close styles={closeIcon} data-bc-icons="own" />
          </RACButton>
        ) : null}
      </span>
      {view ? (
        <div className={card({ isMulti: view.multi })} role="group" aria-label={view.title ?? head.title}>
          {view.multi ? (
            <div className={cardHead}>
              <span>{view.title}</span>
              <RACButton className={allLink} onPress={goAll}>
                {TASK_PILL_COPY.all}
              </RACButton>
            </div>
          ) : null}
          {view.rows.map((r) => (
            <CardRow key={r.id} r={r} multi={view.multi} onOpen={() => goTask(r.id)} />
          ))}
          {view.overflow ? <div className={overflowLine}>{TASK_PILL_COPY.more(view.overflow)}</div> : null}
        </div>
      ) : null}
    </span>
  );
}
