import { useMemo, useState } from 'react';
import type { Id, TimelineItem } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { openChips } from '../../../model/bot.ts';
import { useRuntime } from '../../../runtime/context.tsx';
import { pressChip } from '../bot-actions.ts';
import { BOT_COPY as C } from '../bot-copy.ts';

/** 与输入框同宽同边距（composer 的 760 列、左右 24）。 */
const row = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  width: 'full',
  maxWidth: '[760px]',
  marginX: 'auto',
  paddingX: 24,
  paddingBottom: 8,
  boxSizing: 'border-box',
});

/**
 * 提示芯片（BOT-SG-01…04，需求 §7.3）：只挂在最新一条智能体消息的那组上，最多 4 个；用户发了消息或有更新的智能体消息就收起。
 * 点了发出完整的句子（`via: 'suggestion'`），「其他…」只聚焦输入框，起手提示只填进输入框。推荐项用 accent 描边，其余平列。
 */
export function SuggestionChips({ conversationId, items, disabled }: { conversationId: Id; items: readonly TimelineItem[]; disabled?: boolean }) {
  const runtime = useRuntime();
  const open = useMemo(() => openChips(items), [items]);
  const [pending, setPending] = useState<Id | null>(null);
  if (!open) return null;
  return (
    <div className={row} role="group" aria-label={C.chips.label}>
      {open.chips.map((chip) => (
        <Button
          key={chip.id}
          size="S"
          variant={chip.recommended ? 'accent' : 'secondary'}
          fillStyle="outline"
          isDisabled={disabled || (pending !== null && pending !== chip.id)}
          isPending={pending === chip.id}
          onPress={async () => {
            setPending(chip.id);
            try {
              await pressChip(runtime, conversationId, chip);
            } finally {
              setPending(null);
            }
          }}>
          {chip.label}
        </Button>
      ))}
    </div>
  );
}
