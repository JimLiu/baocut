import { useMemo, useState } from 'react';
import { MAIN_CHANNEL_ID, type ChannelSummary } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  MenuItem,
  NotificationBadge,
  SideNav,
  SideNavHeader,
  SideNavItem,
  SideNavItemContent,
  SideNavItemLink,
  SideNavSection,
  Text,
} from '@react-spectrum/s2';
import AddCircle from '@react-spectrum/s2/icons/AddCircle';
import Archive from '@react-spectrum/s2/icons/Archive';
import Bell from '@react-spectrum/s2/icons/Bell';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Delete from '@react-spectrum/s2/icons/Delete';
import Home from '@react-spectrum/s2/icons/Home';
import Lock from '@react-spectrum/s2/icons/Lock';
import PinOff from '@react-spectrum/s2/icons/PinOff';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import Settings from '@react-spectrum/s2/icons/Settings';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { channelGroups, needsYouTotal } from '../../model/bot.ts';
import { useChannels } from '../../state/channels-store.ts';
import { hrefFor, type Route } from '../../state/shell-store.ts';
import { PageSidebar, SidebarTitle, sidebarBody, useSidebarGo, useSidebarRoute } from '../page-sidebar.tsx';
import { useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { ChannelDialog, DeleteChannelDialog, type ChannelDialogState } from './channel-dialog.tsx';

const top = style({ flexShrink: 0, marginBottom: 8 });
const nav = style({ height: 'auto' });
const fit = style({ minWidth: 0 });
const line = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: 'full' });
const lineTitle = style({
  flexGrow: 1,
  flexBasis: 0,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: { default: 'normal', isUnread: 'bold' },
});
const tail = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const unreadDot = style({ size: 8, borderRadius: 'full', backgroundColor: 'green-900' });
const tailIcon = iconStyle({ size: 'XS' });
const sectionHead = style({ display: 'flex', alignItems: 'center', gap: 4 });

/** 频道对应的路由：主频道写成 `chan_main`，侧栏的选中态与「/bot」打开的主频道对得上。 */
export function channelRoute(channelId: string): Route {
  return { tab: 'bot', channelId, workItemId: null, view: 'channel' };
}

/** 侧栏的选中项：收件箱、频道（记忆页与任务详情都算在频道上）。 */
function selectedHref(route: Route): string | undefined {
  if (route.tab !== 'bot') return undefined;
  if (route.view === 'inbox') return hrefFor({ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' });
  return hrefFor(channelRoute(route.channelId ?? MAIN_CHANNEL_ID));
}

/**
 * 频道侧栏（BOT-CH-02、需求 §11.2）：顶上「新建频道」与「等你处理」，然后是主频道、置顶的、其余按最近活动；归档的收在最下面一组。
 * 每行：频道名（有未读时加粗、行尾一颗绿点），等你的任务数，静音与私密的小图标；行尾「⋯」是设置、记忆、置顶、静音、归档与删除。
 */
export function ChannelSidebar() {
  const route = useSidebarRoute();
  const go = useSidebarGo();
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  const call = useBotCall();
  const groups = useMemo(() => channelGroups(channels), [channels]);
  const total = needsYouTotal(channels);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const [deleting, setDeleting] = useState<ChannelSummary | null>(null);

  const onAction = (summary: ChannelSummary, action: string) => {
    const { channel } = summary;
    if (action === 'settings') setDialog({ mode: 'settings', channelId: channel.id });
    else if (action === 'memory') go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'memory' });
    else if (action === 'pin') void call('channels.update', { id: channel.id, patch: { pinned: !channel.pinned } });
    else if (action === 'mute') void call('channels.update', { id: channel.id, patch: { muted: !channel.muted } });
    else if (action === 'archive') void call(channel.archived ? 'channels.unarchive' : 'channels.archive', { id: channel.id });
    else if (action === 'delete') setDeleting(summary);
  };

  const row = (summary: ChannelSummary) => {
    const { channel, unread, counts } = summary;
    const main = channel.kind === 'main';
    const detail = [
      channel.name,
      unread ? C.sidebar.unread : null,
      counts.needsYou ? C.sidebar.needsYou(counts.needsYou) : null,
      channel.muted ? C.sidebar.muted : null,
      channel.private ? C.sidebar.private : null,
    ]
      .filter(Boolean)
      .join(', ');
    return (
      <SideNavItem key={channel.id} id={channel.id} textValue={channel.name} href={hrefFor(channelRoute(channel.id))} data-bc-row="">
        <SideNavItemContent>
          <SideNavItemLink aria-label={detail}>
            {main ? <Home /> : channel.pinned ? <PinOn /> : null}
            <Text styles={fit}>
              <span className={line} title={channel.purpose || channel.name}>
                <span className={lineTitle({ isUnread: unread })}>{channel.name}</span>
                <span className={tail} aria-hidden="true">
                  {channel.private ? <Lock styles={tailIcon} /> : null}
                  {channel.muted ? <VolumeOff styles={tailIcon} /> : null}
                  {counts.needsYou ? <NotificationBadge size="S" value={counts.needsYou} /> : unread ? <span className={unreadDot} /> : null}
                </span>
              </span>
            </Text>
          </SideNavItemLink>
          <ActionMenu aria-label={C.common.more} isQuiet size="S" onAction={(key) => onAction(summary, String(key))}>
            <MenuItem id="settings" textValue={C.sidebar.settings}>
              <Settings />
              <Text>{C.sidebar.settings}</Text>
            </MenuItem>
            <MenuItem id="memory" textValue={C.sidebar.memory}>
              <Bookmark />
              <Text>{C.sidebar.memory}</Text>
            </MenuItem>
            {main || channel.archived ? null : (
              <MenuItem key={channel.pinned ? 'unpin' : 'pin'} id="pin" textValue={channel.pinned ? C.sidebar.unpin : C.sidebar.pin}>
                {channel.pinned ? <PinOff /> : <PinOn />}
                <Text>{channel.pinned ? C.sidebar.unpin : C.sidebar.pin}</Text>
              </MenuItem>
            )}
            <MenuItem key={channel.muted ? 'unmute' : 'mute'} id="mute" textValue={channel.muted ? C.sidebar.unmute : C.sidebar.mute}>
              {channel.muted ? <VolumeTwo /> : <VolumeOff />}
              <Text>{channel.muted ? C.sidebar.unmute : C.sidebar.mute}</Text>
            </MenuItem>
            {main ? null : (
              <MenuItem key={channel.archived ? 'unarchive' : 'archive'} id="archive" textValue={channel.archived ? C.sidebar.unarchive : C.sidebar.archive}>
                <Archive />
                <Text>{channel.archived ? C.sidebar.unarchive : C.sidebar.archive}</Text>
              </MenuItem>
            )}
            {main ? null : (
              <MenuItem id="delete" textValue={C.sidebar.delete}>
                <Delete />
                <Text>{C.sidebar.delete}</Text>
              </MenuItem>
            )}
          </ActionMenu>
        </SideNavItemContent>
      </SideNavItem>
    );
  };

  const inboxRoute: Route = { tab: 'bot', channelId: null, workItemId: null, view: 'inbox' };
  return (
    <PageSidebar label={C.sidebar.nav}>
      <SidebarTitle>{C.sidebar.title}</SidebarTitle>
      <div className={top}>
        <ActionButton isQuiet styles={style({ width: 'full' })} UNSAFE_style={{ justifyContent: 'start' }} onPress={() => setDialog({ mode: 'create' })}>
          <AddCircle />
          <Text>{C.sidebar.newChannel}</Text>
        </ActionButton>
      </div>
      <div className={`${sidebarBody} bc-scroll`}>
        <SideNav styles={nav} aria-label={C.sidebar.nav} selectedRoute={selectedHref(route)}>
          <SideNavSection id="inbox">
            <SideNavItem id="inbox" textValue={C.sidebar.inbox} href={hrefFor(inboxRoute)} data-bc-row="">
              <SideNavItemContent>
                <SideNavItemLink aria-label={total ? `${C.sidebar.inbox}, ${C.sidebar.needsYou(total)}` : C.sidebar.inbox}>
                  <Bell />
                  <Text styles={fit}>
                    <span className={line}>
                      <span className={lineTitle({ isUnread: false })}>{C.sidebar.inbox}</span>
                      {total ? (
                        <span className={tail} aria-hidden="true">
                          <NotificationBadge size="S" value={total} />
                        </span>
                      ) : null}
                    </span>
                  </Text>
                </SideNavItemLink>
              </SideNavItemContent>
            </SideNavItem>
          </SideNavSection>
          <SideNavSection id="channels">
            <SideNavHeader>{C.sidebar.title}</SideNavHeader>
            {ready ? groups.active.map(row) : []}
          </SideNavSection>
          {groups.archived.length ? (
            <SideNavSection id="archived">
              <SideNavHeader>
                <span className={sectionHead}>
                  <ActionButton isQuiet size="S" aria-expanded={showArchived} aria-label={C.sidebar.archived} onPress={() => setShowArchived(!showArchived)}>
                    {showArchived ? <ChevronDown /> : <ChevronRight />}
                  </ActionButton>
                  {`${C.sidebar.archived} (${groups.archived.length})`}
                </span>
              </SideNavHeader>
              {showArchived ? groups.archived.map(row) : []}
            </SideNavSection>
          ) : null}
        </SideNav>
      </div>
      {dialog ? (
        <ChannelDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null);
            go(channelRoute(id));
          }}
          onDelete={(summary) => {
            setDialog(null);
            setDeleting(summary);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteChannelDialog
          summary={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const wasOpen = route.tab === 'bot' && route.channelId === deleting.channel.id;
            setDeleting(null);
            if (wasOpen) go(channelRoute(MAIN_CHANNEL_ID));
          }}
        />
      ) : null}
    </PageSidebar>
  );
}
