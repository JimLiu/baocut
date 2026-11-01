import type { ComponentType, Key } from 'react';
import type { Channel, ChannelGroup } from '@baocut/protocol';
import {
  ActionButton,
  ActionButtonGroup,
  ActionMenu,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SubmenuTrigger,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Archive from '@react-spectrum/s2/icons/Archive';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import CalendarAdd from '@react-spectrum/s2/icons/CalendarAdd';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Color from '@react-spectrum/s2/icons/Color';
import Delete from '@react-spectrum/s2/icons/Delete';
import Filter from '@react-spectrum/s2/icons/Filter';
import FolderAdd from '@react-spectrum/s2/icons/FolderAdd';
import FolderMoveTo from '@react-spectrum/s2/icons/FolderMoveTo';
import PinOff from '@react-spectrum/s2/icons/PinOff';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import Rename from '@react-spectrum/s2/icons/Rename';
import Settings from '@react-spectrum/s2/icons/Settings';
import StickyNote from '@react-spectrum/s2/icons/StickyNote';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { CHANNEL_STATUS_FILTERS, type ChannelStatusFilter } from '../../model/bot.ts';
import { useBotLayout, type BotDialog } from '../../state/bot-layout-store.ts';
import { useChannelGroups } from '../../state/channels-store.ts';
import type { Route } from '../../state/shell-store.ts';
import { useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { ChannelGlyph } from './channel-glyph.tsx';

/** 频道名按钮：名字太长时只截名字，⌄ 跟在文字槽里（按钮只有一个图标槽，频道图标占着）。 */
const titled = style({ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: 'full' });
const titledName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 'bold',
  color: 'gray-900',
});
/** 筛选不是「进行中」时按钮带底色（app.css `.bc-panel-toggle[data-on]` 读这个变量；S2 的安静按钮没有选中态）。 */
const toggleOnFill = style({ '--bc-panel-toggle-on': { type: 'backgroundColor', value: 'gray-100' } });

const DIALOG_KEYS = ['settings', 'schedule', 'rename', 'instructions', 'icon', 'archive', 'delete'] as const;
type ChannelDialogKey = (typeof DIALOG_KEYS)[number];
const isDialogKey = (key: string): key is ChannelDialogKey => (DIALOG_KEYS as readonly string[]).includes(key);

const openDialog = (dialog: BotDialog) => useBotLayout.getState().setDialog(dialog);

function item(id: string, Icon: ComponentType, label: string) {
  return (
    <MenuItem key={id} id={id} textValue={label}>
      <Icon />
      <Text>{label}</Text>
    </MenuItem>
  );
}

/**
 * 频道菜单（需求 §11.2、§11.3 修订，原型 page-bot-dialogs.jsx `channelMenuItems`）：频道设置、重命名、说明、更换图标、移到分组；
 * 记忆、新建周期任务、置顶、静音；归档、删除。主频道不换图标、不进分组、不置顶、不归档、不删除；归档的频道不新建周期任务。
 * 「移到分组」是子菜单：各分组（当前的打勾）、不分组、新建分组。
 */
function channelMenuSections(channel: Channel, groups: readonly ChannelGroup[], onMove: (key: Key) => void) {
  const main = channel.kind === 'main';
  const inGroup = channel.groupId && groups.some((g) => g.id === channel.groupId) ? channel.groupId : 'none';
  return [
    <MenuSection key="setup">
      {item('settings', Settings, C.sidebar.settings)}
      {item('rename', Rename, C.menu.rename)}
      {item('instructions', StickyNote, C.menu.instructions)}
      {main ? null : item('icon', Color, C.menu.icon)}
      {main ? null : (
        <SubmenuTrigger>
          {item('move', FolderMoveTo, C.menu.move)}
          <Menu
            aria-label={C.menu.move}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[inGroup]}
            onSelectionChange={(keys) => {
              const key = keys === 'all' ? undefined : [...keys][0];
              if (key !== undefined) onMove(key);
            }}
          >
            {groups.length ? (
              <MenuSection key="groups">
                {groups.map((g) => (
                  <MenuItem key={g.id} id={g.id} textValue={g.name}>
                    <Text>{g.name}</Text>
                  </MenuItem>
                ))}
              </MenuSection>
            ) : null}
            <MenuSection key="other">
              <MenuItem id="none" textValue={C.menu.noGroup}>
                <Text>{C.menu.noGroup}</Text>
              </MenuItem>
              <MenuItem id="new" textValue={C.menu.newGroup}>
                <Text>{C.menu.newGroup}</Text>
              </MenuItem>
            </MenuSection>
          </Menu>
        </SubmenuTrigger>
      )}
    </MenuSection>,
    <MenuSection key="keep">
      {item('memory', Bookmark, C.sidebar.memory)}
      {channel.archived ? null : item('schedule', CalendarAdd, C.menu.schedule)}
      {main || channel.archived ? null : item('pin', channel.pinned ? PinOff : PinOn, channel.pinned ? C.sidebar.unpin : C.sidebar.pin)}
      {item('mute', channel.muted ? VolumeTwo : VolumeOff, channel.muted ? C.sidebar.unmute : C.sidebar.mute)}
    </MenuSection>,
    main ? null : (
      <MenuSection key="end">
        {item('archive', Archive, channel.archived ? C.sidebar.unarchive : C.sidebar.archive)}
        {item('delete', Delete, C.sidebar.delete)}
      </MenuSection>
    ),
  ].filter((section) => section !== null);
}

/** 频道菜单的动作：记忆在中间整页打开；置顶、静音直接改；恢复直接做，归档要确认；其余开对话框。 */
function useChannelMenu(channel: Channel, go: (route: Route) => void) {
  const call = useBotCall();
  const groups = useChannelGroups();
  const run = (key: string) => {
    if (key === 'memory') go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'memory' });
    else if (key === 'pin') void call('channels.update', { id: channel.id, patch: { pinned: !channel.pinned } });
    else if (key === 'mute') void call('channels.update', { id: channel.id, patch: { muted: !channel.muted } });
    else if (key === 'archive' && channel.archived)
      void call('channels.unarchive', { id: channel.id }).then(
        (result) => result && ToastQueue.positive(C.dialog.restored(channel.name), { timeout: 5000 }),
      );
    else if (isDialogKey(key)) openDialog({ kind: key, channelId: channel.id });
  };
  const move = (key: Key) => {
    if (key === 'new') openDialog({ kind: 'newGroup', moveChannelId: channel.id });
    else void call('channels.update', { id: channel.id, patch: { groupId: key === 'none' ? null : String(key) } });
  };
  return { sections: channelMenuSections(channel, groups, move), run };
}

/** 侧栏行尾的「⋯」：频道菜单。 */
export function ChannelActionMenu({ channel, go }: { channel: Channel; go: (route: Route) => void }) {
  const menu = useChannelMenu(channel, go);
  return (
    <ActionMenu aria-label={C.sidebar.rowActions(channel.name)} isQuiet size="S" onAction={(key) => menu.run(String(key))}>
      {menu.sections}
    </ActionMenu>
  );
}

/** 频道头的「图标 名字 ⌄」：按下打开频道菜单（需求 §11.3 修订）。 */
export function ChannelTitleMenu({ channel, go }: { channel: Channel; go: (route: Route) => void }) {
  const menu = useChannelMenu(channel, go);
  return (
    <MenuTrigger>
      <ActionButton isQuiet size="S" styles={style({ minWidth: 0, maxWidth: 'full' })}>
        <ChannelGlyph channel={channel} />
        <Text>
          <span className={titled} title={channel.name}>
            <span className={titledName}>{channel.name}</span>
            <ChevronDown />
          </span>
        </Text>
      </ActionButton>
      <Menu aria-label={C.menu.label} onAction={(key) => menu.run(String(key))}>
        {menu.sections}
      </Menu>
    </MenuTrigger>
  );
}

/**
 * 主频道行尾（需求 §11.2 修订，原型 `BotSidebarTools`）：筛选（状态 ▸ 进行中 / 已归档 / 全部；不是进行中时按钮带底色）与「＋」（新建频道 / 新建分组）。
 * 原来收在底部的「已归档」折叠组由这个筛选代替。
 */
export function ChannelListTools({ status, onStatus }: { status: ChannelStatusFilter; onStatus: (status: ChannelStatusFilter) => void }) {
  const label = C.sidebar.statuses[status];
  return (
    // 侧栏行的网格给 ActionButtonGroup 留了「actions」一格（S2 SideNav）；别的容器会被排进图标那一格。
    <ActionButtonGroup isQuiet size="S" aria-label={C.sidebar.tools}>
      <MenuTrigger>
        <ActionButton
          isQuiet
          size="S"
          aria-label={C.sidebar.filter(label)}
          data-on={status !== 'active' ? '' : undefined}
          UNSAFE_className={`bc-panel-toggle ${toggleOnFill}`}
        >
          <Filter />
        </ActionButton>
        <Menu aria-label={C.sidebar.filterMenu}>
          <SubmenuTrigger>
            <MenuItem id="status" textValue={C.sidebar.status}>
              <Text slot="label">{C.sidebar.status}</Text>
              <Text slot="description">{label}</Text>
            </MenuItem>
            <Menu
              aria-label={C.sidebar.status}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[status]}
              onSelectionChange={(keys) => {
                const key = keys === 'all' ? undefined : [...keys][0];
                const next = CHANNEL_STATUS_FILTERS.find((k) => k === key);
                if (next) onStatus(next);
              }}
            >
              {CHANNEL_STATUS_FILTERS.map((k) => (
                <MenuItem key={k} id={k} textValue={C.sidebar.statuses[k]}>
                  <Text>{C.sidebar.statuses[k]}</Text>
                </MenuItem>
              ))}
            </Menu>
          </SubmenuTrigger>
        </Menu>
      </MenuTrigger>
      <MenuTrigger>
        <ActionButton isQuiet size="S" aria-label={C.sidebar.add}>
          <Add />
        </ActionButton>
        <Menu aria-label={C.sidebar.add} onAction={(key) => openDialog({ kind: key === 'newGroup' ? 'newGroup' : 'newChannel' })}>
          {item('newChannel', Add, C.sidebar.newChannelItem)}
          {item('newGroup', FolderAdd, C.sidebar.newGroupItem)}
        </Menu>
      </MenuTrigger>
    </ActionButtonGroup>
  );
}

/** 分组行行尾：「⋯」（新建频道、重命名分组、删除分组）与「＋」（在这个分组里新建频道）。删分组不删频道，不用确认。 */
export function GroupTools({ group, className }: { group: ChannelGroup; className?: string }) {
  const call = useBotCall();
  const onAction = (key: string) => {
    if (key === 'delete')
      void call('channelGroups.delete', { id: group.id }).then(
        (result) => result && ToastQueue.positive(C.dialog.groupDeleted(group.name), { timeout: 5000 }),
      );
    else if (key === 'rename') openDialog({ kind: 'renameGroup', groupId: group.id });
    else openDialog({ kind: 'newChannel', groupId: group.id });
  };
  return (
    <span className={className}>
      <ActionMenu aria-label={C.sidebar.groupActions(group.name)} isQuiet size="S" onAction={(key) => onAction(String(key))}>
        {item('newChannel', Add, C.sidebar.newChannelItem)}
        {item('rename', Rename, C.sidebar.renameGroup)}
        {item('delete', Delete, C.sidebar.deleteGroup)}
      </ActionMenu>
      <ActionButton
        isQuiet
        size="S"
        aria-label={C.sidebar.groupAdd(group.name)}
        onPress={() => openDialog({ kind: 'newChannel', groupId: group.id })}
      >
        <Add />
      </ActionButton>
    </span>
  );
}
