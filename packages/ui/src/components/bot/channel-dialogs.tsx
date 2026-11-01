import { useState } from 'react';
import {
  BOT_LIMITS,
  CHANNEL_COLORS,
  CHANNEL_ICONS,
  MAIN_CHANNEL_ID,
  type Channel,
  type ChannelColor,
  type ChannelIcon,
  type ChannelSummary,
} from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Form,
  Heading,
  TextArea,
  TextField,
  ToastQueue,
  ToggleButton,
  ToggleButtonGroup,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { channelLook, nameProblem } from '../../model/bot.ts';
import { useBotLayout, type BotDialog } from '../../state/bot-layout-store.ts';
import { useChannelGroup, useChannelSummary } from '../../state/channels-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ScheduleDialog } from '../agent-schedule/schedule-dialog.tsx';
import { useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { ChannelSettingsDialog, DeleteChannelDialog } from './channel-dialog.tsx';
import { CHANNEL_ICON_COMPONENTS, HUE, hueInk } from './channel-glyph.tsx';
import { channelRoute } from './channel-sidebar.tsx';

const note = style({ margin: 0, marginBottom: 12, font: 'ui', color: 'gray-700' });
const body = style({ margin: 0, font: 'body-sm', color: 'gray-800' });
const instructions = style({ width: 'full' });
const pick = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 });
const preview = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 64,
  borderRadius: 'xl',
  backgroundColor: '--bc-hue-tint',
});
const pickHead = style({ margin: 0, marginTop: 8, font: 'ui', fontWeight: 'bold', color: 'gray-800' });
/** 图标三行八列、颜色两行五列；选中的保留色相：浅底加一圈描边，不用 S2 选中时的深底。 */
const grid = style({ display: 'grid', gridTemplateColumns: 'repeat(8, auto)', gap: 8, justifyContent: 'center' });
const colorGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(5, auto)', gap: 12, justifyContent: 'center' });
/** 选中的那一格：浅底加一圈描边（app.css `.bc-hue-pick` 读这两个变量）。 */
const pickSelected = style({
  '--bc-hue-pick-fill': { type: 'backgroundColor', value: 'gray-100' },
  '--bc-hue-pick-ring': { type: 'borderColor', value: 'gray-800' },
});
const swatch = style({ display: 'block', size: 24, borderRadius: 'full', backgroundColor: '--bc-hue-ink' });

const close = () => useBotLayout.getState().setDialog(null);

/**
 * Bot 的对话框宿主（原型 page-bot-dialogs.jsx `BotDialogs`）：频道菜单、侧栏的「＋」与分组行开的对话框都画在这里，挂在 App 外壳上，
 * 侧栏浮出时开的也不会跟着侧栏收起而卸下。作用于频道的对话框在频道不在了时不画（store 里的记录由下一次打开覆盖）。
 */
export function BotDialogs() {
  const dialog = useBotLayout((s) => s.dialog);
  return dialog ? <BotDialogBody key={dialogKey(dialog)} dialog={dialog} /> : null;
}

function dialogKey(dialog: BotDialog): string {
  return `${dialog.kind}:${'channelId' in dialog ? dialog.channelId : 'groupId' in dialog ? (dialog.groupId ?? '') : ''}`;
}

function BotDialogBody({ dialog }: { dialog: BotDialog }) {
  const channelId = 'channelId' in dialog ? dialog.channelId : null;
  const summary = useChannelSummary(channelId);
  const groupId = dialog.kind === 'newChannel' || dialog.kind === 'renameGroup' ? (dialog.groupId ?? null) : null;
  const group = useChannelGroup(groupId);
  if (channelId && !summary) return null;
  switch (dialog.kind) {
    case 'settings':
      return <ChannelSettingsDialog channelId={dialog.channelId} onClose={close} />;
    case 'schedule':
      return (
        <DialogContainer onDismiss={close}>
          <ScheduleDialog channelId={dialog.channelId} onClose={close} />
        </DialogContainer>
      );
    case 'rename':
      return <RenameChannelDialog channel={summary!.channel} />;
    case 'instructions':
      return <InstructionsDialog channel={summary!.channel} />;
    case 'icon':
      return <IconDialog channel={summary!.channel} />;
    case 'archive':
      return <ArchiveDialog summary={summary!} />;
    case 'delete':
      return <DeleteChannelDialog summary={summary!} onClose={close} onDeleted={() => afterDelete(summary!.channel.id)} />;
    case 'newChannel':
      return <NewChannelDialog groupId={group?.id ?? null} groupName={group?.name ?? null} />;
    case 'newGroup':
      return <NewGroupDialog moveChannelId={dialog.moveChannelId ?? null} />;
    case 'renameGroup':
      return group ? <RenameGroupDialog id={group.id} name={group.name} /> : null;
  }
}

/** 删掉的是正在看的频道时回到默认频道。 */
function afterDelete(channelId: string) {
  close();
  const { route, go } = useShell.getState();
  if (route.tab === 'bot' && route.channelId === channelId) go(channelRoute(MAIN_CHANNEL_ID));
}

/**
 * 只问一个名字的对话框：重命名频道、新建频道、新建分组、重命名分组。名字必填、最多 40 字（BOT-CH-02）。
 * `onSubmit` 返回 false（RPC 失败，错误已经弹过提示）时对话框留着。
 */
function NameDialog({
  title,
  label,
  initial,
  lead,
  required,
  max,
  submitLabel,
  onSubmit,
}: {
  title: string;
  label: string;
  initial?: string;
  lead?: string;
  required: string;
  max: number;
  submitLabel: string;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const problem = nameProblem(name, max);
  const error = problem === 'required' ? required : problem === 'tooLong' ? C.dialog.tooLong(max) : null;
  const save = async () => {
    if (error || busy) return;
    setBusy(true);
    const ok = await onSubmit(name.trim());
    setBusy(false);
    if (ok) close();
  };
  return (
    <DialogContainer onDismiss={close}>
      <Dialog size="S">
        {({ close: dismiss }) => (
          <>
            <Heading slot="title">{title}</Heading>
            <Content>
              {lead ? <p className={note}>{lead}</p> : null}
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <TextField
                  label={label}
                  value={name}
                  autoFocus
                  maxLength={max}
                  onChange={setName}
                  isInvalid={!!name.trim() && !!error}
                  errorMessage={error ?? undefined}
                />
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={dismiss}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!!error} isPending={busy} onPress={() => void save()}>
                {submitLabel}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

function RenameChannelDialog({ channel }: { channel: Channel }) {
  const call = useBotCall();
  return (
    <NameDialog
      title={C.dialog.renameTitle}
      label={C.dialog.channelName}
      initial={channel.name}
      required={C.dialog.nameRequired}
      max={BOT_LIMITS.channelName}
      submitLabel={C.dialog.save}
      onSubmit={async (name) => name === channel.name || !!(await call('channels.update', { id: channel.id, patch: { name } }))}
    />
  );
}

/** 新建频道只问名字（需求 §11.2 修订）：Agent、访问模式与预算建好后在频道设置里改；从分组行开的建在那个分组里。建好打开它。 */
function NewChannelDialog({ groupId, groupName }: { groupId: string | null; groupName: string | null }) {
  const call = useBotCall();
  return (
    <NameDialog
      title={C.dialog.createTitle}
      label={C.dialog.channelName}
      lead={groupName ? C.dialog.createInGroup(groupName) : C.dialog.createNote}
      required={C.dialog.nameRequired}
      max={BOT_LIMITS.channelName}
      submitLabel={C.dialog.create}
      onSubmit={async (name) => {
        const result = await call('channels.create', { name, ...(groupId ? { groupId } : {}) });
        if (result) useShell.getState().go(channelRoute(result.channel.id));
        return !!result;
      }}
    />
  );
}

/** 新建分组；从频道菜单「移到分组 › 新建分组…」开的，建好把那个频道一起移进去。 */
function NewGroupDialog({ moveChannelId }: { moveChannelId: string | null }) {
  const call = useBotCall();
  return (
    <NameDialog
      title={C.dialog.newGroupTitle}
      label={C.dialog.groupName}
      lead={moveChannelId ? C.dialog.newGroupMove : C.dialog.newGroupNote}
      required={C.dialog.groupRequired}
      max={BOT_LIMITS.groupName}
      submitLabel={C.dialog.createGroup}
      onSubmit={async (name) => !!(await call('channelGroups.create', { name, ...(moveChannelId ? { channelIds: [moveChannelId] } : {}) }))}
    />
  );
}

function RenameGroupDialog({ id, name: current }: { id: string; name: string }) {
  const call = useBotCall();
  return (
    <NameDialog
      title={C.dialog.renameGroupTitle}
      label={C.dialog.groupName}
      initial={current}
      required={C.dialog.groupRequired}
      max={BOT_LIMITS.groupName}
      submitLabel={C.dialog.save}
      onSubmit={async (name) => name === current || !!(await call('channelGroups.update', { id, patch: { name } }))}
    />
  );
}

/**
 * 频道说明（需求 §11.3 修订）：编辑的就是频道的用途（BOT-CH-02，最多 2000 字），协调者与线程都读它；频道头的灰字是它的第一行。
 * 留空表示这个频道什么都能做。
 */
function InstructionsDialog({ channel }: { channel: Channel }) {
  const call = useBotCall();
  const [text, setText] = useState(channel.purpose);
  const [busy, setBusy] = useState(false);
  const tooLong = text.length > BOT_LIMITS.channelPurpose;
  const save = async () => {
    const purpose = text.trim();
    if (purpose === channel.purpose) return close();
    setBusy(true);
    const result = await call('channels.update', { id: channel.id, patch: { purpose } });
    setBusy(false);
    if (result) close();
  };
  return (
    <DialogContainer onDismiss={close}>
      <Dialog size="M">
        {({ close: dismiss }) => (
          <>
            <Heading slot="title">{C.dialog.instructionsTitle}</Heading>
            <Content>
              <p className={note}>{channel.name}</p>
              <TextArea
                aria-label={C.dialog.instructionsLabel}
                styles={instructions}
                UNSAFE_style={{ minHeight: 160 }}
                placeholder={C.dialog.instructionsPlaceholder}
                description={C.dialog.instructionsHint}
                value={text}
                onChange={setText}
                autoFocus
                isInvalid={tooLong}
                errorMessage={tooLong ? C.dialog.tooLong(BOT_LIMITS.channelPurpose) : undefined}
              />
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={dismiss}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={tooLong} isPending={busy} onPress={() => void save()}>
                {C.dialog.save}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

const firstKey = (keys: Iterable<unknown> | 'all') => (keys === 'all' ? undefined : [...keys][0]);

/** 更换频道图标（需求 §11.2 修订）：上面是大号预览，下面选图标（24 个 S2 workflow 图标）与颜色（10 个 S2 色相）。 */
function IconDialog({ channel }: { channel: Channel }) {
  const call = useBotCall();
  const look = channelLook(channel);
  const [icon, setIcon] = useState<ChannelIcon>(look.icon === 'Layers' ? 'Chat' : look.icon);
  const [color, setColor] = useState<ChannelColor>(look.color ?? CHANNEL_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const Preview = CHANNEL_ICON_COMPONENTS[icon];
  const save = async () => {
    if (icon === channel.icon && color === channel.color) return close();
    setBusy(true);
    const result = await call('channels.update', { id: channel.id, patch: { icon, color } });
    setBusy(false);
    if (result) close();
  };
  return (
    <DialogContainer onDismiss={close}>
      <Dialog size="M">
        {({ close: dismiss }) => (
          <>
            <Heading slot="title">{C.dialog.iconTitle}</Heading>
            <Content>
              <div className={pick}>
                <span className={`${preview} ${HUE[color]}`} aria-hidden="true" data-bc-icons="own">
                  <Preview UNSAFE_className={`${hueInk}`} UNSAFE_style={{ width: 32, height: 32 }} />
                </span>
                <h3 className={pickHead}>{C.dialog.iconHead}</h3>
                <ToggleButtonGroup
                  aria-label={C.dialog.iconHead}
                  isQuiet
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[icon]}
                  onSelectionChange={(keys) => {
                    const key = firstKey(keys);
                    const next = CHANNEL_ICONS.find((name) => name === key);
                    if (next) setIcon(next);
                  }}
                  UNSAFE_className={`${grid} ${pickSelected} bc-hue-pick`}
                >
                  {CHANNEL_ICONS.map((name) => {
                    const Icon = CHANNEL_ICON_COMPONENTS[name];
                    return (
                      <ToggleButton key={name} id={name} aria-label={C.dialog.iconNames[name]}>
                        <Icon UNSAFE_className={`${HUE[color]} ${hueInk}`} />
                      </ToggleButton>
                    );
                  })}
                </ToggleButtonGroup>
                <h3 className={pickHead}>{C.dialog.colorHead}</h3>
                <ToggleButtonGroup
                  aria-label={C.dialog.colorHead}
                  isQuiet
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[color]}
                  onSelectionChange={(keys) => {
                    const key = firstKey(keys);
                    const next = CHANNEL_COLORS.find((name) => name === key);
                    if (next) setColor(next);
                  }}
                  UNSAFE_className={`${colorGrid} ${pickSelected} bc-hue-pick`}
                >
                  {CHANNEL_COLORS.map((name) => (
                    <ToggleButton key={name} id={name} aria-label={C.dialog.colorNames[name]}>
                      <span className={`${swatch} ${HUE[name]}`} />
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={dismiss}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isPending={busy} onPress={() => void save()}>
                {C.dialog.save}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** 归档确认（需求 §2.3）：频道收进「已归档」，没解决的任务留着，定时任务暂停；进行中的线程照常跑完。恢复后定时任务不自动继续。 */
function ArchiveDialog({ summary }: { summary: ChannelSummary }) {
  const { channel, counts } = summary;
  const call = useBotCall();
  const [busy, setBusy] = useState(false);
  const archive = async () => {
    setBusy(true);
    const result = await call('channels.archive', { id: channel.id });
    setBusy(false);
    if (!result) return;
    ToastQueue.positive(C.dialog.archived(channel.name), { timeout: 5000 });
    close();
  };
  return (
    <DialogContainer onDismiss={close}>
      <Dialog size="S" role="alertdialog">
        {({ close: dismiss }) => (
          <>
            <Heading slot="title">{C.dialog.archiveTitle(channel.name)}</Heading>
            <Content>
              <p className={body}>{C.dialog.archiveBody(counts.open, counts.scheduled)}</p>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={dismiss}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isPending={busy} onPress={() => void archive()}>
                {C.dialog.archive}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
