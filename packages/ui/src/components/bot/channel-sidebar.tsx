import { useMemo, useState } from 'react';
import { MAIN_CHANNEL_ID, type ChannelGroup, type ChannelSummary } from '@baocut/protocol';
import {
  ActionButton,
  NotificationBadge,
  SideNav,
  SideNavHeader,
  SideNavItem,
  SideNavItemContent,
  SideNavItemLink,
  SideNavSection,
  Text,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Archive from '@react-spectrum/s2/icons/Archive';
import Bell from '@react-spectrum/s2/icons/Bell';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Folder from '@react-spectrum/s2/icons/Folder';
import Lock from '@react-spectrum/s2/icons/Lock';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { channelTree, needsYouTotal, type ChannelStatusFilter } from '../../model/bot.ts';
import { useBotLayout } from '../../state/bot-layout-store.ts';
import { useChannelGroups, useChannels } from '../../state/channels-store.ts';
import { hrefFor, type Route } from '../../state/shell-store.ts';
import { PageSidebar, SidebarTitle, sidebarBody, useSidebarGo, useSidebarRoute } from '../page-sidebar.tsx';
import { BOT_COPY as C } from './bot-copy.ts';
import { ChannelGlyph } from './channel-glyph.tsx';
import { ChannelActionMenu, ChannelListTools, GroupTools } from './channel-menu.tsx';

const nav = style({ height: 'auto' });
/** 挂在主频道与分组下的拐角线颜色（app.css `[data-bc-child]`）。 */
const tree = style({ '--bc-row-connector': { type: 'borderColor', value: 'gray-200' } });
/** 「新建频道」跟在树后面：和下挂的频道一样缩进。 */
const newChannel = style({ marginStart: 20 });
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
  color: { default: 'inherit', isArchived: 'gray-600' },
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
/** 分组行：和上一段隔开；文件夹图标与主频道的图标对齐，组里频道的拐角线从它下面弯出来。 */
const groupHead = style({ display: 'flex', alignItems: 'center', gap: 4, width: 'full', minWidth: 0, marginTop: 12 });
const groupToggle = style({ minWidth: 0 });
const groupName = style({ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, font: 'ui', fontWeight: 'normal' });
const groupNameText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const groupTools = style({ display: 'flex', alignItems: 'center', flexShrink: 0, marginStart: 'auto' });
const empty = style({ font: 'body-sm', color: 'gray-600', marginX: 12, marginY: 8 });

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
 * 频道侧栏（BOT-CH-02、需求 §11.2 修订）：「等你处理」，然后是主频道，没分组的频道挂在它下面；每个分组另起一段（可折叠），
 * 组里的频道挂在组下；段内置顶的在前、其余按最近活动；树后面是「新建频道」。
 * 每行：频道图标（按频道颜色）、频道名（有未读时加粗、行尾一颗绿点），归档、置顶、私密与静音的小图标，等你的任务数；
 * 行尾「⋯」是频道菜单（channel-menu.tsx）。主频道行尾是筛选（进行中 / 已归档 / 全部）与「＋」，代替原来底部的「已归档」折叠组。
 * 对话框由 app-shell 里的 BotDialogs 统一开：侧栏会在浮出层里再挂一份，开着的对话框不跟着它卸下。
 */
export function ChannelSidebar() {
  const route = useSidebarRoute();
  const go = useSidebarGo();
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  const groups = useChannelGroups();
  const [status, setStatus] = useState<ChannelStatusFilter>('active');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const channelTreeRows = useMemo(() => channelTree(channels, groups, status), [channels, groups, status]);
  const total = needsYouTotal(channels);
  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (summary: ChannelSummary) => {
    const { channel, unread, counts } = summary;
    const main = channel.kind === 'main';
    const pinned = channel.pinned && !main && !channel.archived;
    const detail = [
      channel.name,
      unread ? C.sidebar.unread : null,
      counts.needsYou ? C.sidebar.needsYou(counts.needsYou) : null,
      pinned ? C.sidebar.pinned : null,
      channel.muted ? C.sidebar.muted : null,
      channel.private ? C.sidebar.private : null,
      channel.archived ? C.sidebar.archived : null,
    ]
      .filter(Boolean)
      .join(', ');
    return (
      <SideNavItem
        key={channel.id}
        id={channel.id}
        textValue={channel.name}
        href={hrefFor(channelRoute(channel.id))}
        data-bc-row=""
        data-bc-child={main ? undefined : ''}>
        <SideNavItemContent>
          <SideNavItemLink aria-label={detail}>
            <ChannelGlyph channel={channel} />
            <Text styles={fit}>
              <span className={line} title={channel.purpose || channel.name}>
                <span className={lineTitle({ isUnread: unread, isArchived: channel.archived })}>{channel.name}</span>
                <span className={tail} aria-hidden="true">
                  {channel.archived ? <Archive styles={tailIcon} /> : null}
                  {pinned ? <PinOn styles={tailIcon} /> : null}
                  {channel.private ? <Lock styles={tailIcon} /> : null}
                  {channel.muted ? <VolumeOff styles={tailIcon} /> : null}
                  {counts.needsYou ? <NotificationBadge size="S" value={counts.needsYou} /> : unread ? <span className={unreadDot} /> : null}
                </span>
              </span>
            </Text>
          </SideNavItemLink>
          {main ? <ChannelListTools status={status} onStatus={setStatus} /> : <ChannelActionMenu channel={channel} go={go} />}
        </SideNavItemContent>
      </SideNavItem>
    );
  };

  const groupSection = ({ group, rows }: { group: ChannelGroup; rows: ChannelSummary[] }) => {
    const open = !collapsed.has(group.id);
    return (
      <SideNavSection key={group.id} id={`group:${group.id}`}>
        <SideNavHeader>
          {/* 段头里的控件自己处理焦点与按键，不让 SideNav 把它们转给某一行（同 Home 的段头）。 */}
          <span className={`${groupHead} bc-section-head`} onFocus={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <ActionButton isQuiet size="S" styles={groupToggle} aria-expanded={open} onPress={() => toggleGroup(group.id)}>
              <Folder />
              <Text>
                <span className={groupName}>
                  <span className={groupNameText}>{group.name}</span>
                  {open ? <ChevronDown /> : <ChevronRight />}
                </span>
              </Text>
            </ActionButton>
            <GroupTools group={group} className={`${groupTools} bc-section-actions`} />
          </span>
        </SideNavHeader>
        {open ? rows.map(row) : []}
      </SideNavSection>
    );
  };

  const inboxRoute: Route = { tab: 'bot', channelId: null, workItemId: null, view: 'inbox' };
  const { main, loose } = channelTreeRows;
  const nothingElse = !loose.length && !channelTreeRows.groups.some((g) => g.rows.length);
  return (
    <PageSidebar label={C.sidebar.nav}>
      <SidebarTitle>{C.sidebar.title}</SidebarTitle>
      <div className={`${sidebarBody} ${tree} bc-scroll`}>
        {/* 分组的键加 `group:`：与条目同名（收件箱）时集合的前后链接成环，渲染时死循环。 */}
        <SideNav styles={nav} aria-label={C.sidebar.nav} selectedRoute={selectedHref(route)}>
          <SideNavSection id="group:inbox">
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
          {/* 侧栏标题已经是「频道」，这一段不再加组头。 */}
          <SideNavSection id="group:channels">{ready ? [main, ...loose].filter((r): r is ChannelSummary => r !== null).map(row) : []}</SideNavSection>
          {ready ? channelTreeRows.groups.map(groupSection) : []}
        </SideNav>
        {/* 导航树里没有 href 的行点了什么也不做，「新建频道」放在树外面。 */}
        <ActionButton
          isQuiet
          styles={newChannel}
          UNSAFE_style={{ justifyContent: 'start' }}
          onPress={() => useBotLayout.getState().setDialog({ kind: 'newChannel' })}>
          <Add />
          <Text>{C.sidebar.newChannel}</Text>
        </ActionButton>
        {ready && status !== 'active' && nothingElse ? <p className={empty}>{status === 'archived' ? C.sidebar.noArchived : C.sidebar.noOthers}</p> : null}
      </div>
    </PageSidebar>
  );
}
