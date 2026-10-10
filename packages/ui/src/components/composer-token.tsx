import type { ReactNode } from 'react';
import { ActionButton } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };

// 标记只占内容的宽度（原型 `.home-template-token`、`.cins-token`）：× 是最小号的按钮，图标再小一档；长名字截断，不撑破输入框。
const chip = style({
  display: 'inline-flex',
  alignSelf: 'start',
  alignItems: 'center',
  gap: '[6px]',
  maxWidth: 'full',
  paddingStart: 8,
  paddingEnd: '[2px]',
  paddingY: '[2px]',
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui-sm',
  color: 'gray-800',
  boxSizing: 'border-box',
});
const chipText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const chipNote = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const closeIcon = iconStyle({ size: 'XS' });

/** 输入框正文上方的一枚可移除标记：模板、本机素材、点选的 skill 共用一个样子。 */
export function ComposerToken({
  icon,
  label,
  title,
  note,
  removeLabel,
  onRemove,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  /** 悬停看到的完整说明（例如素材的完整路径）。 */
  title?: string;
  /** 名字后面一句淡色的说明（AI 工具页上「这个工具的做法」）。 */
  note?: string;
  removeLabel: string;
  onRemove(): void;
  onOpen?: () => void;
}) {
  return (
    <span className={chip} title={title ?? label}>
      {onOpen ? (
        <ActionButton slot={null} size="S" isQuiet aria-label={label} onPress={onOpen}>
          {icon}
          <span className={chipText}>{label}</span>
        </ActionButton>
      ) : (
        <>
          {icon}
          <span className={chipText}>{label}</span>
        </>
      )}
      {note ? <span className={chipNote}>{note}</span> : null}
      <ActionButton isQuiet size="XS" aria-label={removeLabel} onPress={onRemove}>
        <Close styles={closeIcon} data-bc-icons="own" />
      </ActionButton>
    </span>
  );
}

/** 一排标记（起始页的模板与素材，会话输入框上的 skill）。 */
export const composerTokenList = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 });
