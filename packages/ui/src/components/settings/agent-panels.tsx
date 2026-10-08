import type { ReactNode } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

/**
 * Agent 提供方、Skills 与隐私页里的 Agent 权限共用的版式：小节标题加一句说明、带边框的卡片、左文右控件的一行。
 * 行在窄处换行：控件掉到文字下面，而不是把文字挤成一列字（设计稿 settings-agent.css 的窄屏规则）。
 */

const head = style({ display: 'flex', alignItems: 'start', flexWrap: 'wrap', gap: 12, marginTop: 32, marginBottom: 12 });
const headText = style({ flexGrow: 1, flexBasis: 0, minWidth: 240 });
const headTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const headHint = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
const headAction = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });

export function SectionHeading({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className={head}>
      <div className={headText}>
        <h2 className={headTitle}>{title}</h2>
        {hint ? <p className={headHint}>{hint}</p> : null}
      </div>
      {action ? <div className={headAction}>{action}</div> : null}
    </div>
  );
}

// 设计稿的 `<Card layer>`（ui.css .card--layer）：浅一层的底、1px 描边、10px 圆角。
const panel = style({
  paddingX: { default: 16, isFlush: 0 },
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  overflow: { isFlush: 'hidden' },
  minWidth: 0,
});

/**
 * 带边框的卡片；里面的行之间有分隔线。`flush` 不留内边距、按圆角裁切，给里面自带通栏条带的列表用（Agent 提供方）。
 */
export function Panel({ label, flush = false, children }: { label?: string; flush?: boolean; children: ReactNode }) {
  return (
    <section className={panel({ isFlush: flush })} aria-label={label}>
      {children}
    </section>
  );
}

const row = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  paddingY: 16,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const rowText = style({ flexGrow: 1, flexBasis: 0, minWidth: 220 });
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const rowDesc = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const rowControl = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, flexShrink: 0 });
const rowBelow = style({ flexBasis: 'full', minWidth: 0 });

/**
 * 一行：左边名字与说明，右边控件。`below` 放占满整行宽的内容（命令、路径、排查清单），排在文字和控件下面。
 */
export function SettingRow({
  label,
  desc,
  children,
  below,
}: {
  label: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className={row}>
      <div className={rowText}>
        <div className={rowLabel}>{label}</div>
        {desc ? <p className={rowDesc}>{desc}</p> : null}
      </div>
      {children ? <div className={rowControl}>{children}</div> : null}
      {below ? <div className={rowBelow}>{below}</div> : null}
    </div>
  );
}
