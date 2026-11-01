import { useEffect, useRef, useState } from 'react';
import {
  ACCESS_MODES,
  AGENT_MODES,
  BOT_LIMITS,
  MAIN_CHANNEL_ID,
  RpcError,
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
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACCESS_MODE_LABEL } from '../../copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useBotLayout } from '../../state/bot-layout-store.ts';
import { useChannelSummary } from '../../state/channels-store.ts';
import { defaultDriver, useConnection } from '../../state/connection-store.ts';
import { AgentPicker } from '../agent-picker.tsx';
import { errorText, useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';

const fieldRow = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const fieldLabel = style({ font: 'ui-sm', color: 'gray-800' });
const twoUp = style({ display: 'flex', gap: 12, flexWrap: 'wrap' });
// 并排的字段在换行的 flex 里会缩到最窄（输入框只剩几像素）：平分一行，放不下再换行，只有一个时占满。
const cell = style({ flexGrow: 1, flexBasis: 0, minWidth: 120 });
// 导出、归档、删除不进底部按钮组：五个按钮挤不下，按钮组会竖着排成一列。
const manageRow = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24 });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
/** 对话框标题下面的频道名、删除确认框里的说明。 */
const lead = style({ margin: 0, marginBottom: 12, font: 'ui', color: 'gray-700' });
const body = style({ margin: 0, font: 'body-sm', color: 'gray-800' });
const deleteNote = style({ margin: 0, marginTop: 12, font: 'ui', color: 'gray-700' });
const busyRow = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-700' });

interface Draft {
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
 * 频道设置（BOT-CH-03、BOT-CH-05…07、BOT-SF-01、需求 §11.3 修订，原型 page-bot-channel-dialogs.jsx `BotSettingsDialog`）：
 * Agent 与模型、默认与最高访问模式、产物语言、静音、私密、同时工作的任务数、停下阈值、预算；下面是导出、归档、删除（主频道只有导出）。
 * 名字与说明不在这里：频道菜单的「重命名…」「说明…」各有对话框。归档与删除打开各自的确认框，恢复直接做。
 */
export function ChannelSettingsDialog({ channelId, onClose }: { channelId: Id; onClose: () => void }) {
  const summary = useChannelSummary(channelId);
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

  if (!channel) return null;
  const main = channel.id === MAIN_CHANNEL_ID || channel.kind === 'main';

  const submit = async () => {
    if (busy) return;
    const patch = patchOf(channel, draft);
    if (!Object.keys(patch).length) return onClose();
    setBusy('save');
    const result = await call('channels.update', { id: channel.id, patch });
    setBusy(null);
    if (result) onClose();
  };

  // 导出频道（BOT-CH-13）：选一个文件夹，Runtime 在里面建一个子文件夹写对话、任务（含状态转换记录）与记忆。
  const exportChannel = async () => {
    if (busy) return;
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

  const restore = async () => {
    setBusy('archive');
    const result = await call('channels.unarchive', { id: channel.id });
    setBusy(null);
    if (!result) return;
    ToastQueue.positive(C.dialog.restored(channel.name), { timeout: 5000 });
    onClose();
  };
  const openDialog = (kind: 'archive' | 'delete') => useBotLayout.getState().setDialog({ kind, channelId: channel.id });

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{C.dialog.settingsTitle}</Heading>
            <Content>
              <p className={lead}>{channel.name}</p>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}>
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
                    styles={cell}
                    selectedKey={draft.defaultAccessMode ?? 'default'}
                    onSelectionChange={(key) => set('defaultAccessMode', key === 'default' ? null : (key as AgentMode))}>
                    <PickerItem id="default">{C.dialog.followDefault}</PickerItem>
                    {AGENT_MODES.map((mode) => (
                      <PickerItem key={mode} id={mode}>
                        {ACCESS_MODE_LABEL[mode]}
                      </PickerItem>
                    ))}
                  </Picker>
                  <Picker
                    label={C.dialog.maxAccess}
                    styles={cell}
                    selectedKey={draft.maxAccessMode ?? 'none'}
                    onSelectionChange={(key) => set('maxAccessMode', key === 'none' ? null : (key as AgentMode))}>
                    <PickerItem id="none">{C.dialog.noLimit}</PickerItem>
                    {ACCESS_MODES.map((mode) => (
                      <PickerItem key={mode} id={mode}>
                        {ACCESS_MODE_LABEL[mode]}
                      </PickerItem>
                    ))}
                  </Picker>
                </div>
                <TextField
                  label={C.dialog.outputLanguage}
                  placeholder={C.dialog.sameAsConversation}
                  value={draft.outputLanguage}
                  onChange={(value) => set('outputLanguage', value)}
                  maxLength={35}
                />
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
                    styles={cell}
                    minValue={1}
                    maxValue={BOT_LIMITS.maxConcurrentThreads}
                    step={1}
                    value={draft.concurrentThreads}
                    onChange={(value) => Number.isFinite(value) && set('concurrentThreads', value)}
                  />
                  <NumberField
                    label={C.dialog.stall}
                    styles={cell}
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
                    styles={cell}
                    description={C.dialog.budgetHint}
                    inputMode="decimal"
                    value={draft.dailyBudget}
                    onChange={(value) => set('dailyBudget', value)}
                  />
                  <TextField
                    label={C.dialog.monthlyBudget}
                    styles={cell}
                    inputMode="decimal"
                    value={draft.monthlyBudget}
                    onChange={(value) => set('monthlyBudget', value)}
                  />
                  <TextField label={C.dialog.currency} styles={cell} value={draft.currency} maxLength={3} onChange={(value) => set('currency', value)} />
                </div>
                {main ? <p className={note}>{C.dialog.mainNote}</p> : null}
              </Form>
              <div className={manageRow}>
                <Button variant="secondary" fillStyle="outline" isPending={busy === 'export'} isDisabled={!!busy} onPress={() => void exportChannel()}>
                  {C.dialog.export}
                </Button>
                {main ? null : (
                  <>
                    <Button
                      variant="secondary"
                      fillStyle="outline"
                      isPending={busy === 'archive'}
                      isDisabled={!!busy}
                      onPress={() => (channel.archived ? void restore() : openDialog('archive'))}>
                      {channel.archived ? C.dialog.unarchive : C.sidebar.archive}
                    </Button>
                    <Button variant="negative" fillStyle="outline" isDisabled={!!busy} onPress={() => openDialog('delete')}>
                      {C.dialog.delete}
                    </Button>
                  </>
                )}
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!!busy} isPending={busy === 'save'} onPress={() => void submit()}>
                {C.dialog.save}
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
 * 删除频道（BOT-CH-07、需求 §2.3，原型 page-bot-dialogs.jsx `DeleteDialog`）：先问 Runtime 此刻会停掉几个线程、删掉几个周期任务（用一个必然不符的确认数去问，`conflict` 带回实时计数），
 * 写进确认框；确认时带上这两个数，期间数变了 Runtime 再拒一次，框里换成新数让用户重新确认。
 * 删除无法撤销，没归档的频道旁边给「改为归档」。
 */
export function DeleteChannelDialog({ summary, onClose, onDeleted }: { summary: ChannelSummary; onClose: () => void; onDeleted: () => void }) {
  const { channel } = summary;
  const [counts, setCounts] = useState<DeleteCounts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<'delete' | 'archive' | null>(null);
  const client = useRuntime().client;
  const call = useBotCall();
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
    setBusy('delete');
    try {
      await client.request('channels.delete', { id: channel.id, confirm: counts });
      ToastQueue.positive(C.dialog.deleted(channel.name), { timeout: 5000 });
      onDeleted();
    } catch (error) {
      const next = countsOf(error);
      if (next) setCounts(next);
      else setFailure(errorText(error));
    } finally {
      setBusy(null);
    }
  };
  const archiveInstead = async () => {
    setBusy('archive');
    const result = await call('channels.archive', { id: channel.id });
    setBusy(null);
    if (!result) return;
    ToastQueue.positive(C.dialog.archived(channel.name), { timeout: 5000 });
    onClose();
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
                <>
                  <p className={body}>{C.dialog.deleteBody(counts.threads, counts.schedules)}</p>
                  <p className={deleteNote}>{C.dialog.deleteNote}</p>
                </>
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
              {channel.archived ? null : (
                <Button variant="secondary" isDisabled={!!busy} isPending={busy === 'archive'} onPress={() => void archiveInstead()}>
                  {C.dialog.archiveInstead}
                </Button>
              )}
              <Button variant="negative" isDisabled={!counts || !!failure || !!busy} isPending={busy === 'delete'} onPress={() => void confirm()}>
                {C.dialog.deleteConfirm}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
