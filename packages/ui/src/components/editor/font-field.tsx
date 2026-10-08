import { useState } from 'react';
import { ActionButton, DialogTrigger, Picker, PickerItem, Popover, Text } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { SYSTEM_FONT, fontLabel } from '../../model/font-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { FontLibraryList } from './font-library-list.tsx';
import { PRow } from './inspector-controls.tsx';
import { FONT_COPY as FC } from './font-copy.ts';

/**
 * 字体框（产品设计 §5.9「字体」；原型 panel-font-picker.jsx）：属性页的文字样式（文字、计时器类元素、字幕）与舞台工具条
 * 的字体格共用。桌面端是一张表——内置、本机、已下载与可按需下载的族合在一起（font-library-list.tsx）；属性页里在字体行
 * 下面展开（原型的 `inline`），工具条里是弹层。Web 入口的浏览器会话没有 `fonts.*`，保持原来的几种固定字体。
 */

/** Web 入口的固定字体：渲染器认得的几种（别名见 text-style.ts），加上系统里常见的中文字体。认不出的现值也列出来。 */
export const FONTS: { id: string; label: string }[] = [
  {
    id: SYSTEM_FONT,
    get label() {
      return FC.systemFont;
    },
  },
  {
    id: 'PingFang SC',
    get label() {
      return FC.pingFang;
    },
  },
  {
    id: 'Songti SC',
    get label() {
      return FC.songti;
    },
  },
  {
    id: 'Kaiti SC',
    get label() {
      return FC.kaiti;
    },
  },
  { id: 'Montserrat', label: 'Montserrat' },
  { id: 'Bebas Neue', label: 'Bebas Neue' },
  { id: 'Lexend Deca', label: 'Lexend Deca' },
  { id: 'Source Serif 4', label: 'Source Serif 4' },
];
export const FONT_ALIASES: Record<string, string> = {
  montserrat: 'Montserrat',
  bebas: 'Bebas Neue',
  lexend: 'Lexend Deca',
  serif: 'Source Serif 4',
};

/** 文字样式里的 `fontFamily` → 字体框的现值（没写是系统字体，旧的别名换成族名）。 */
export function currentFont(raw: unknown): string {
  const value = typeof raw === 'string' && raw.trim() ? raw : SYSTEM_FONT;
  return FONT_ALIASES[value] ?? value;
}

const grow = style({ flexGrow: 1, minWidth: 0 });
const field = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexGrow: 1,
  minWidth: 0,
  height: 24,
  paddingStart: 8,
  paddingEnd: 4,
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-300', isFocusVisible: 'blue-800', isDisabled: 'gray-100' },
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  font: 'ui-sm',
  color: { default: 'gray-800', isDisabled: 'disabled' },
  outlineStyle: 'none',
  cursor: 'default',
});
const fieldText = style({
  flexGrow: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'start',
});
const fieldIcon = style({ flexShrink: 0, display: 'flex', color: 'gray-600' });
const inlinePanel = style({ marginTop: '[6px]', marginBottom: 8 });
const quietText = style({ maxWidth: 112, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

interface FontFieldProps {
  /** 文字样式里原样的 `fontFamily`（可能没有、可能是旧别名）。 */
  value: unknown;
  isDisabled?: boolean;
  onChange(family: string): void;
}

/** 属性页的「字体」一行：点开在下面展开一张表，选中即收起。 */
export function FontField({ value, isDisabled = false, onChange }: FontFieldProps) {
  const web = useRuntime().host.platform === 'web';
  const font = currentFont(value);
  const [open, setOpen] = useState(false);
  if (web) {
    return (
      <PRow label={FC.font}>
        <FixedFontPicker font={font} isDisabled={isDisabled} onChange={onChange} />
      </PRow>
    );
  }
  return (
    <>
      <PRow label={FC.font}>
        <RACButton
          className={field}
          isDisabled={isDisabled}
          aria-expanded={open}
          aria-label={FC.fontValue(FC.font, fontLabel(font))}
          onPress={() => setOpen(!open)}>
          <span className={fieldText}>{fontLabel(font)}</span>
          <span className={fieldIcon}>
            <ChevronDown />
          </span>
        </RACButton>
      </PRow>
      {open && !isDisabled ? (
        <div className={inlinePanel}>
          <FontLibraryList
            value={font}
            inline
            onPick={(family) => {
              setOpen(false);
              if (family !== font) onChange(family);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

/** 舞台工具条的字体格：安静的按钮，点开是弹层（原型 stage-toolbar.jsx 的 268px 下拉）。 */
export function ToolbarFontField({ value, isDisabled = false, onChange, label }: FontFieldProps & { label: string }) {
  const web = useRuntime().host.platform === 'web';
  const font = currentFont(value);
  const [open, setOpen] = useState(false);
  if (web) return <FixedFontPicker font={font} isDisabled={isDisabled} onChange={onChange} quiet label={label} />;
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <ActionButton isQuiet size="S" isDisabled={isDisabled} aria-label={FC.fontValue(label, fontLabel(font))}>
        <Text>
          <span className={quietText}>{fontLabel(font)}</span>
        </Text>
        <ChevronDown />
      </ActionButton>
      <Popover placement="bottom" aria-label={label}>
        <FontLibraryList
          value={font}
          onPick={(family) => {
            setOpen(false);
            if (family !== font) onChange(family);
          }}
        />
      </Popover>
    </DialogTrigger>
  );
}

/** Web 入口：原来的固定几种（浏览器会话没有 `fonts.*`，不能下载也不能列本机字体）。 */
function FixedFontPicker({
  font,
  isDisabled,
  onChange,
  quiet = false,
  label = FC.font,
}: {
  font: string;
  isDisabled: boolean;
  onChange(family: string): void;
  quiet?: boolean;
  label?: string;
}) {
  const fonts = FONTS.some((f) => f.id === font) ? FONTS : [...FONTS, { id: font, label: font }];
  return (
    <Picker
      aria-label={label}
      size="S"
      isQuiet={quiet}
      styles={quiet ? undefined : grow}
      isDisabled={isDisabled}
      value={font}
      onChange={(key) => key !== null && key !== font && onChange(String(key))}>
      {fonts.map((f) => (
        <PickerItem key={f.id} id={f.id}>
          {f.label}
        </PickerItem>
      ))}
    </Picker>
  );
}
