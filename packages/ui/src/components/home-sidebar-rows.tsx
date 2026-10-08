import type { ReactElement } from 'react';
import type { Conversation } from '@baocut/protocol';
import {
  ActionButton,
  ActionButtonGroup,
  ActionMenu,
  MenuItem,
  ProgressCircle,
  SideNavItem,
  SideNavItemContent,
  SideNavItemLink,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Archive from '@react-spectrum/s2/icons/Archive';
import ClockPending from '@react-spectrum/s2/icons/ClockPending';
import Asset from '@react-spectrum/s2/icons/Asset';
import Comment from '@react-spectrum/s2/icons/Comment';
import Edit from '@react-spectrum/s2/icons/Edit';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import PinOff from '@react-spectrum/s2/icons/PinOff';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { revealLabel, untitled } from '../copy.ts';
import { S } from './shell-copy.ts';
import { agoLabel, shortenPath } from '../model/format.ts';
import { conversationStatus, sessionStatus, type ProjectRow } from '../model/sidebar.ts';
import { hrefFor } from '../state/shell-store.ts';

/** SideNav 把文字放在 auto 宽的网格列里：允许它收窄，标题才会省略而不是溢出到行尾按钮下面。 */
const fit = style({ minWidth: 0 });
const line = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: 'full' });
const lineTitle = style({ flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const newHere = style({ color: 'gray-600' });
const tail = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 16,
  color: { tone: { waiting: 'orange-900', failed: 'red-900', unread: 'green-900', running: 'gray-700' } },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const unreadDot = style({ size: 8, borderRadius: 'full', backgroundColor: 'green-900' });
const tailIcon = iconStyle({ size: 'S' });

/** 会话行尾的状态：进行中是加载环，等批准与失败各有形状不同的图标，做完未读是一颗绿点（产品设计 §3.1 用户修订）。 */
function SessionTail({ conversation }: { conversation: Conversation }) {
  const status = sessionStatus(conversation);
  if (!status) return null;
  return (
    <span className={tail({ tone: status })} aria-hidden="true">
      {status === 'running' ? (
        <ProgressCircle size="S" isIndeterminate aria-label={S.common.working} />
      ) : status === 'waiting' ? (
        <ClockPending styles={tailIcon} />
      ) : status === 'failed' ? (
        <AlertTriangle styles={tailIcon} />
      ) : (
        <span className={unreadDot} />
      )}
    </span>
  );
}

export interface ConversationRowActions {
  togglePin(conversation: Conversation): void;
  archive(conversation: Conversation): void;
}

/**
 * 会话行（置顶、项目下、最近、单表四处同一个）：单行标题 + 行尾状态；完整状态、项目与时间放在悬停说明里。
 * 悬停或聚焦时行尾出现置顶与归档。置顶的会话带一个对话气泡图标。
 */
export function conversationItem(
  conversation: Conversation,
  key: string,
  { now, projectName, pinned = false, actions }: { now: number; projectName: string | null; pinned?: boolean; actions: ConversationRowActions },
) {
  const title = conversation.title || untitled();
  const status = conversationStatus(conversation);
  const detail = [title, projectName ?? S.sidebarRows.noProject, status?.label, agoLabel(conversation.updatedAt, now)].filter(Boolean).join(' · ');
  return (
    <SideNavItem
      key={key}
      id={key}
      textValue={title}
      href={hrefFor({ tab: 'home', conversationId: conversation.id, projectId: null })}
      data-bc-row="">
      <SideNavItemContent>
        <SideNavItemLink aria-label={detail}>
          {pinned ? <Comment /> : null}
          <Text styles={fit}>
            <span className={line} title={detail}>
              <span className={lineTitle}>{title}</span>
              <SessionTail conversation={conversation} />
            </span>
          </Text>
        </SideNavItemLink>
        <ActionButtonGroup isQuiet size="S" UNSAFE_className="bc-row-actions" aria-label={S.sidebarRows.rowActions(title)}>
          <TooltipTrigger>
            <ActionButton aria-label={S.sidebarRows.togglePin(conversation.pinned, title)} onPress={() => actions.togglePin(conversation)}>
              {conversation.pinned ? <PinOff /> : <PinOn />}
            </ActionButton>
            <Tooltip>{conversation.pinned ? S.common.unpin : S.common.pin}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <ActionButton aria-label={S.sidebarRows.archiveNamed(title)} onPress={() => actions.archive(conversation)}>
              <Archive />
            </ActionButton>
            <Tooltip>{S.sidebarRows.archive}</Tooltip>
          </TooltipTrigger>
        </ActionButtonGroup>
      </SideNavItemContent>
    </SideNavItem>
  );
}

/**
 * 一个项目：单行文件夹行 + 它的会话；状态汇总与路径在悬停说明里。行尾的项目菜单与展开钮悬停或聚焦时才出现。
 */
export function ProjectItem({
  id,
  row,
  open,
  onAction,
  conversationRow,
}: {
  id: string;
  row: ProjectRow;
  open: boolean;
  onAction: (key: string) => void;
  conversationRow: (conversation: Conversation, key: string) => ReactElement;
}) {
  const { project } = row;
  const newHref = hrefFor({ tab: 'home', conversationId: null, projectId: project.id });
  const detail = [project.name, row.summary, shortenPath(project.path)].filter(Boolean).join(' · ');
  return (
    <SideNavItem id={id} textValue={project.name} hasChildItems data-bc-expandable="">
      <SideNavItemContent>
        {open ? <FolderOpen /> : <Folder />}
        <Text styles={fit}>
          <span className={line} title={detail}>
            <span className={lineTitle}>{project.name}</span>
          </span>
        </Text>
        <ActionMenu
          aria-label={S.sidebarRows.projectActions(project.name)}
          isQuiet
          size="S"
          onAction={(key) => onAction(String(key))}>
          <MenuItem id="new" textValue={S.common.newSessionInProject}>
            <Add />
            <Text>{S.common.newSessionInProject}</Text>
          </MenuItem>
          <MenuItem id="pin" textValue={project.pinned ? S.common.unpin : S.common.pin}>
            {project.pinned ? <PinOff /> : <PinOn />}
            <Text>{project.pinned ? S.common.unpin : S.common.pin}</Text>
          </MenuItem>
          <MenuItem id="rename" textValue={S.common.rename}>
            <Edit />
            <Text>{S.common.renameEllipsis}</Text>
          </MenuItem>
          <MenuItem id="space" textValue={S.sidebarRows.showInSpace}>
            <Asset />
            <Text>{S.sidebarRows.showInSpace}</Text>
          </MenuItem>
          <MenuItem id="reveal" textValue={revealLabel()}>
            <OpenIn />
            <Text>{revealLabel()}</Text>
          </MenuItem>
        </ActionMenu>
      </SideNavItemContent>
      {row.conversations.map((conversation) => conversationRow(conversation, `${id}/${conversation.id}`))}
      {row.conversations.length ? null : (
        <SideNavItem id={`${id}/new`} textValue={S.sidebarRows.newHere} href={newHref} data-bc-row="">
          <SideNavItemContent>
            <SideNavItemLink>
              <Text>
                <span className={newHere}>{S.sidebarRows.newHere}</span>
              </Text>
            </SideNavItemLink>
          </SideNavItemContent>
        </SideNavItem>
      )}
    </SideNavItem>
  );
}
