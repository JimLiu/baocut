import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import type { Json, LineKind } from '../../render/text-style.ts';
import { CaptionThumb } from './caption-thumb.tsx';

/**
 * 属性页「当前词」「动效」两段的格子（原型 `.angrid` / `.ancell`）：每格一张缩略图，画的是这一行套上这一格之后的样子
 * （同画廊的 `CaptionThumb`，跟共用时钟一拍一个词地念），下面是名字。
 */
export interface StyleCell {
  key: string;
  name: string;
  root: Json;
}

const grid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 });
const cell = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'default',
  overflow: 'hidden',
  backgroundColor: 'gray-25',
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: 'solid',
  outlineWidth: { default: 1, isOn: 2, isFocusVisible: 2 },
  outlineOffset: { default: -1, isOn: -2, isFocusVisible: -2 },
  outlineColor: { default: 'gray-200', ':hover': 'gray-400', isOn: 'blue-800', isFocusVisible: 'focus-ring' },
  transition: 'default',
});
const thumb = style({ display: 'block', width: 'full', height: 40 });
const name = style({
  paddingX: 4,
  paddingY: 2,
  font: 'ui-xs',
  color: 'gray-700',
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export function StyleCells({
  label,
  cells,
  value,
  kind,
  isDisabled,
  onPick,
}: {
  label: string;
  cells: readonly StyleCell[];
  value: string | null;
  kind: LineKind;
  isDisabled?: boolean;
  onPick(key: string): void;
}) {
  return (
    <div className={grid} role="group" aria-label={label}>
      {cells.map((c) => (
        <RACButton
          key={c.key}
          aria-label={c.name}
          aria-pressed={c.key === value}
          isDisabled={isDisabled}
          className={({ isFocusVisible, isDisabled: off }) => cell({ isOn: c.key === value, isFocusVisible, isDisabled: off })}
          onPress={() => onPick(c.key)}>
          <span className={thumb}>
            <CaptionThumb root={c.root} kinds={[kind]} px={10} />
          </span>
          <span className={name} title={c.name}>
            {c.name}
          </span>
        </RACButton>
      ))}
    </div>
  );
}
