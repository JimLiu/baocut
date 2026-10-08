import { useState } from 'react';
import { ActionButton, Button, ProgressBar, Text, ToastQueue } from '@react-spectrum/s2';
import AlertTriangleIcon from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircleIcon from '@react-spectrum/s2/icons/CheckmarkCircle';
import CopyIcon from '@react-spectrum/s2/icons/Copy';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { CheckAction, CheckLineView, TryAction, TryNoteView } from '../../model/model-check.ts';
import { CHECK_LABEL } from '../../model/model-check-copy.ts';

/* 设计稿 settings-local.css 的 .lmchk / .lmtry：行上一条状态（缩进到名字那一列），试用面板里一块浅红的提醒。 */
const lineBox = style({ marginTop: 8, marginStart: { default: 0, sm: 32 }, minWidth: 0 });
// 图标单独一列；文字与按钮按行内排：长句换行时按钮跟在句子后面，不另起一行把图标孤立在上面。
const lineRow = style({ display: 'flex', alignItems: 'start', gap: 8, minHeight: 24, font: 'ui-sm', color: 'gray-700' });
const iconBox = style({ display: 'flex', alignItems: 'center', height: 24, flexShrink: 0 });
const lineBody = style({ flexGrow: 1, minWidth: 0, paddingY: 2 });
const lineText = style({
  overflowWrap: 'anywhere',
  userSelect: 'text',
  color: { default: 'gray-700', tone: { failed: 'negative-1000' } },
});
const head = style({ fontWeight: 'bold', color: { default: 'gray-800', tone: { failed: 'negative-900' } } });
const phase = style({ marginStart: 4, color: 'gray-600' });
const todo = style({ marginStart: 4, color: 'gray-800' });
const progress = style({ flexShrink: 0, width: 120 });
const actions = style({ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, verticalAlign: 'middle' });
const tail = style({ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginStart: 8, verticalAlign: 'middle' });
const details = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 4,
  marginTop: 8,
  marginStart: 24,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
  minWidth: 0,
});
const detailLine = style({ font: 'code-xs', color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });
const passedIcon = iconStyle({ size: 'S', color: 'positive' });
const failedIcon = iconStyle({ size: 'S', color: 'negative' });

const noteBox = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'default',
  backgroundColor: 'negative-subtle',
  minWidth: 0,
});
const noteBody = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, minWidth: 0 });
const noteText = style({ font: 'ui-sm', color: 'negative-1000', overflowWrap: 'anywhere', userSelect: 'text' });
const noteTodo = style({ color: 'gray-800' });

function Actions<K extends string>({
  list,
  onAction,
  open,
}: {
  list: readonly { k: K; label: string; primary?: boolean }[];
  onAction: (k: K) => void;
  open?: boolean;
}) {
  if (!list.length) return null;
  return (
    <span className={actions}>
      {list.map((a) =>
        a.primary ? (
          <Button key={a.k} variant="secondary" size="S" onPress={() => onAction(a.k)}>
            {a.label}
          </Button>
        ) : (
          <ActionButton key={a.k} isQuiet size="S" aria-expanded={a.k === 'details' ? !!open : undefined} onPress={() => onAction(a.k)}>
            <Text>{a.k === 'details' && open ? CHECK_LABEL.hideDetails : a.label}</Text>
          </ActionButton>
        ),
      )}
    </span>
  );
}

/**
 * 行上那一条检查状态（设计稿 settings-model-check.jsx `ModelCheckLine`）：检查中（阶段 + 进度 + 取消）/ N 分钟前检查通过 /
 * 没通过（红色一句 + 修复… / 重新检查 / 技术详情）。技术详情在这里展开，能复制；其余动作交回给行。
 */
export function ModelCheckLine({
  view,
  detailLines,
  label,
  onAction,
}: {
  view: CheckLineView | null;
  /** 技术详情的几行（没通过时）。 */
  detailLines: readonly string[];
  /** 进度条的无障碍名。 */
  label: string;
  onAction: (k: Exclude<CheckAction['k'], 'details'>) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!view) return null;
  const tone = view.tone === 'failed' ? 'failed' : undefined;
  const act = (k: CheckAction['k']) => {
    if (k === 'details') {
      setOpen((v) => !v);
      return;
    }
    setOpen(false);
    onAction(k);
  };
  const shown = open && view.tone === 'failed' ? detailLines : [];
  return (
    <div className={lineBox} role="status" aria-live="polite">
      <div className={lineRow}>
        {view.tone === 'running' ? null : (
          <span className={iconBox}>
            {view.tone === 'passed' ? (
              <CheckmarkCircleIcon styles={passedIcon} aria-hidden />
            ) : (
              <AlertTriangleIcon styles={failedIcon} aria-hidden />
            )}
          </span>
        )}
        <div className={lineBody}>
          <span className={lineText({ tone })}>
            {view.head ? <span className={head({ tone })}>{view.head}</span> : null}
            {view.tone === 'running' ? <span className={phase}>{view.text}</span> : view.text}
            {view.todo ? <span className={todo}>{view.todo}</span> : null}
          </span>
          {view.tone === 'running' || view.actions.length ? (
            <span className={tail}>
              {view.tone === 'running' ? (
                <ProgressBar
                  size="S"
                  aria-label={label}
                  isIndeterminate={view.percent === null}
                  value={view.percent ?? undefined}
                  styles={progress}
                />
              ) : null}
              <Actions list={view.actions} onAction={act} open={open} />
            </span>
          ) : null}
        </div>
      </div>
      {shown.length ? (
        <div className={details} aria-label={CHECK_LABEL.details}>
          {shown.map((l) => (
            <span key={l} className={detailLine}>
              {l}
            </span>
          ))}
          <ActionButton isQuiet size="S" onPress={() => copyDetails(shown)}>
            <CopyIcon />
            <Text>{CHECK_LABEL.copy}</Text>
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}

function copyDetails(lines: readonly string[]): void {
  navigator.clipboard.writeText(lines.join('\n')).then(
    () => ToastQueue.positive(CHECK_LABEL.copied, { timeout: 3000 }),
    () => ToastQueue.negative(CHECK_LABEL.copyFailed, { timeout: 4000 }),
  );
}

/** 试用面板里的一块（设计稿 `ModelTryNote`）：上次检查没通过的提醒，或这次试用自己的失败。 */
export function ModelTryNote({ view, onAction }: { view: TryNoteView | null; onAction: (k: TryAction['k']) => void }) {
  if (!view) return null;
  return (
    <div className={noteBox} role="alert">
      <AlertTriangleIcon styles={failedIcon} aria-hidden />
      <div className={noteBody}>
        <span className={noteText}>
          {view.text}
          {view.todo ? <span className={noteTodo}>{view.todo}</span> : null}
        </span>
        <Actions list={view.actions} onAction={onAction} />
      </div>
    </div>
  );
}
