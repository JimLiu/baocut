import { Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Download from '@react-spectrum/s2/icons/Download';
import { iconStyle, lightDark, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { sideButton } from '../../model/app-update.ts';
import { useAppUpdate } from '../../state/app-update-store.ts';

/*
 * rail「设置」正上方的更新按钮（设计稿 settings-update.jsx `AppUpdateSideButton`、apprail.css `.apprail__upd`、
 * settings-update.css `.sideupd`）：一格 40 高，里面 32 的 accent 方钮；有新版本、下载中、已下载、带着版本信息的出错时才出现，
 * 别的时候这一格不占位。点它打开更新窗。
 */

const cell = style({ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40 });
const button = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 32,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'lg',
  // 与 S2 的 accent 按钮同色（设计稿 `.sideupd` 是 blue-900 / hover blue-1000、前景同 accent 按钮）。
  backgroundColor: {
    default: lightDark('accent-900', 'accent-700'),
    isHovered: lightDark('accent-1000', 'accent-600'),
    isPressed: lightDark('accent-1000', 'accent-600'),
  },
  color: 'white',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  transform: { isPressed: 'scale(0.96)' },
  transition: 'default',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const glyph = iconStyle({ size: 'S' });
const ring = style({ size: 16 });
/** 右上角状态点：直径 7，外圈 1.5 的 accent 描边把点从按钮上托出来（设计稿 `.sideupd__dot`）。 */
const dot = style({
  position: 'absolute',
  top: 4,
  insetEnd: 4,
  size: '[7px]',
  borderRadius: 'full',
  backgroundColor: { tone: { white: 'white', positive: 'positive', negative: 'negative' } },
  outlineStyle: 'solid',
  outlineWidth: '[1.5px]',
  outlineColor: { default: lightDark('accent-900', 'accent-700'), isHovered: lightDark('accent-1000', 'accent-600') },
  pointerEvents: 'none',
});

function Ring({ pct }: { pct: number }) {
  const r = 6.5;
  const len = 2 * Math.PI * r;
  return (
    <svg className={ring} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeOpacity={0.17} />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeOpacity={0.94}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        strokeDasharray={`${(len * Math.max(0, Math.min(100, pct))) / 100} ${len}`}
      />
    </svg>
  );
}

export function UpdateRailButton() {
  const state = useAppUpdate((s) => s.snapshot?.state ?? null);
  const openWindow = useAppUpdate((s) => s.openWindow);
  if (!state) return null;
  const b = sideButton(state);
  if (!b.visible) return null;
  return (
    <div className={cell}>
      <TooltipTrigger placement="end" delay={300}>
        <RACButton className={(rp) => button(rp)} aria-label={b.tip} aria-haspopup="dialog" onPress={(event) => openWindow(event.target as Element)}>
          {({ isHovered }) => (
            <>
              {b.glyph === 'ring' ? <Ring pct={b.pct ?? 0} /> : b.glyph === 'check' ? <Checkmark styles={glyph} /> : <Download styles={glyph} />}
              {b.dot ? <span className={dot({ tone: b.dot, isHovered })} /> : null}
            </>
          )}
        </RACButton>
        <Tooltip>{b.tip}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}
