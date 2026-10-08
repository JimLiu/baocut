import AIMark from '@react-spectrum/s2/icons/AIMark';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Download from '@react-spectrum/s2/icons/Download';
import Export from '@react-spectrum/s2/icons/Export';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import Layers from '@react-spectrum/s2/icons/Layers';
import Layout from '@react-spectrum/s2/icons/Layout';
import TextSize from '@react-spectrum/s2/icons/TextSize';
import Translate from '@react-spectrum/s2/icons/Translate';
import Upload from '@react-spectrum/s2/icons/Upload';
import Video from '@react-spectrum/s2/icons/Video';
import type { ComponentType } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { HELP_COPY as COPY } from '../../copy.ts';
import type { HelpGuide, HelpIcon } from '../../model/help-guides.ts';
import { AgentIcon } from '../agent-icon.tsx';

/** 指南的图标（原型 model-help.js 的 `icon`，换成 S2 图标；Agent 用自绘的机器人，同设置页）。 */
const ICONS: Record<HelpIcon, ComponentType> = {
  upload: Upload,
  captions: CloseCaptions,
  translate: Translate,
  export: Export,
  workspace: Layout,
  styles: TextSize,
  elements: Layers,
  video: Video,
  agent: AgentIcon,
  sparkle: AIMark,
  help: HelpCircle,
  download: Download,
};

/** 指南图标；颜色跟着外层的文字走（外层样式把 `--iconPrimary` 设成 currentColor，原型的图标都是 currentColor）。 */
export function GuideIcon({ icon }: { icon: HelpIcon }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

/** 指南 / 常见问题的列表行（原型 .help-list / .help-row）：图标、标题与一句话、阅读时长、箭头。 */
export function GuideList({ guides, onRead }: { guides: readonly HelpGuide[]; onRead(guide: HelpGuide): void }) {
  return (
    <div className={list}>
      {guides.map((guide) => (
        <RACButton key={guide.id} className={(state) => row(state)} onPress={() => onRead(guide)}>
          <span className={rowIcon}>
            <GuideIcon icon={guide.icon} />
          </span>
          <span className={rowText}>
            <strong className={rowTitle}>{guide.title}</strong>
            <small className={rowSummary}>{guide.summary}</small>
          </span>
          <span className={readTime}>{COPY.minutes(guide.minutes)}</span>
          <span className={chevron}>
            <ChevronRight />
          </span>
        </RACButton>
      ))}
    </div>
  );
}

/** 节标题行（原型 .help-section-heading）：左边标题，右边一个动作或计数。 */
export const sectionHeading = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 12,
});
export const sectionTitle = style({ margin: 0, fontSize: 'ui-2xl', fontWeight: 'extra-bold', lineHeight: '[1.3]', color: 'gray-900' });
export const subTitle = style({ margin: 0, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
export const intro = style({ marginTop: 8, marginBottom: 24, font: 'ui-sm', lineHeight: '[1.6]', color: 'gray-700' });
export const detail = style({ font: 'ui-sm', color: 'gray-600' });
export const kbd = style({ flexShrink: 0, font: 'code-xs', color: 'gray-600', whiteSpace: 'nowrap' });
/** 原型 .help-eyebrow：12px 粗体蓝字。 */
export const eyebrow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '[6px]',
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'blue-1000',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
/** 原型 .help-link：蓝色小字链接，带箭头。 */
export const textLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-sm',
  color: 'blue-1000',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  cursor: 'pointer',
  textDecoration: { default: 'none', isHovered: 'underline' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'sm',
});

const list = style({ borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'lg', overflow: 'hidden' });
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxSizing: 'border-box',
  width: 'full',
  padding: 16,
  borderWidth: 0,
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: { default: 'transparent', isHovered: 'gray-75', isPressed: 'gray-100' },
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -3,
  transition: 'default',
});
const rowIcon = style({ display: 'grid', placeItems: 'center', flexShrink: 0, size: 32, color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const rowText = style({ flexGrow: 1, minWidth: 0 });
const rowTitle = style({ display: 'block', font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const rowSummary = style({ display: 'block', marginTop: 4, font: 'ui-sm', lineHeight: '[1.5]', color: 'gray-600' });
const readTime = style({
  display: { default: 'block', '@media (max-width: 760px)': 'none' },
  flexShrink: 0,
  font: 'ui-xs',
  color: 'gray-600',
  whiteSpace: 'nowrap',
});
const chevron = style({ display: 'flex', flexShrink: 0, color: 'gray-600', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
