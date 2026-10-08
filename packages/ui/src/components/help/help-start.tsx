import { Button } from '@react-spectrum/s2';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { HELP_COPY as COPY } from '../../copy.ts';
import { HELP_GUIDES, HELP_MORE, quickStart, type HelpGuide } from '../../model/help-guides.ts';
import { GuideIcon, GuideList, detail, eyebrow, kbd, sectionHeading, subTitle, textLink } from './help-guide-list.tsx';

/**
 * 快速上手（原型 help-center.jsx 的 `section === 'start'`）：欢迎块、入门路径卡、「你可能还想了解」、底部提示。
 * 步数与总阅读时长从快速上手的指南算（原型写死「4 步 · 约 7 分钟阅读」）。
 */
export function HelpStart({ onRead, onChoose }: { onRead(guide: HelpGuide): void; onChoose(section: 'guide' | 'keys'): void }) {
  const quick = quickStart();
  const minutes = quick.reduce((sum, guide) => sum + guide.minutes, 0);
  const more = HELP_GUIDES.filter((guide) => HELP_MORE.includes(guide.id));
  return (
    <>
      <div>
        <span className={eyebrow}>{COPY.welcomeEyebrow}</span>
        <h2 className={welcomeTitle}>{COPY.welcomeTitle}</h2>
        <p className={welcomeBody}>{COPY.welcomeBody(quick.length)}</p>
        <div className={welcomeAction}>
          <Button variant="accent" onPress={() => quick[0] && onRead(quick[0])}>
            {COPY.welcomeAction}
          </Button>
          <span className={duration}>{COPY.welcomeDuration(quick.length, minutes)}</span>
        </div>
      </div>
      <div className={path} role="group" aria-label={COPY.pathLabel(quick.length)}>
        {quick.map((guide, index) => (
          <RACButton key={guide.id} className={(state) => card(state)} onPress={() => onRead(guide)}>
            <span className={cardHead}>
              <span className={cardIcon}>
                <GuideIcon icon={guide.icon} />
              </span>
              <span className={cardIndex}>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <strong className={cardTitle}>{guide.short ?? guide.title}</strong>
            <span className={cardMinutes}>
              {COPY.pathMinutes(guide.minutes)} <span aria-hidden="true">→</span>
            </span>
          </RACButton>
        ))}
      </div>
      <div className={sectionHeading}>
        <h3 className={subTitle}>{COPY.moreTitle}</h3>
        <RACButton className={(state) => textLink(state)} onPress={() => onChoose('guide')}>
          {COPY.allGuides}
          <ChevronRight />
        </RACButton>
      </div>
      <GuideList guides={more} onRead={onRead} />
      <div className={bottomTip}>
        <span>{COPY.keysHintLead}</span>
        <RACButton className={(state) => textLink(state)} onPress={() => onChoose('keys')}>
          {COPY.keysHintLink}
        </RACButton>
        <kbd className={kbd}>?</kbd>
        <span className={detail}>{COPY.keysHintNote}</span>
      </div>
    </>
  );
}

const welcomeTitle = style({
  marginTop: 8,
  marginBottom: 0,
  fontSize: { default: 'heading-lg', '@media (max-width: 760px)': 'ui-3xl' },
  fontWeight: 'extra-bold',
  lineHeight: '[1.3]',
  letterSpacing: '[-0.02em]',
  color: 'gray-900',
});
const welcomeBody = style({ marginTop: 8, marginBottom: 20, font: 'body-sm', lineHeight: '[1.6]', color: 'gray-700' });
const welcomeAction = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 12 });
const duration = style({ font: 'ui-sm', color: 'gray-600' });
/** 原型 .help-path 写死 4 列；这里快速上手有几篇就排几列（等宽），窄窗两列折行。 */
const path = style({
  display: 'grid',
  gridAutoFlow: { default: 'column', '@media (max-width: 760px)': 'row' },
  gridAutoColumns: '[minmax(0, 1fr)]',
  gridTemplateColumns: { default: 'none', '@media (max-width: 760px)': 'repeat(2, minmax(0, 1fr))' },
  gap: 8,
  marginTop: 24,
  marginBottom: 28,
});
const card = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  minWidth: 0,
  paddingX: 12,
  paddingY: 16,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-400' },
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-75', isHovered: 'gray-100' },
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  transform: { default: 'none', isPressed: 'scale(0.98)' },
  transition: 'default',
});
const cardHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 'full' });
const cardIcon = style({ display: 'flex', color: 'blue-1000', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const cardIndex = style({ font: 'ui-sm', color: 'gray-600' });
const cardTitle = style({ display: 'block', marginTop: 16, marginBottom: '[6px]', font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const cardMinutes = style({ font: 'ui-xs', color: 'gray-600' });
const bottomTip = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 20, font: 'ui-sm', color: 'gray-600' });
