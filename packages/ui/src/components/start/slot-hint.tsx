import { ActionButton } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { HOME_COPY } from '../../copy.ts';
import { S } from '../shell-copy.ts';

// 托盘下面一行小字 + quiet 按钮，与托盘里的内容左对齐（原型 `.pslot-hint`）；没有待填项时整行不占高度。
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginX: 16,
  marginTop: { default: 4, isEmpty: 0 },
  paddingX: 12,
  minWidth: 0,
});
const text = style({ minWidth: 0, font: 'ui-sm', color: 'gray-700', lineHeight: '[1.5]' });

/**
 * 待填提示（模板包规范 §5.5；原型 new-agent.jsx `SlotHint`）：输入框里还有占位符时，框下面一行说还有几处、是哪些，
 * 不填也能发送；「填下一处」把焦点放回输入框并选中下一个占位符（同 Tab）。没有待填项时只留一个空的 status 区，
 * 读屏在填完时不会被打断，下一次出现时照常播报。
 */
export function SlotHint({ labels, onNext }: { labels: readonly string[]; onNext(): void }) {
  return (
    <div className={row({ isEmpty: !labels.length })} role="status">
      {labels.length ? (
        <>
          <span className={text}>{HOME_COPY.slotsLeft(labels.length, S.list(labels))}</span>
          <ActionButton isQuiet size="S" onPress={onNext}>
            {HOME_COPY.fillNextSlot}
          </ActionButton>
        </>
      ) : null}
    </div>
  );
}
