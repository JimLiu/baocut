import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { Id } from '@baocut/protocol';
import { Button, ProgressBar, ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
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

/** 原型 ui.css `.tpillw` `.tring` `.tring__n`：32px 的安静圆钮，环 16px，多条时右上角标总条数。 */
const wrap = style({ position: 'relative', display: 'inline-flex' });
const focusRing = {
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
} as const;
const ring = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 32,
  margin: 0,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'full',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100' },
  transition: 'colors',
  cursor: 'default',
  ...focusRing,
});
const ringArt = style({ display: 'flex' });
const count = style({
  position: 'absolute',
  top: 0,
  insetEnd: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  minWidth: 16,
  height: 16,
  paddingX: 4,
  borderRadius: 'full',
  backgroundColor: 'blue-900',
  // `font` 简写会连带设 `color: 'body'`，写在它后面才不被盖掉。
  font: 'ui-xs',
  color: 'gray-25',
  fontWeight: 'bold',
});
const cardActs = style({ display: 'flex', justifyContent: 'end', paddingTop: 8 });

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
 * 视频栏的任务进度环（原型 task-pill.jsx 的 compact、shell.jsx `MovieActions`）：只报这个视频的后台任务，不写字——环画表头那一条的
 * 进度（没有进度时转圈），多于一条时右上角标总条数；停上去弹卡，任务名、阶段与取消都在卡里。只有一条时点环去它的详情，卡底给取消或停止；
 * 多条时点环去任务页，卡里不给取消（不知道要取消哪一条），每行点进各自的详情。没有任务时不画。
 */
export function TaskPill({ videoId }: { videoId: Id | null }) {
  const { rows } = useTaskRows();
  const goTo = useShell((s) => s.go);
  const act = useTaskAction();
  const [open, setOpen] = useState(false);
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
      <RACButton
        className={ring}
        data-testid="video-bar-task-pill"
        aria-label={face.more ? `${TASK_PILL_COPY.count(face.more + 1)} · ${face.label}` : face.label}
        onPress={() => (face.more ? goAll() : goTask(head.id))}
      >
        <span className={ringArt} aria-hidden="true">
          <ProgressCircle
            size="S"
            aria-label={face.label}
            isIndeterminate={head.pct == null}
            value={head.pct ?? undefined}
          />
        </span>
        {face.more ? (
          <span className={count} style={tabular} aria-hidden="true">
            {face.more + 1}
          </span>
        ) : null}
      </RACButton>
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
          {!view.multi && head.action ? (
            <div className={cardActs}>
              <Button
                size="S"
                variant="secondary"
                onPress={() => {
                  shut();
                  act(head.action!);
                }}
              >
                {actionTitle(head.action, head.kind)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
