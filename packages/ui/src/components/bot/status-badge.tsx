import { ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { WorkItemStatusKey } from '../../model/bot.ts';
import { WORK_ITEM_STATUS, statusLabel } from './work-item-status.ts';

/** 状态图标与标签（对照表在 work-item-status.ts）。 */
const icon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 16,
  color: { tone: { neutral: 'gray-700', attention: 'notice-900', negative: 'negative-900', positive: 'positive-900' } },
});
const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  font: 'ui-xs',
  color: { tone: { neutral: 'gray-700', attention: 'notice-900', negative: 'negative-900', positive: 'positive-900' } },
  whiteSpace: 'nowrap',
});

/** 状态图标（16px）。图标本身不朗读：文字由旁边的标签或行的读屏名称给出。 */
export function StatusIcon({ statusKey: key }: { statusKey: WorkItemStatusKey }) {
  const row = WORK_ITEM_STATUS[key];
  return (
    <span className={icon({ tone: row.tone })} aria-hidden="true">
      {row.Icon ? <row.Icon /> : <ProgressCircle size="S" isIndeterminate aria-label={statusLabel(key)} />}
    </span>
  );
}

/** 图标加文字的状态标签。 */
export function StatusLabel({ statusKey: key }: { statusKey: WorkItemStatusKey }) {
  const row = WORK_ITEM_STATUS[key];
  return (
    <span className={pill({ tone: row.tone })}>
      <StatusIcon statusKey={key} />
      <span>{statusLabel(key)}</span>
    </span>
  );
}
