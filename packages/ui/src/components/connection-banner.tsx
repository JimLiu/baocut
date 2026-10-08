import { ProgressCircle } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useConnection } from '../state/connection-store.ts';
import { S } from './shell-copy.ts';

/** 贴着内容区顶边的整条横幅：不占卡片位，不把页面内容挤成两栏。 */
const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  minHeight: 40,
  paddingX: 16,
  paddingY: 8,
  boxSizing: 'border-box',
  backgroundColor: { default: 'notice-subtle', isNegative: 'negative-subtle' },
  font: 'ui',
  color: 'neutral',
});
const noticeIcon = iconStyle({ size: 'S', color: 'notice' });
const negativeIcon = iconStyle({ size: 'S', color: 'negative' });
const title = style({ fontWeight: 'bold', flexShrink: 0 });
const detail = style({ color: 'neutral-subdued', minWidth: 0, flexGrow: 1 });

/** 与 Runtime 断开时如实说明；「已连接」之前不允许提交（产品设计 §2.4）。 */
export function ConnectionBanner() {
  const state = useConnection((s) => s.state);
  if (state.status === 'connected' || (state.status === 'connecting' && state.attempt === 0)) return null;
  const isNegative = state.status === 'incompatible';
  const retrying = state.status === 'connecting' || (state.status === 'disconnected' && state.retryInMs !== null);
  const text =
    state.status === 'incompatible'
      ? S.connectionBanner.incompatible(state.reason)
      : state.status === 'closed'
        ? S.connectionBanner.closed
        : state.status === 'disconnected'
          ? S.connectionBanner.lost(state.reason, state.retryInMs !== null)
          : S.connectionBanner.reconnectingEllipsis;
  return (
    <div className={bar({ isNegative })} role={isNegative ? 'alert' : 'status'}>
      <AlertTriangle styles={isNegative ? negativeIcon : noticeIcon} aria-hidden />
      <span className={title}>{S.connectionBanner.title}</span>
      <span className={detail}>{text}</span>
      {retrying && <ProgressCircle size="S" isIndeterminate aria-label={S.connectionBanner.reconnecting} />}
    </div>
  );
}
