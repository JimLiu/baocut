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
  SegmentedControl,
  SegmentedControlItem,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  CAPABILITY_SHORT,
  customDraftReady,
  endpointOwner,
  modelIdTaken,
  newDeclaredModel,
  type CloudProviderCard,
  type CustomProviderDraft,
} from '../../model/models-cloud.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { addCustomProvider, addProviderModel, disconnectProvider, saveProviderKey } from './model-actions.ts';
import { ADD_MODEL_COPY, CUSTOM_COPY, KEY_COPY, KIND_ITEMS } from './models-copy.ts';

/*
 * 云端页的三个对话框（设计稿 settings-cloud.jsx:383-452）：密钥、添加自建服务商、添加模型。
 * 状态放在对话框外层（S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍，见 name-dialog.tsx）；
 * 失败留在对话框里，把原因写在按钮上面，不吞掉输入。
 */

const stack = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const error = style({ margin: 0, font: 'ui-sm', color: 'red-900', overflowWrap: 'anywhere' });
const taken = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
});

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 密钥对话框：「验证并保存」= 启用并验证（不过时 Runtime 拒绝、不保存，原因写在这里）；存好之后交给 `onSaved`（顺手刷新模型）。
 * 内置的「移除密钥」清掉密钥并停用；自建的「删除服务商」先确认一次，连同声明的模型一起删。
 */
export function KeyDialog({ card, onClose, onSaved }: { card: CloudProviderCard; onClose: () => void; onSaved?: () => void }) {
  const runtime = useRuntime();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canSave = card.custom || key.trim() !== '' || card.connected;
  const kinds = card.capabilities.map((c) => CAPABILITY_SHORT[c]).join(' · ');

  const save = async () => {
    if (!canSave || busy) return;
    setBusy('save');
    setFailure(null);
    try {
      await saveProviderKey(runtime, card.providerId, key);
      ToastQueue.positive(KEY_COPY.saved(card.label), { timeout: 3000 });
      onClose();
      onSaved?.();
    } catch (err) {
      setFailure(KEY_COPY.failed(message(err)));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    setFailure(null);
    try {
      await disconnectProvider(runtime, card.providerId);
      ToastQueue.neutral(card.custom ? KEY_COPY.providerRemoved(card.label) : KEY_COPY.removed(card.label), { timeout: 3000 });
      onClose();
    } catch (err) {
      setFailure(KEY_COPY.removeFailed(message(err)));
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) =>
          confirming ? (
            <>
              <Heading slot="title">{KEY_COPY.confirmTitle(card.label)}</Heading>
              <Content>
                <p className={note}>{KEY_COPY.confirmBody}</p>
              </Content>
              <ButtonGroup>
                <Button variant="secondary" onPress={() => setConfirming(false)}>
                  {KEY_COPY.cancel}
                </Button>
                <Button variant="negative" isPending={busy === 'remove'} onPress={() => void remove()}>
                  {KEY_COPY.confirm}
                </Button>
              </ButtonGroup>
            </>
          ) : (
            <>
              <Heading slot="title">{KEY_COPY.title(card.label)}</Heading>
              <Content>
                <Form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}>
                  <div className={stack}>
                    <p className={note}>{card.custom ? KEY_COPY.sharedCustom(card.label) : KEY_COPY.shared(card.label, kinds)}</p>
                    {card.custom && card.endpoint ? <p className={note}>{KEY_COPY.endpoint(card.endpoint)}</p> : null}
                    <TextField
                      label={KEY_COPY.field}
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={setKey}
                      description={card.connected ? KEY_COPY.keep : card.custom ? KEY_COPY.fieldCustom : undefined}
                      autoFocus
                    />
                    <p className={note}>{KEY_COPY.verifyNote}</p>
                    {failure ? (
                      <p className={error} role="alert">
                        {failure}
                      </p>
                    ) : null}
                  </div>
                </Form>
              </Content>
              <ButtonGroup>
                {card.custom || card.connected ? (
                  <Button
                    variant="negative"
                    fillStyle="outline"
                    isPending={busy === 'remove'}
                    isDisabled={busy === 'save'}
                    onPress={() => (card.custom ? setConfirming(true) : void remove())}>
                    {card.custom ? KEY_COPY.removeProvider : KEY_COPY.removeKey}
                  </Button>
                ) : null}
                <Button variant="secondary" onPress={close}>
                  {KEY_COPY.cancel}
                </Button>
                <Button variant="accent" isDisabled={!canSave || busy === 'remove'} isPending={busy === 'save'} onPress={() => void save()}>
                  {KEY_COPY.save}
                </Button>
              </ButtonGroup>
            </>
          )
        }
      </Dialog>
    </DialogContainer>
  );
}

/**
 * 用途四选一（设计稿 settings-cloud.jsx:197 KIND_ITEMS）：四档带英文缩写一行约 520px，
 * 放不进 M 号对话框（480px），所以带这一行的两个对话框用 L 号。
 */
function KindControl({ value, onChange }: { value: OnlineCapability; onChange: (value: OnlineCapability) => void }) {
  return (
    <SegmentedControl aria-label={CUSTOM_COPY.kind} selectedKey={value} onSelectionChange={(key) => onChange(key as OnlineCapability)}>
      {KIND_ITEMS.map((item) => (
        <SegmentedControlItem key={item.key} id={item.key}>
          {item.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** 添加自建服务商：名字、地址、第一只模型与用途；地址已经登记过时提示改加到那一家下面。 */
export function CustomProviderDialog({
  view,
  initialCapability,
  onClose,
  onAdded,
  onUseExisting,
}: {
  view: ModelCapabilitiesView;
  initialCapability: OnlineCapability;
  onClose: () => void;
  onAdded: (providerId: string, capability: OnlineCapability) => void;
  onUseExisting: (providerId: string, modelId: string, capability: OnlineCapability) => void;
}) {
  const runtime = useRuntime();
  const [draft, setDraft] = useState<CustomProviderDraft>({ name: '', url: '', modelId: '', capability: initialCapability, voiceIds: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const owner = endpointOwner(view, draft.url);
  const ready = customDraftReady(draft);
  const patch = (next: Partial<CustomProviderDraft>) => setDraft((old) => ({ ...old, ...next }));

  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const providerId = await addCustomProvider(runtime, view, draft);
      ToastQueue.positive(CUSTOM_COPY.added(draft.name.trim()), { timeout: 3000 });
      onAdded(providerId, draft.capability);
    } catch (err) {
      setFailure(CUSTOM_COPY.failed(message(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="L">
        {({ close }) => (
          <>
            <Heading slot="title">{CUSTOM_COPY.title}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void add();
                }}>
                <div className={stack}>
                  <TextField label={CUSTOM_COPY.name} value={draft.name} onChange={(name) => patch({ name })} autoFocus maxLength={60} />
                  <TextField
                    label={CUSTOM_COPY.url}
                    type="url"
                    placeholder={CUSTOM_COPY.urlPlaceholder}
                    value={draft.url}
                    onChange={(url) => patch({ url })}
                  />
                  {owner ? (
                    <div className={taken}>
                      <p className={note}>{CUSTOM_COPY.taken(owner.label)}</p>
                      <Button variant="secondary" size="S" onPress={() => onUseExisting(owner.providerId, draft.modelId.trim(), draft.capability)}>
                        {CUSTOM_COPY.takenAction(owner.label)}
                      </Button>
                    </div>
                  ) : null}
                  <TextField label={CUSTOM_COPY.model} value={draft.modelId} onChange={(modelId) => patch({ modelId })} />
                  <KindControl value={draft.capability} onChange={(capability) => patch({ capability })} />
                  {draft.capability === 'synthesizeSpeech' ? (
                    <TextField
                      label={CUSTOM_COPY.voices}
                      placeholder={CUSTOM_COPY.voicesPlaceholder}
                      value={draft.voiceIds}
                      onChange={(voiceIds) => patch({ voiceIds })}
                    />
                  ) : null}
                  <p className={note}>
                    {CUSTOM_COPY.noteHead}
                    {CUSTOM_COPY.note[draft.capability]}
                    {CUSTOM_COPY.noteTail}
                  </p>
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
      <Dialog size="L">
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
