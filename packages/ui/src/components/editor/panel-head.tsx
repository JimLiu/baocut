import type { ReactNode } from 'react';
import { ActionButton, ToggleButton, ToggleButtonGroup } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

const head = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  boxSizing: 'border-box',
  height: 48,
  paddingX: 12,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const title = style({
  flexGrow: 1,
  minWidth: 0,
  margin: 0,
  font: 'title-sm',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** 页头下面滚动的那一块。 */
export const panelBody = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 16, paddingBottom: 12 });

/** 右侧面板每一页的页头（原型 .panelhd）：48 高，（返回、）标题加右边的操作，下面一条线。 */
export function PanelHead({
  title: text,
  back,
  children,
}: {
  title: string;
  /** 页头左边的返回钮：`label` 是它的说明。 */
  back?: { label: string; onPress(): void };
  children?: ReactNode;
}) {
  return (
    <div className={head}>
      {back ? (
        <ActionButton isQuiet size="S" aria-label={back.label} onPress={back.onPress}>
          <ChevronLeft />
        </ActionButton>
      ) : null}
      <h2 className={title} title={text}>
        {text}
      </h2>
      {children}
    </div>
  );
}

const chipRow = style({ flexShrink: 0, paddingX: 12, paddingTop: 12 });

/** 页头下面那一行分类（原型 .chiprow）：单选，选中的那一格总有一格。 */
export function PanelChips<K extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly { key: K; label: string }[];
  value: K;
  onChange(key: K): void;
}) {
  return (
    <div className={chipRow}>
      <ToggleButtonGroup
        aria-label={label}
        size="S"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (key !== undefined) onChange(key as K);
        }}>
        {items.map((item) => (
          <ToggleButton key={item.key} id={item.key}>
            {item.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}
