import { useState } from 'react';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Form, Heading, TextField, ToastQueue } from '@react-spectrum/s2';
import { S } from './shell-copy.ts';

/**
 * 输入一个名字的小对话框（新建项目、重命名）。提交失败时留在对话框里并提示，不吞掉输入。
 * 状态放在对话框外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。
 */
export function NameDialog({
  title,
  label,
  initial = '',
  placeholder,
  description,
  submitLabel,
  allowEmpty = false,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  description?: string;
  submitLabel: string;
  allowEmpty?: boolean;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const valid = allowEmpty || value.trim() !== '';
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } catch (error) {
      ToastQueue.negative(S.nameDialog.failed(submitLabel, (error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S">
        {({ close }) => (
          <>
            <Heading slot="title">{title}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}>
                <TextField
                  label={label}
                  value={value}
                  onChange={setValue}
                  placeholder={placeholder}
                  description={description}
                  autoFocus
                  maxLength={120}
                />
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {S.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!valid} isPending={busy} onPress={() => void submit()}>
                {submitLabel}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
