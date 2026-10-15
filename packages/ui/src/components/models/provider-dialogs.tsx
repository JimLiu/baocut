import { useState } from 'react';
import type { ModelCapabilitiesView, OnlineCapability } from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Form,
  Heading,
  Radio,
  RadioGroup,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { modelIdTaken, newDeclaredModel } from '../../model/models-cloud.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { addProviderModel } from './model-actions.ts';
import { ADD_MODEL_COPY, CUSTOM_COPY, KEY_COPY, KIND_ITEMS } from './models-copy.ts';

/*
 * 自建端点的「添加模型」对话框与用途四选一（设计稿 settings-provider-detail.jsx、settings-providers.jsx）。
 * 状态放在对话框外层（S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍，见 name-dialog.tsx）；
 * 失败留在对话框里，把原因写在按钮上面，不吞掉输入。
 */

const stack = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const error = style({ margin: 0, font: 'ui-sm', color: 'red-900', overflowWrap: 'anywhere' });
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 用途四选一（设计稿 KIND_ITEMS；添加表单里是一行可换行的选项，见 settings-providers.css `.prov-custom__caps`）。横排放不下时
 * 自动换行，英文等长标签也不会把对话框撑出横向滚动。
 */
export function KindControl({ value, onChange, label }: { value: OnlineCapability; onChange: (value: OnlineCapability) => void; label?: string }) {
  return (
    <RadioGroup label={label ?? CUSTOM_COPY.kind} orientation="horizontal" size="S" value={value} onChange={(key) => onChange(key as OnlineCapability)}>
      {KIND_ITEMS.map((item) => (
        <Radio key={item.key} value={item.key}>
          {item.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}

/** 在一家自建服务商下添加一只模型：模型 ID 与用途（语音合成可带音色 ID）。 */
export function AddModelDialog({
  view,
  providerId,
  label,
  initialModelId = '',
  initialCapability,
  onClose,
  onAdded,
}: {
  view: ModelCapabilitiesView;
  providerId: string;
  label: string;
  initialModelId?: string;
  initialCapability: OnlineCapability;
  onClose: () => void;
  onAdded: (capability: OnlineCapability) => void;
}) {
  const runtime = useRuntime();
  const [modelId, setModelId] = useState(initialModelId);
  const [capability, setCapability] = useState(initialCapability);
  const [voiceIds, setVoiceIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const duplicate = modelId.trim() !== '' && modelIdTaken(view, providerId, modelId);
  const ready = modelId.trim() !== '' && !duplicate;

  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await addProviderModel(runtime, view, providerId, newDeclaredModel(modelId, capability, voiceIds));
      ToastQueue.positive(ADD_MODEL_COPY.added(modelId.trim()), { timeout: 3000 });
      onAdded(capability);
    } catch (err) {
      setFailure(ADD_MODEL_COPY.failed(message(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{`${ADD_MODEL_COPY.title} · ${label}`}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void add();
                }}>
                <div className={stack}>
                  <TextField
                    label={ADD_MODEL_COPY.model}
                    value={modelId}
                    onChange={setModelId}
                    autoFocus
                    isInvalid={duplicate}
                    errorMessage={ADD_MODEL_COPY.taken}
                  />
                  <KindControl value={capability} onChange={setCapability} />
                  {capability === 'synthesizeSpeech' ? (
                    <TextField label={CUSTOM_COPY.voices} placeholder={CUSTOM_COPY.voicesPlaceholder} value={voiceIds} onChange={setVoiceIds} />
                  ) : null}
                  <p className={note}>{ADD_MODEL_COPY.note}</p>
                  {failure ? (
                    <p className={error} role="alert">
                      {failure}
                    </p>
                  ) : null}
                </div>
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {KEY_COPY.cancel}
              </Button>
              <Button variant="accent" isDisabled={!ready} isPending={busy} onPress={() => void add()}>
                {CUSTOM_COPY.add}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
