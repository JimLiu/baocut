import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { ActionButton, Badge, Content, Heading, InlineAlert, Text } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TextArea as RacTextArea, TextField as RacTextField } from 'react-aria-components';
import { useShell } from '../../state/shell-store.ts';
import { UtilityPage } from '../utility-page.tsx';
import { PAGE_COPY } from './tools-copy.ts';

/*
 * 工具工作台共用的版式（设计稿 tools.css `.ttsw*`）：左边表单的几节、右边吸住的记录栏，窄时上下叠放；
 * 子页顶上「← 工具」，标题右边是那行现状、⌘↵ 与主按钮（设计稿放在吸顶的导航栏里，这里放在页头）。
 */

const back = style({ alignSelf: 'start', marginBottom: 12, marginStart: -8 });
const actions = style({ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: 1 });
const chipRow = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: -12, marginBottom: 24 });

/** 工具子页：返回总览、标题、页头右边一组控件、标题下一枚「走谁的服务」的标签。 */
export function ToolPage({ title, bar, chip, children }: { title: string; bar?: ReactNode; chip?: ReactNode; children: ReactNode }) {
  const go = useShell((s) => s.go);
  return (
    <UtilityPage
      kind="tools"
      title={title}
      actions={bar ? <div className={actions}>{bar}</div> : undefined}
      before={
        <ActionButton isQuiet size="S" styles={back} onPress={() => go({ tab: 'tools' })}>
          <ChevronLeft />
          <Text>{PAGE_COPY.back}</Text>
        </ActionButton>
      }>
      {chip ? <div className={chipRow}>{chip}</div> : null}
      {children}
    </UtilityPage>
  );
}

const statusText = style({
  font: 'ui-sm',
  color: { default: 'gray-700', isBad: 'orange-1000' },
  minWidth: 0,
  maxWidth: '[360px]',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const hotkey = style({ font: 'code-xs', color: 'gray-600', flexShrink: 0 });

/** 页头那行现状（门没过或有问题时变橙）与快捷键提示。 */
export function BarStatus({ text, bad, hint = true }: { text: string; bad: boolean; hint?: boolean }) {
  return (
    <>
      <span className={statusText({ isBad: bad })} title={text} role="status" aria-live="polite">
        {text}
      </span>
      {hint ? (
        <span className={hotkey} aria-hidden>
          {PAGE_COPY.hotkey}
        </span>
      ) : null}
    </>
  );
}

/** 页头标题下那枚标签（设计稿 `Chip icon="remote" tone="notice"`）。 */
export function HeaderChip({ text, tone = 'notice' }: { text: string; tone?: 'notice' | 'neutral' }) {
  return (
    <Badge variant={tone} size="S" fillStyle="subtle">
      {text}
    </Badge>
  );
}

// ---- 工作台：左表单、右记录 ----

const bench = style({ containerType: 'inline-size', minWidth: 0 });
const benchGrid = style({
  display: 'grid',
  gridTemplateColumns: { default: '[minmax(0, 1fr) 360px]', '@container (max-width: 760px)': '[minmax(0, 1fr)]' },
  gap: 24,
  alignItems: 'start',
});
const benchMain = style({ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 });
const benchSide = style({
  position: { default: 'sticky', '@container (max-width: 760px)': 'static' },
  top: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
});

/** 左边一列表单、右边 360 宽的记录栏（右栏吸住）；内容区窄于 760 时上下叠放。 */
export function Workbench({ main, side, sideLabel, onKeyDown }: { main: ReactNode; side: ReactNode; sideLabel: string; onKeyDown?: (e: KeyboardEvent) => void }) {
  return (
    <div className={bench}>
      <div className={benchGrid} onKeyDown={onKeyDown}>
        <div className={benchMain}>{main}</div>
        <aside className={benchSide} aria-label={sideLabel}>
          {side}
        </aside>
      </div>
    </div>
  );
}

/** ⌘↵ / Ctrl+↵：在表单里按下就提交（设计稿把它挂在整个工作台上）。 */
export function submitOnModEnter(submit: () => void) {
  return (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };
}

const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  minWidth: 0,
});
const sectionHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 });
const grow = style({ flexGrow: 1 });
const sectionTitle = style({ flexGrow: 1, margin: 0, font: 'detail', fontWeight: 'bold', color: 'gray-700' });

/** 表单的一节（`.ttsw__sec`）：小标题、右边的链接，下面是内容。 */
export function Section({ title, aside, children, label }: { title?: string; aside?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section className={section} aria-label={label ?? title}>
      {title || aside ? (
        <div className={sectionHead}>
          {title ? <h2 className={sectionTitle}>{title}</h2> : <span className={grow} />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const row = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 32, minWidth: 0 });
const rowLabel = style({ flexShrink: 0, width: 64, font: 'ui-sm', color: 'gray-700' });
const indent = style({ marginStart: '[72px]', minWidth: 0 });

/** 一行：左边 64 宽的名字，右边控件（`.ttsw__row` / `.ttsw__lab`）。 */
export function Row({ label, children, id }: { label?: string; children: ReactNode; id?: string }) {
  return (
    <div className={row}>
      {label !== undefined ? (
        <span className={rowLabel} id={id}>
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** 与行里的控件对齐的缩进块（`.ttsw__indent`）。 */
export function Indent({ children }: { children: ReactNode }) {
  return <div className={indent}>{children}</div>;
}

/** 小字说明（`.t-detail-xs`）。 */
export const detail = style({ font: 'ui-xs', color: 'gray-600', minWidth: 0 });
export const detailGrow = style({ font: 'ui-xs', color: 'gray-600', minWidth: 0, flexGrow: 1 });
export const detailOver = style({ font: 'ui-xs', color: 'red-900', minWidth: 0, flexGrow: 1 });
export const hintText = style({ font: 'ui-sm', color: 'gray-600', margin: 0 });

const sideHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 });
const sideTitle = style({ flexGrow: 1, margin: 0, font: 'title-sm', color: 'gray-900' });
const sideFoot = style({ padding: 4, font: 'ui-xs', color: 'gray-600', margin: 0 });

/** 右栏的标题：「生成记录」+ 「N 条进行中」或「N 条」，可再带一个按钮。 */
export function SideHead({ title, live, count, extra }: { title: string; live: string | null; count: string; extra?: ReactNode }) {
  return (
    <div className={sideHead}>
      <h2 className={sideTitle}>{title}</h2>
      {extra}
      {live ? (
        <Badge variant="accent" size="S" fillStyle="subtle">
          {live}
        </Badge>
      ) : (
        <span className={detail}>{count}</span>
      )}
    </div>
  );
}

/** 右栏底下那段说明（`.ttsw__sidefoot`）。 */
export function SideFoot({ children }: { children: ReactNode }) {
  return <p className={sideFoot}>{children}</p>;
}

const gateActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 });

/** 门卡（设计稿 `.aicard--warn`：先连接 X、先下载 X）：一句标题、一段说明、一排按钮。 */
export function Gate({ title, body, actions: buttons }: { title: string; body: ReactNode; actions?: ReactNode }) {
  return (
    <InlineAlert variant="notice">
      <Heading>{title}</Heading>
      <Content>
        {body}
        {buttons ? <div className={gateActions}>{buttons}</div> : null}
      </Content>
    </InlineAlert>
  );
}

const textField = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const textBox = style({
  display: 'block',
  width: 'full',
  boxSizing: 'border-box',
  minHeight: { default: 160, isCompact: 96 },
  margin: 0,
  paddingX: 12,
  paddingY: 8,
  font: 'body-sm',
  color: 'gray-900',
  backgroundColor: 'gray-25',
  borderWidth: 2,
  borderStyle: 'solid',
  borderRadius: 'lg',
  borderColor: { default: 'gray-300', isHovered: 'gray-400', isFocused: 'gray-900' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
  transition: 'default',
});

/**
 * 工作台的大文本框（设计稿 `Field area` + `.ttsw__text`：至少六七行高、可往下拉）。S2 的 TextArea 随内容长高、
 * 空着时只有一行，这里用 RAC 的 TextField + TextArea 自己画。
 */
export function ToolTextArea({
  label,
  value,
  onChange,
  placeholder,
  inputRef,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** 窄栏（编辑器右侧面板）里矮一些，约四行。 */
  compact?: boolean;
}) {
  return (
    <RacTextField aria-label={label} value={value} onChange={onChange} className={textField}>
      <RacTextArea
        ref={inputRef}
        placeholder={placeholder}
        className={(rp) => textBox({ ...rp, isCompact: compact })}
        style={{ resize: 'vertical' }}
      />
    </RacTextField>
  );
}

const linkButton = style({ flexShrink: 0 });

/** 节头右边的小链接（设计稿 `.viewall`）。 */
export function SectionLink({ children, onPress, isDisabled }: { children: ReactNode; onPress: () => void; isDisabled?: boolean }) {
  return (
    <ActionButton isQuiet size="XS" styles={linkButton} onPress={onPress} isDisabled={isDisabled}>
      <Text>{children}</Text>
    </ActionButton>
  );
}

// ---- 记录卡 ----

const record = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isRunning: 'blue-700', isFailed: 'orange-400' },
  minWidth: 0,
});

/** 右栏的一张记录卡（`.ttsrec`）：在跑时描一圈蓝。 */
export function RecordCard({ running, failed, label, children }: { running?: boolean; failed?: boolean; label: string; children: ReactNode }) {
  return (
    <article className={record({ isRunning: !!running, isFailed: !!failed })} aria-label={label}>
      {children}
    </article>
  );
}

export const recordHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, minWidth: 0 });
export const recordIcon = style({ display: 'flex', flexShrink: 0, color: 'blue-900', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
export const recordTitle = style({
  flexGrow: 1,
  minWidth: 0,
  margin: 0,
  font: 'title-sm',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const recordText = style({
  margin: 0,
  font: 'ui-sm',
  color: { default: 'gray-800', isOff: 'gray-500' },
  lineClamp: 2,
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
export const recordRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 });
