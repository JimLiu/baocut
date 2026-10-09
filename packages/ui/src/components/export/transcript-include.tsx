import { Checkbox } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { EXPORT_COPY } from './export-copy.ts';

/** 文稿「带什么」的五个开关，按这个顺序摆（设计稿 model-transcript.js `TEXT_OPTS`）。 */
export type TranscriptIncludeKey = 'frontmatter' | 'chapters' | 'timestamps' | 'speakers' | 'skipCut';
const KEYS: readonly TranscriptIncludeKey[] = ['frontmatter', 'chapters', 'timestamps', 'speakers', 'skipCut'];

const checks = style({ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 4 });

/**
 * 文稿的五个开关：导出「文稿」页与文稿面板的复制设置共用一份词与顺序（设计稿 transcript-copy.jsx `TxTextChecks`）。
 * 勾选显示生效值，置灰的开关显示为不生效时的样子。
 */
export function TranscriptIncludeChecks({
  value,
  disabled,
  onChange,
}: {
  value: Record<TranscriptIncludeKey, boolean>;
  disabled?: Partial<Record<TranscriptIncludeKey, boolean>>;
  onChange(key: TranscriptIncludeKey, on: boolean): void;
}) {
  return (
    <div className={checks}>
      {KEYS.map((key) => (
        <Checkbox key={key} size="S" isDisabled={!!disabled?.[key]} isSelected={value[key]} onChange={(on) => onChange(key, on)}>
          {EXPORT_COPY[key]}
        </Checkbox>
      ))}
    </div>
  );
}
