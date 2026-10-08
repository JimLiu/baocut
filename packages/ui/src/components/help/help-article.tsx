import { ActionButton, Button, Text } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { HELP_COPY as COPY } from '../../copy.ts';
import { quickStart, type HelpCta, type HelpGuide } from '../../model/help-guides.ts';
import { GuideIcon, detail, eyebrow } from './help-guide-list.tsx';

/**
 * 一篇指南（原型 help-center.jsx 的 `article`）：返回、标题、编号步骤、提示、去做的按钮与说明、
 * 快速上手里接着读下一篇。
 */
export function HelpArticle({
  guide,
  backLabel,
  cta,
  onBack,
  onAction,
  onRead,
}: {
  guide: HelpGuide;
  backLabel: string;
  cta: HelpCta;
  onBack(): void;
  onAction(): void;
  onRead(guide: HelpGuide): void;
}) {
  const quick = quickStart();
  const at = quick.findIndex((g) => g.id === guide.id);
  const next = at >= 0 ? (quick[at + 1] ?? null) : null;
  return (
    <article>
      <ActionButton isQuiet size="S" onPress={onBack}>
        <ChevronLeft />
        <Text>{backLabel}</Text>
      </ActionButton>
      <div className={heading}>
        <span className={eyebrow}>
          <GuideIcon icon={guide.icon} />
          {COPY.readTime(guide.minutes)}
        </span>
        <h2 className={title}>{guide.title}</h2>
        <p className={summary}>{guide.summary}</p>
      </div>
      <ol className={steps}>
        {guide.steps.map(([stepTitle, body], index) => (
          <li key={stepTitle} className={step}>
            <span className={number} aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3 className={stepHeading}>{stepTitle}</h3>
              <p className={stepBody}>{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className={note}>
        <span className={noteIcon}>
          <InfoCircle />
        </span>
        <p className={noteText}>{guide.tip}</p>
      </div>
      <div className={action}>
        <Button variant="accent" onPress={onAction}>
          {cta.label}
        </Button>
        <span className={detail}>{cta.needsVideo ? COPY.pickVideoNote : cta.target === 'close' ? COPY.backNote : COPY.ctaNote}</span>
      </div>
      {next ? (
        <RACButton className={(state) => nextRow(state)} onPress={() => onRead(next)}>
          {COPY.next(next.title)}
          <ChevronRight />
        </RACButton>
      ) : null}
    </article>
  );
}

const heading = style({ marginY: 24 });
const title = style({ marginTop: 8, marginBottom: 0, fontSize: 'ui-3xl', fontWeight: 'extra-bold', lineHeight: '[1.3]', color: 'gray-900' });
const summary = style({ marginTop: 8, marginBottom: 0, font: 'body-sm', lineHeight: '[1.6]', color: 'gray-700' });
const steps = style({ listStyleType: 'none', padding: 0, margin: 0 });
const step = style({ display: 'flex', gap: 16, marginY: 24 });
const number = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  size: 24,
  borderRadius: 'full',
  backgroundColor: 'gray-100',
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-800',
});
const stepHeading = style({ margin: 0, font: 'ui', fontWeight: 'bold', lineHeight: '[24px]', color: 'gray-900' });
const stepBody = style({ marginTop: 4, marginBottom: 0, font: 'body-sm', lineHeight: '[1.6]', color: 'gray-700' });
const note = style({ display: 'flex', alignItems: 'start', gap: 8, padding: 16, borderRadius: 'lg', backgroundColor: 'blue-100', color: 'blue-1000' });
const noteIcon = style({ display: 'flex', flexShrink: 0, marginTop: 2, '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const noteText = style({ margin: 0, font: 'ui-sm', lineHeight: '[1.6]', color: 'blue-1000' });
const action = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 24 });
const nextRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  boxSizing: 'border-box',
  width: 'full',
  marginTop: 24,
  paddingTop: 20,
  paddingBottom: 0,
  paddingX: 0,
  borderWidth: 0,
  borderTopWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'transparent',
  font: 'ui-sm',
  color: 'blue-1000',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  textAlign: 'start',
  cursor: 'pointer',
  textDecoration: { default: 'none', isHovered: 'underline' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
