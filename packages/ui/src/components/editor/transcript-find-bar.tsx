import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ActionButton, Button, TextField, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Close from '@react-spectrum/s2/icons/Close';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { FindOptions } from '../../model/text-find.ts';
import { TRANSCRIPT_TOOLS_COPY as T } from './transcript-copy.ts';

/**
 * 文稿面板的查找替换条（设计稿 panels.jsx `<FindBar find placeholder="在文稿里查找" hint={lockHint}>`）。外观与键位照字幕面板的
 * 查找条（Enter 下一个、⇧Enter 上一个、Esc 关）；多一行 `hint`：当前命中为什么改不了（译文只查不改等），这时「替换」是灰的。
 */

const findbar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '[6px]',
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
});
const findRow = style({ display: 'flex', alignItems: 'center', gap: '[6px]' });
const findField = style({ flexGrow: 1, minWidth: 0 });
const findCount = style({
  flexShrink: 0,
  minWidth: 44,
  textAlign: 'end',
  font: 'ui-xs',
  color: { default: 'gray-600', isBad: 'red-1000' },
});
const findNote = style({ paddingX: 8, paddingY: 4, borderRadius: 'default', backgroundColor: 'red-100', font: 'ui-xs', color: 'red-1100' });
const hintRow = style({ display: 'flex', alignItems: 'center', gap: 4, font: 'ui-xs', color: 'gray-700' });
const hintIcon = iconStyle({ size: 'S' });
const grow = style({ flexGrow: 1 });

export function TranscriptFindBar({
  query,
  setQuery,
  replacement,
  setReplacement,
  options,
  setOptions,
  error,
  count,
  index,
  onStep,
  onClose,
  canReplace,
  canReplaceAll,
  hint,
  onReplace,
  onReplaceAll,
}: {
  query: string;
  setQuery(value: string): void;
  replacement: string;
  setReplacement(value: string): void;
  options: FindOptions;
  setOptions(options: FindOptions): void;
  error: string | null;
  count: number;
  index: number;
  onStep(direction: 1 | -1): void;
  onClose(): void;
  /** 当前这一处能不能替换。 */
  canReplace: boolean;
  /** 有没有能替换的命中。 */
  canReplaceAll: boolean;
  /** 当前命中改不了的原因。 */
  hint: string | null;
  onReplace(): void;
  onReplaceAll(): void;
}) {
  const label = error ? T.badRegex : !query ? '' : count ? `${index + 1} / ${count}` : T.noResults;
  const escape = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  const option = (key: keyof FindOptions, text: string, tip: string) => (
    <TooltipTrigger>
      <ToggleButton size="XS" aria-label={tip} isSelected={options[key]} onChange={(on) => setOptions({ ...options, [key]: on })}>
        {text}
      </ToggleButton>
      <Tooltip>{tip}</Tooltip>
    </TooltipTrigger>
  );
  return (
    <div className={findbar} role="search" aria-label={T.findLabel}>
      <div className={findRow}>
        <TextField
          aria-label={T.find}
          placeholder={T.findPlaceholder}
          size="S"
          autoFocus
          value={query}
          onChange={setQuery}
          isInvalid={!!error}
          styles={findField}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onStep(event.shiftKey ? -1 : 1);
            }
            escape(event);
          }}
        />
        <span className={findCount({ isBad: !!error })}>{label}</span>
        <ActionButton isQuiet size="XS" aria-label={T.previous} isDisabled={!count} onPress={() => onStep(-1)}>
          <ChevronUp />
        </ActionButton>
        <ActionButton isQuiet size="XS" aria-label={T.next} isDisabled={!count} onPress={() => onStep(1)}>
          <ChevronDown />
        </ActionButton>
        <ActionButton isQuiet size="XS" aria-label={T.closeFind} onPress={onClose}>
          <Close />
        </ActionButton>
      </div>
      <div className={findRow}>
        <TextField aria-label={T.replaceWith} placeholder={T.replaceWith} size="S" value={replacement} onChange={setReplacement} styles={findField} onKeyDown={escape} />
        {option('matchCase', 'Aa', T.matchCase)}
        {option('wholeWord', T.wholeWordShort, T.wholeWord)}
        {option('regex', '.*', T.regex)}
      </div>
      <div className={findRow}>
        <span className={grow} />
        <Button size="S" variant="secondary" isDisabled={!canReplace} onPress={onReplace}>
          {T.replace}
        </Button>
        <Button size="S" variant="secondary" isDisabled={!canReplaceAll} onPress={onReplaceAll}>
          {T.replaceAll}
        </Button>
      </div>
      {hint ? (
        <div className={hintRow} role="status">
          <InfoCircle styles={hintIcon} />
          <span>{hint}</span>
        </div>
      ) : null}
      {error ? <div className={findNote}>{T.regexError(error)}</div> : null}
    </div>
  );
}
