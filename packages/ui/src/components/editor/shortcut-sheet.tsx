import { useEffect } from 'react';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Heading } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { SHORTCUT_SHEET_COPY as COPY } from '../../copy.ts';
import { keyLabel } from '../../model/key-labels.ts';
import { useEditor } from '../../state/editor-store.ts';

const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/**
 * 编辑器快捷键清单（原型 editor-keys.jsx 的 SHEET 与对话框）：`?` 打开，只列编辑器里真有的键。
 * 原型借全屏播放器的 ↑/↓、M、F 也在清单里：音量与静音只管预览听到的大小（不进视频），F 只把预览画面放到全屏。
 * 帮助中心（help-keys）用同一份 rows。
 */
export function ShortcutSheet() {
  const open = useEditor((s) => s.shortcutsOpen);
  const setOpen = useEditor((s) => s.setShortcutsOpen);
  // 离开编辑器时收起，下次进来不自己弹出。
  useEffect(() => () => setOpen(false), [setOpen]);
  return (
    <DialogContainer onDismiss={() => setOpen(false)}>
      {open ? (
        <Dialog size="S">
          {({ close }) => (
            <>
              <Heading slot="title">{COPY.title}</Heading>
              <Content>
                <div className={list}>
                  {COPY.rows.map(([label, keys]) => (
                    <div key={label} className={row}>
                      <span className={name}>{label}</span>
                      <kbd className={kbd}>{keyLabel(keys, MAC)}</kbd>
                    </div>
                  ))}
                </div>
                <p className={hint}>{COPY.hint}</p>
              </Content>
              <ButtonGroup>
                <Button variant="secondary" onPress={close}>
                  {COPY.done}
                </Button>
              </ButtonGroup>
            </>
          )}
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}

const list = style({ display: 'flex', flexDirection: 'column', gap: '[6px]' });
const row = style({ display: 'flex', alignItems: 'baseline', gap: 12 });
const name = style({ flexGrow: 1, minWidth: 0, font: 'body-sm', color: 'neutral' });
const kbd = style({ flexShrink: 0, font: 'code-xs', color: 'neutral-subdued', whiteSpace: 'nowrap' });
const hint = style({ font: 'body-xs', color: 'neutral-subdued', marginTop: 12, marginBottom: 0 });
