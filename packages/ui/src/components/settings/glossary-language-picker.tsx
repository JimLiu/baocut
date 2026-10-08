import { Picker, PickerItem } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { languageLabel, languageOptions } from '../../model/library-glossary.ts';

/** 「任意语言」在下拉里的键（语言本身是 null）。 */
const ANY = '*';

const picker = style({ width: 192, flexShrink: 0 });

/**
 * 术语表的语言下拉（设计稿 `LangPick`）：常备的几门，加上当前值里不在其中的；`any` 时第一项是「任意语言」（null）。
 */
export function LanguagePicker({
  label,
  value,
  any = false,
  isDisabled,
  onChange,
}: {
  label: string;
  value: string | null;
  any?: boolean;
  isDisabled?: boolean;
  onChange(tag: string | null): void;
}) {
  const items = [
    ...(any ? [{ key: ANY, label: languageLabel(null) }] : []),
    ...languageOptions([value]).map((tag) => ({ key: tag, label: languageLabel(tag) })),
  ];
  return (
    <Picker
      aria-label={label}
      size="S"
      styles={picker}
      items={items}
      isDisabled={isDisabled}
      selectedKey={value ?? (any ? ANY : null)}
      onSelectionChange={(key) => {
        if (key === null) return;
        const next = key === ANY ? null : String(key);
        if (next !== value) onChange(next);
      }}>
      {(item) => <PickerItem id={item.key}>{item.label}</PickerItem>}
    </Picker>
  );
}
