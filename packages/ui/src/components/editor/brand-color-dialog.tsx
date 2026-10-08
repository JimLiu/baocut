import { useState } from 'react';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Form, Heading, TextField } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { BRAND_NAME_MAX, normalizeColor } from '../../model/library-brand.ts';
import { ColorField } from './inspector-controls.tsx';
import { BRAND_COPY as IB } from './brand-copy.ts';

const colorRow = style({ display: 'flex', alignItems: 'end', gap: 8 });
const grow = style({ flexGrow: 1, minWidth: 0 });

/** 新建品牌色时先给的颜色（设计稿的蓝）。 */
const START = '#3B63FB';

/**
 * 新建品牌色：名字与色值。色值可以点色块用取色面板挑，也可以直接写 hex（`#RGB`、`#RRGGBB` 或带不透明度的 `#RRGGBBAA`）。
 * 名字空着时用色值当名字。`onSubmit` 返回 false 时留在对话框里（失败的提示由它给）。
 * 状态放在对话框外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。
 */
export function NewColorDialog({ onSubmit, onClose }: { onSubmit(name: string, value: string): Promise<boolean>; onClose(): void }) {
  const [name, setName] = useState('');
  const [text, setText] = useState(START);
  const [busy, setBusy] = useState(false);
  const value = normalizeColor(text);
  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    try {
      if (await onSubmit(name.trim() || value, value)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S">
        {({ close }) => (
          <>
            <Heading slot="title">{IB.newBrandColor}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}>
                <TextField label={IB.name} value={name} onChange={setName} placeholder={IB.namePlaceholder} autoFocus maxLength={BRAND_NAME_MAX} />
                <div className={colorRow}>
                  <ColorField label={IB.color} value={value ?? START} fallback={START} onCommit={setText} />
                  <TextField
                    label={IB.colorValue}
                    value={text}
                    onChange={setText}
                    isInvalid={!value}
                    errorMessage={IB.colorValueError}
                    styles={grow}
                  />
                </div>
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {IB.cancel}
              </Button>
              <Button variant="accent" isDisabled={!value} isPending={busy} onPress={() => void submit()}>
                {IB.add}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
