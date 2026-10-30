import type { ReactElement } from 'react';
import type { Conversation } from '@baocut/protocol';
import {
  ActionMenu,
  MenuItem,
  MenuSection,
  ProgressCircle,
  SideNavItem,
  SideNavItemContent,
  SideNavItemLink,
  Text,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Archive from '@react-spectrum/s2/icons/Archive';
import ClockPending from '@react-spectrum/s2/icons/ClockPending';
import Asset from '@react-spectrum/s2/icons/Asset';
import Brand from '@react-spectrum/s2/icons/Brand';
import Comment from '@react-spectrum/s2/icons/Comment';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import Import from '@react-spectrum/s2/icons/Import';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import PinOff from '@react-spectrum/s2/icons/PinOff';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import Settings from '@react-spectrum/s2/icons/Settings';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import VisibilityOff from '@react-spectrum/s2/icons/VisibilityOff';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { revealLabel, untitled } from '../copy.ts';
import { S } from './shell-copy.ts';
import { agoLabel, shortenPath } from '../model/format.ts';
import { conversationStatus, sessionStatus, type ProjectRow } from '../model/sidebar.ts';
import { hrefFor } from '../state/shell-store.ts';
import { IMPORT_COPY } from './agent-import/import-copy.ts';
import { PROJECT_SETTINGS_COPY } from './project-settings/project-settings-copy.ts';
import { PROJECT_MENU_COPY } from './skills/skills-copy.ts';

/** SideNav 把文字放在 auto 宽的网格列里：允许它收窄，标题才会省略而不是溢出到行尾按钮下面。 */
const fit = style({ minWidth: 0 });
const line = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: 'full' });
const lineTitle = style({ flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const newHere = style({ color: 'gray-600' });
/** 目录不在了：行尾一个橙色三角，与会话「等批准」同色系，表示要用户处理而不是出错。 */
const missingTail = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  color: 'orange-900',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
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
  markUnread(conversation: Conversation): void;
  markRead(conversation: Conversation): void;
}

/**
 * 会话行（置顶、项目下、最近、单表、状态分段几处同一个）：单行标题 + 行尾状态；完整状态、项目与时间放在悬停说明里。
 * 悬停或聚焦时行尾出现「⋯」：置顶、标为未读（已是未读时换成标为已读）、归档。置顶的会话带一个对话气泡图标。
 * 标为未读只给已读、没有别的状态的会话；正打开着的那条一看就会被标回已读，也不让点。
 */
export function conversationItem(
  conversation: Conversation,
  key: string,
  {
    now,
    projectName,
    pinned = false,
    open = false,
    actions,
  }: { now: number; projectName: string | null; pinned?: boolean; open?: boolean; actions: ConversationRowActions },
) {
  const title = conversation.title || untitled();
  const status = conversationStatus(conversation);
  const tailStatus = sessionStatus(conversation);
  const onAction = (action: string) => {
    if (action === 'pin') actions.togglePin(conversation);
    else if (action === 'unread') actions.markUnread(conversation);
    else if (action === 'read') actions.markRead(conversation);
    else if (action === 'archive') actions.archive(conversation);
  };
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
        <ActionMenu
          aria-label={S.sidebarRows.rowActions(title)}
          isQuiet
          size="S"
          disabledKeys={tailStatus || open ? ['unread'] : undefined}
          onAction={(action) => onAction(String(action))}>
          <MenuItem id="pin" textValue={conversation.pinned ? S.common.unpin : S.common.pin}>
            {conversation.pinned ? <PinOff /> : <PinOn />}
            <Text>{conversation.pinned ? S.common.unpin : S.common.pin}</Text>
          </MenuItem>
          {/* 两个分支各带 key：已读、未读之间切换时换一个条目，集合不允许同一个条目改 id。 */}
          {tailStatus === 'unread' ? (
            <MenuItem key="read" id="read" textValue={S.sidebarRows.markRead}>
              <Visibility />
              <Text>{S.sidebarRows.markRead}</Text>
            </MenuItem>
          ) : (
            <MenuItem key="unread" id="unread" textValue={S.sidebarRows.markUnread}>
              <VisibilityOff />
              <Text>{S.sidebarRows.markUnread}</Text>
            </MenuItem>
          )}
          <MenuItem id="archive" textValue={S.sidebarRows.archive}>
            <Archive />
            <Text>{S.sidebarRows.archive}</Text>
          </MenuItem>
        </ActionMenu>
      </SideNavItemContent>
    </SideNavItem>
  );
}

/** 目录不在了时用不了的项目菜单项：它们都要读写这个目录。置顶、重命名与移除只动登记，照常可用。 */
const NEEDS_FOLDER = ['new', 'space', 'brand', 'reveal', 'settings', 'import'];

/**
 * 一个项目：单行文件夹行 + 它的会话；状态汇总与路径在悬停说明里。行尾的项目菜单与展开钮悬停或聚焦时才出现。
 * 目录不在了（`missing`，架构设计 §5.1）：行尾带提示三角，要用目录的菜单项变灰，空项目的「在这里新建会话」换成提示；
 * 已有会话照常列出、可以打开看记录。
 */
export function ProjectItem({
  id,
  row,
  open,
  onAction,
  conversationRow,
  canImport,
}: {
  id: string;
  row: ProjectRow;
  open: boolean;
  onAction: (key: string) => void;
  conversationRow: (conversation: Conversation, key: string) => ReactElement;
  /** 有「导入这个目录的会话…」（产品设计 §3.1「导入外部会话」）：浏览器里没有。 */
  canImport: boolean;
}) {
  const { project } = row;
  const missing = project.missing === true;
  const newHref = hrefFor({ tab: 'home', conversationId: null, projectId: project.id });
  const detail = [project.name, missing ? S.sidebarRows.folderMissing : row.summary, shortenPath(project.path)].filter(Boolean).join(' · ');
  return (
    <SideNavItem id={id} textValue={project.name} hasChildItems data-bc-expandable="">
      <SideNavItemContent>
        {open ? <FolderOpen /> : <Folder />}
        <Text styles={fit}>
          <span className={line} title={missing ? `${detail}\n${S.sidebarRows.folderMissingHint}` : detail}>
            <span className={lineTitle}>{project.name}</span>
            {missing ? (
              <span className={missingTail} role="img" aria-label={S.sidebarRows.folderMissing}>
                <AlertTriangle styles={tailIcon} />
              </span>
            ) : null}
          </span>
        </Text>
        <ActionMenu
          aria-label={S.sidebarRows.projectActions(project.name)}
          isQuiet
          size="S"
          disabledKeys={missing ? NEEDS_FOLDER : undefined}
          onAction={(key) => onAction(String(key))}>
          <MenuSection>
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
            <MenuItem id="brand" textValue={PROJECT_MENU_COPY.brand}>
              <Brand />
              <Text>{PROJECT_MENU_COPY.brand}</Text>
            </MenuItem>
            <MenuItem id="reveal" textValue={revealLabel()}>
              <OpenIn />
              <Text>{revealLabel()}</Text>
            </MenuItem>
            <MenuItem id="settings" textValue={PROJECT_SETTINGS_COPY.menuItem}>
              <Settings />
              <Text>{PROJECT_SETTINGS_COPY.menuItem}</Text>
            </MenuItem>
            {canImport ? (
              <MenuItem id="import" textValue={IMPORT_COPY.menuProject}>
                <Import />
                <Text slot="label">{IMPORT_COPY.menuProject}</Text>
                <Text slot="description">{IMPORT_COPY.menuProjectHint}</Text>
              </MenuItem>
            ) : null}
          </MenuSection>
          <MenuSection>
            <MenuItem id="remove" textValue={S.sidebarRows.removeProject}>
              <Delete />
              <Text>{S.sidebarRows.removeProject}</Text>
            </MenuItem>
          </MenuSection>
        </ActionMenu>
      </SideNavItemContent>
      {row.conversations.map((conversation) => conversationRow(conversation, `${id}/${conversation.id}`))}
      {/* 两个分支各带 key：目录在与不在之间切换时换一个条目，集合不允许同一个条目改 id。 */}
      {row.conversations.length ? null : missing ? (
        <SideNavItem key="missing" id={`${id}/missing`} textValue={S.sidebarRows.folderMissing} data-bc-row="">
          <SideNavItemContent>
            <Text styles={fit}>
              <span className={line} title={S.sidebarRows.folderMissingHint}>
                <span className={`${lineTitle} ${newHere}`}>{S.sidebarRows.folderMissing}</span>
              </span>
            </Text>
          </SideNavItemContent>
        </SideNavItem>
      ) : (
        <SideNavItem key="new" id={`${id}/new`} textValue={S.sidebarRows.newHere} href={newHref} data-bc-row="">
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
