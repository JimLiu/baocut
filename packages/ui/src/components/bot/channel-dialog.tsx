import { useEffect, useRef, useState } from 'react';
import {
  ACCESS_MODES,
  AGENT_MODES,
  BOT_LIMITS,
  MAIN_CHANNEL_ID,
  RpcError,
  newId,
  type AgentMode,
  type Channel,
  type ChannelPatch,
  type ChannelSummary,
  type Id,
  type Money,
} from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Form,
  Heading,
  NumberField,
  Picker,
  PickerItem,
  ProgressCircle,
  Switch,
  TextArea,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACCESS_MODE_LABEL } from '../../copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useChannelSummary } from '../../state/channels-store.ts';
import { defaultDriver, useConnection } from '../../state/connection-store.ts';
import { AgentPicker } from '../agent-picker.tsx';
import { errorText, useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';

export type ChannelDialogState = { mode: 'create' } | { mode: 'settings'; channelId: Id };

const fieldRow = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const fieldLabel = style({ font: 'ui-sm', color: 'gray-800' });
const twoUp = style({ display: 'flex', gap: 12, flexWrap: 'wrap' });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const body = style({ margin: 0, font: 'body-sm', color: 'gray-800' });
const busyRow = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-700' });

interface Draft {
  name: string;
  purpose: string;
  driverId: string | null;
  model: string | null;
  effort: string | null;
  defaultAccessMode: AgentMode | null;
  maxAccessMode: AgentMode | null;
  outputLanguage: string;
  muted: boolean;
  private: boolean;
  concurrentThreads: number;
  stallMinutes: number | null;
  dailyBudget: string;
  monthlyBudget: string;
  currency: string;
}

function draftOf(channel: Channel | undefined, driverId: string | null): Draft {
  return {
    name: channel?.name ?? '',
    purpose: channel?.purpose ?? '',
    driverId: channel?.driverId ?? driverId,
    model: channel?.model ?? null,
    effort: channel?.effort ?? null,
    defaultAccessMode: channel?.defaultAccessMode ?? null,
    maxAccessMode: channel?.maxAccessMode ?? null,
    outputLanguage: channel?.outputLanguage ?? '',
    muted: channel?.muted ?? false,
    private: channel?.private ?? false,
    concurrentThreads: channel?.limits.concurrentThreads ?? BOT_LIMITS.concurrentThreads,
    stallMinutes: channel?.stallMinutes ?? null,
    dailyBudget: channel?.limits.dailyBudget?.amount ?? '',
    monthlyBudget: channel?.limits.monthlyBudget?.amount ?? '',
    currency: channel?.limits.dailyBudget?.currency ?? channel?.limits.monthlyBudget?.currency ?? 'USD',
  };
}

function money(amount: string, currency: string): Money | null {
  const value = amount.trim();
  return value && Number.isFinite(Number(value)) && Number(value) > 0 ? { amount: value, currency: currency.trim().toUpperCase() || 'USD' } : null;
}

function sameMoney(a: Money | null, b: Money | null): boolean {
  return a === b || (!!a && !!b && a.amount === b.amount && a.currency === b.currency);
}

/** 设置里改了的字段才发（没动的 Agent 不发，频道对话有过任务后换 Agent 会被拒）。 */
function patchOf(channel: Channel, draft: Draft): ChannelPatch {
  const patch: ChannelPatch = {};
  if (draft.name.trim() !== channel.name) patch.name = draft.name.trim();
  if (draft.purpose.trim() !== channel.purpose) patch.purpose = draft.purpose.trim();
  if (draft.driverId && (draft.driverId !== channel.driverId || draft.model !== channel.model || draft.effort !== channel.effort)) {
    patch.driverId = draft.driverId;
    patch.model = draft.model;
    patch.effort = draft.effort;
  }
  if (draft.defaultAccessMode !== channel.defaultAccessMode) patch.defaultAccessMode = draft.defaultAccessMode;
  if (draft.maxAccessMode !== channel.maxAccessMode) patch.maxAccessMode = draft.maxAccessMode;
  const language = draft.outputLanguage.trim() || null;
  if (language !== channel.outputLanguage) patch.outputLanguage = language;
  if (draft.muted !== channel.muted) patch.muted = draft.muted;
  if (draft.private !== channel.private) patch.private = draft.private;
  if (draft.concurrentThreads !== channel.limits.concurrentThreads) patch.concurrentThreads = draft.concurrentThreads;
  if (draft.stallMinutes !== channel.stallMinutes) patch.stallMinutes = draft.stallMinutes;
  const daily = money(draft.dailyBudget, draft.currency);
  if (!sameMoney(daily, channel.limits.dailyBudget)) patch.dailyBudget = daily;
  const monthly = money(draft.monthlyBudget, draft.currency);
  if (!sameMoney(monthly, channel.limits.monthlyBudget)) patch.monthlyBudget = monthly;
  return patch;
}

/**
 * 新建频道与频道设置（BOT-CH-03、BOT-CH-05…07、BOT-SF-01、需求 §11.2）。新建只问名字、用途、Agent、默认访问与产物语言；
 * 设置里再加静音、私密、并发、卡住分钟数与预算，以及归档、恢复和删除。主频道不能归档、删除。
 */
export function ChannelDialog({
  state,
  onClose,
  onCreated,
  onDelete,
}: {
  state: ChannelDialogState;
  onClose: () => void;
  onCreated: (channelId: Id) => void;
  onDelete: (summary: ChannelSummary) => void;
}) {
  const summary = useChannelSummary(state.mode === 'settings' ? state.channelId : null);
  const channel = summary?.channel;
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const fallbackDriver = defaultDriver(drivers, checking)?.id ?? null;
  const [draft, setDraft] = useState<Draft>(() => draftOf(channel, fallbackDriver));
  const [busy, setBusy] = useState<'save' | 'archive' | 'export' | null>(null);
  const call = useBotCall();
  const runtime = useRuntime();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // 打开时 Agent 列表可能还没到：到了再补上默认的那个。
  useEffect(() => {
    if (!draft.driverId && fallbackDriver) setDraft((d) => ({ ...d, driverId: fallbackDriver }));
  }, [draft.driverId, fallbackDriver]);

  const creating = state.mode === 'create';
  if (!creating && !channel) return null;
  const main = channel?.id === MAIN_CHANNEL_ID || channel?.kind === 'main';
  const nameError = !draft.name.trim() ? C.dialog.nameRequired : draft.name.trim().length > BOT_LIMITS.channelName ? C.dialog.tooLong(BOT_LIMITS.channelName) : null;
  const purposeError = draft.purpose.length > BOT_LIMITS.channelPurpose ? C.dialog.tooLong(BOT_LIMITS.channelPurpose) : null;
  const valid = !nameError && !purposeError;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy('save');
    if (creating) {
      const result = await call('channels.create', {
        name: draft.name.trim(),
        purpose: draft.purpose.trim(),
        ...(draft.driverId ? { driverId: draft.driverId, model: draft.model, effort: draft.effort } : {}),
        defaultAccessMode: draft.defaultAccessMode,
        outputLanguage: draft.outputLanguage.trim() || null,
        commandId: newId('cmd'),
      });
      setBusy(null);
      if (result) onCreated(result.channel.id);
      return;
    }
    const patch = patchOf(channel!, draft);
    const result = Object.keys(patch).length ? await call('channels.update', { id: channel!.id, patch }) : true;
    setBusy(null);
    if (result) onClose();
  };

  // 导出频道（BOT-CH-13）：选一个文件夹，Runtime 在里面建一个子文件夹写对话、任务（含状态转换记录）与记忆。
  const exportChannel = async () => {
    if (!channel || busy) return;
    const dir = await runtime.host.pickDirectory({ title: C.dialog.exportPick });
    if (!dir) return;
    setBusy('export');
    const result = await call('channels.export', { id: channel.id, dir });
    setBusy(null);
    if (result)
      ToastQueue.positive(C.dialog.exported(result.path), {
        timeout: 8000,
        actionLabel: C.dialog.exportReveal,
        shouldCloseOnAction: true,
        onAction: () => void runtime.host.revealPath(result.path).catch(() => {}),
      });
  };

  const toggleArchive = async () => {
    if (!channel) return;
    setBusy('archive');
    const result = await call(channel.archived ? 'channels.unarchive' : 'channels.archive', { id: channel.id });
    setBusy(null);
    if (result) onClose();
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{creating ? C.dialog.createTitle : C.dialog.settingsTitle}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}>
                <TextField
                  label={C.dialog.name}
                  value={draft.name}
                  onChange={(value) => set('name', value)}
                  autoFocus={creating}
                  isRequired
                  maxLength={BOT_LIMITS.channelName}
                  isInvalid={!!draft.name && !!nameError}
                  errorMessage={nameError ?? undefined}
                />
                <TextArea
                  label={C.dialog.purpose}
                  description={C.dialog.purposeHint}
                  value={draft.purpose}
                  onChange={(value) => set('purpose', value)}
                  isInvalid={!!purposeError}
                  errorMessage={purposeError ?? undefined}
                />
                <div className={fieldRow}>
                  <span className={fieldLabel}>{C.dialog.agent}</span>
                  <div>
                    <AgentPicker
                      drivers={drivers}
                      driverId={draft.driverId}
                      model={draft.model}
                      effort={draft.effort}
                      lockedTo={null}
                      onChange={(change) => setDraft((d) => ({ ...d, driverId: change.driverId, model: change.model ?? null, effort: change.effort ?? null }))}
                    />
                  </div>
                </div>
                <div className={twoUp}>
                  <Picker
                    label={C.dialog.defaultAccess}
                    selectedKey={draft.defaultAccessMode ?? 'default'}
                    onSelectionChange={(key) => set('defaultAccessMode', key === 'default' ? null : (key as AgentMode))}>
                    <PickerItem id="default">{C.dialog.followDefault}</PickerItem>
                    {AGENT_MODES.map((mode) => (
                      <PickerItem key={mode} id={mode}>
                        {ACCESS_MODE_LABEL[mode]}
                      </PickerItem>
                    ))}
                  </Picker>
                  {creating ? null : (
                    <Picker
                      label={C.dialog.maxAccess}
                      selectedKey={draft.maxAccessMode ?? 'none'}
                      onSelectionChange={(key) => set('maxAccessMode', key === 'none' ? null : (key as AgentMode))}>
                      <PickerItem id="none">{C.dialog.noLimit}</PickerItem>
                      {ACCESS_MODES.map((mode) => (
                        <PickerItem key={mode} id={mode}>
                          {ACCESS_MODE_LABEL[mode]}
                        </PickerItem>
                      ))}
                    </Picker>
                  )}
                </div>
                <TextField
                  label={C.dialog.outputLanguage}
                  placeholder={C.dialog.sameAsConversation}
                  value={draft.outputLanguage}
                  onChange={(value) => set('outputLanguage', value)}
                  maxLength={35}
                />
                {creating ? null : (
                  <>
                    <Switch isSelected={draft.muted} onChange={(on) => set('muted', on)}>
                      {C.dialog.muted}
                    </Switch>
                    <p className={note}>{C.dialog.mutedHint}</p>
                    <Switch isSelected={draft.private} onChange={(on) => set('private', on)}>
                      {C.dialog.private}
                    </Switch>
                    <p className={note}>{C.dialog.privateHint}</p>
                    <div className={twoUp}>
                      <NumberField
                        label={C.dialog.concurrent}
                        minValue={1}
                        maxValue={BOT_LIMITS.maxConcurrentThreads}
                        step={1}
                        value={draft.concurrentThreads}
                        onChange={(value) => Number.isFinite(value) && set('concurrentThreads', value)}
                      />
                      <NumberField
                        label={C.dialog.stall}
                        description={C.dialog.stallHint}
                        minValue={1}
                        maxValue={24 * 60}
                        step={1}
                        value={draft.stallMinutes ?? Number.NaN}
                        onChange={(value) => set('stallMinutes', Number.isFinite(value) ? value : null)}
                      />
                    </div>
                    <div className={twoUp}>
                      <TextField
                        label={C.dialog.dailyBudget}
                        description={C.dialog.budgetHint}
                        inputMode="decimal"
                        value={draft.dailyBudget}
                        onChange={(value) => set('dailyBudget', value)}
                      />
                      <TextField
                        label={C.dialog.monthlyBudget}
                        inputMode="decimal"
                        value={draft.monthlyBudget}
                        onChange={(value) => set('monthlyBudget', value)}
                      />
                      <TextField label={C.dialog.currency} value={draft.currency} maxLength={3} onChange={(value) => set('currency', value)} />
                    </div>
                    {main ? <p className={note}>{C.dialog.mainNote}</p> : null}
                  </>
                )}
              </Form>
            </Content>
            <ButtonGroup>
              {!creating && channel ? (
                <Button variant="secondary" fillStyle="outline" isPending={busy === 'export'} isDisabled={!!busy} onPress={() => void exportChannel()}>
                  {C.dialog.export}
                </Button>
              ) : null}
              {!creating && !main && channel ? (
                <>
                  <Button variant="secondary" fillStyle="outline" isPending={busy === 'archive'} isDisabled={!!busy} onPress={() => void toggleArchive()}>
                    {channel.archived ? C.dialog.unarchive : C.dialog.archive}
                  </Button>
                  {summary ? (
                    <Button variant="negative" fillStyle="outline" isDisabled={!!busy} onPress={() => onDelete(summary)}>
                      {C.dialog.delete}
                    </Button>
                  ) : null}
                </>
              ) : null}
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!valid || !!busy} isPending={busy === 'save'} onPress={() => void submit()}>
                {creating ? C.dialog.create : C.dialog.save}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

interface DeleteCounts {
  threads: number;
  schedules: number;
}

function countsOf(error: unknown): DeleteCounts | null {
  if (!(error instanceof RpcError) || error.code !== 'conflict') return null;
  const details = error.details as Partial<DeleteCounts> | null | undefined;
  return typeof details?.threads === 'number' && typeof details.schedules === 'number' ? { threads: details.threads, schedules: details.schedules } : null;
}

/**
 * 删除频道（BOT-CH-07）：先问 Runtime 此刻会停掉几个线程、删掉几个周期任务（用一个必然不符的确认数去问，`conflict` 带回实时计数），
 * 写进确认框；确认时带上这两个数，期间数变了 Runtime 再拒一次，框里换成新数让用户重新确认。
 */
export function DeleteChannelDialog({ summary, onClose, onDeleted }: { summary: ChannelSummary; onClose: () => void; onDeleted: () => void }) {
  const { channel } = summary;
  const [counts, setCounts] = useState<DeleteCounts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useRuntime().client;
  const deleted = useRef(onDeleted);
  deleted.current = onDeleted;

  useEffect(() => {
    let live = true;
    client
      .request('channels.delete', { id: channel.id, confirm: { threads: -1, schedules: -1 } })
      .then(() => live && deleted.current())
      .catch((error: unknown) => {
        if (!live) return;
        // 不认这个问法时先按摘要里进行中的数写，确认时数不对 Runtime 会拒、带回实时计数。
        setCounts(countsOf(error) ?? { threads: summary.counts.working, schedules: 0 });
      });
    return () => {
      live = false;
    };
  }, [client, channel.id, summary.counts.working]);

  const confirm = async () => {
    if (!counts) return;
    setBusy(true);
    try {
      await client.request('channels.delete', { id: channel.id, confirm: counts });
      onDeleted();
    } catch (error) {
      const next = countsOf(error);
      if (next) setCounts(next);
      else setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S" role="alertdialog">
        {({ close }) => (
          <>
            <Heading slot="title">{C.dialog.deleteTitle(channel.name)}</Heading>
            <Content>
              {failure ? (
                <p className={body}>{C.common.failed(failure)}</p>
              ) : counts ? (
                <p className={body}>{C.dialog.deleteBody(counts.threads, counts.schedules)}</p>
              ) : (
                <div className={busyRow}>
                  <ProgressCircle size="S" isIndeterminate aria-label={C.dialog.deleteCounting} />
                  <span>{C.dialog.deleteCounting}</span>
                </div>
              )}
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="negative" isDisabled={!counts || !!failure} isPending={busy} onPress={() => void confirm()}>
                {C.dialog.deleteConfirm}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
