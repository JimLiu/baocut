import { useState, type Key, type ReactNode } from 'react';
import { live, type Conversation, type SpaceEntry } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  DialogContainer,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SubmenuTrigger,
  Header as MenuHeader,
  Heading as MenuHeading,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Asset from '@react-spectrum/s2/icons/Asset';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import More from '@react-spectrum/s2/icons/More';
import MovieCamera from '@react-spectrum/s2/icons/MovieCamera';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import PinOff from '@react-spectrum/s2/icons/PinOff';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { untitled } from '../copy.ts';
import { sessionStatus } from '../model/sidebar.ts';
import { formatBytes, isPlayable, KIND_LABEL, videoTargetOf } from '../model/space.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useConnection } from '../state/connection-store.ts';
import { useProject } from '../state/directory-store.ts';
import { useShell } from '../state/shell-store.ts';
import { useSpace } from '../state/space-store.ts';
import { NameDialog } from './name-dialog.tsx';

/**
 * 会话头（产品设计 §3.2 用户修订）：一行标题、进行中与等待批准的状态，其余都收进会话菜单；会话摘要在标题栏的按钮里。
 * 它在标题栏里、会话列的上方（原型 home-workspace.css `.tbar__conversation .hhd`）：占满那一段的高度，左右 12，没有分隔线。
 * 功能区收起时它和右侧按钮组读作一组，右边不留白（`end: 'joined'`）；分屏时摘要跟在 ··· 后面，右边留 8（`end: 'summary'`）。
 * 窄窗口里它回到会话面板顶部（产品设计 §3.3），由 HomePage 包一层带分隔线的容器。
 */
const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexGrow: 1,
  minWidth: 0,
  height: 'full',
  boxSizing: 'border-box',
  paddingStart: 12,
  paddingEnd: { default: 12, end: { joined: 0, summary: 8 } },
});
const titleStyle = style({
  flexGrow: 1,
  minWidth: 0,
  margin: 0,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const statusText = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
/** 会话进行中 / 等待批准的状态词（按界面语言）；窄窗口的会话标签也用它（workspace-tabs.tsx）。 */
export const STATUS_WORD: { readonly running: string; readonly waiting: string } = live(() => ({
  running: S.conversationHeader.running,
  waiting: S.conversationHeader.waiting,
}));

/** 会话头右端的排法：默认左右 12；`joined` 和右侧按钮组连成一组；`summary` 在 ··· 后面跟着 `trailing`（会话摘要）。 */
export type ConversationHeaderEnd = 'joined' | 'summary';

export function ConversationHeader({
  conversation,
  end,
  trailing,
}: {
  conversation: Conversation;
  end?: ConversationHeaderEnd;
  trailing?: ReactNode;
}) {
  const runtime = useRuntime();
  const project = useProject(conversation.projectId);
  const go = useShell((s) => s.go);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const title = conversation.title || untitled();
  const status = sessionStatus(conversation);
  const word = status === 'running' || status === 'waiting' ? STATUS_WORD[status] : null;

  const onAction = (key: Key) => {
    if (key === 'new') go({ tab: 'home', conversationId: null, projectId: conversation.projectId });
    else if (key === 'rename') setDialog('rename');
    else if (key === 'delete') setDialog('delete');
    else if (key === 'pin')
      runtime
        .updateConversation(conversation.id, { pinned: !conversation.pinned })
        .catch((error: Error) => ToastQueue.negative(error.message, { timeout: 5000 }));
    else if (key === 'space' && project) go({ tab: 'space', category: 'all', projectId: project.id });
    else if (key === 'reveal') void runtime.host.revealPath(project?.path ?? conversation.cwd);
  };

  return (
    <header className={header({ end })} data-workspace-head>
      <h1 className={titleStyle} title={title}>
        {title}
      </h1>
      {word ? (
        <span className={statusText} role="status">
          {word}
        </span>
      ) : null}
      <MenuTrigger>
        <ActionButton isQuiet aria-label={S.conversationHeader.actions}>
          <More />
        </ActionButton>
        <Menu aria-label={S.conversationHeader.actions} onAction={onAction}>
          <MenuSection>
            <MenuItem id="new" textValue={project ? S.common.newSessionInProject : S.common.newSession}>
              <Add />
              <Text slot="label">{project ? S.common.newSessionInProject : S.common.newSession}</Text>
            </MenuItem>
            <VideoSubmenu conversation={conversation} />
            <MediaSubmenu conversation={conversation} />
          </MenuSection>
          <MenuSection>
            <MenuItem id="pin" textValue={conversation.pinned ? S.common.unpin : S.common.pin}>
              {conversation.pinned ? <PinOff /> : <PinOn />}
              <Text slot="label">{conversation.pinned ? S.common.unpin : S.common.pin}</Text>
            </MenuItem>
            <MenuItem id="rename" textValue={S.common.rename}>
              <Edit />
              <Text slot="label">{S.common.renameEllipsis}</Text>
            </MenuItem>
            {project ? (
              <MenuItem id="space" textValue={S.conversationHeader.viewInSpace(project.name)}>
                <Asset />
                <Text slot="label">{S.conversationHeader.viewInSpace(project.name)}</Text>
              </MenuItem>
            ) : null}
            <MenuItem id="reveal" textValue={project ? S.conversationHeader.revealProject : S.conversationHeader.revealWorkdir}>
              <OpenIn />
              <Text slot="label">{project ? S.conversationHeader.revealProject : S.conversationHeader.revealWorkdir}</Text>
            </MenuItem>
          </MenuSection>
          <MenuSection>
            <MenuItem id="delete" textValue={S.conversationHeader.deleteSession}>
              <Delete />
              <Text slot="label">{S.conversationHeader.deleteSessionEllipsis}</Text>
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
      {trailing}
      <DialogContainer onDismiss={() => setDialog(null)}>
        {dialog === 'delete' ? (
          <AlertDialog
            variant="destructive"
            title={S.conversationHeader.deleteTitle}
            primaryActionLabel={S.conversationHeader.deleteConfirm}
            cancelLabel={S.common.cancel}
            onPrimaryAction={async () => {
              try {
                await runtime.deleteConversation(conversation.id);
                go({ tab: 'home', conversationId: null, projectId: conversation.projectId });
              } catch (error) {
                ToastQueue.negative(S.conversationHeader.deleteFailed((error as Error).message), { timeout: 5000 });
              }
            }}>
            {S.conversationHeader.deleteBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
      {dialog === 'rename' ? (
        <NameDialog
          title={S.conversationHeader.renameTitle}
          label={S.common.name}
          initial={title}
          submitLabel={S.common.save}
          onClose={() => setDialog(null)}
          onSubmit={async (next) => {
            await runtime.updateConversation(conversation.id, { title: next });
            setDialog(null);
          }}
        />
      ) : null}
    </header>
  );
}

/** 草稿工作区开了标签时的会话头（原型 shell.jsx：空白草稿开了标签后左侧放「新会话」占位头）：只有标题。 */
export function DraftConversationHeader({ end }: { end?: ConversationHeaderEnd }) {
  const title = untitled();
  return (
    <header className={header({ end })} data-workspace-head>
      <h1 className={titleStyle} title={title}>
        {title}
      </h1>
    </header>
  );
}

/** 这条会话的来源目录里的条目：项目会话看项目目录，不属于项目的会话看它自己的工作目录。 */
function useSourceEntries(conversation: Conversation, accept: (entry: SpaceEntry) => boolean) {
  const all = useSpace((s) => s.entries);
  return all
    .filter(
      (e) =>
        (conversation.projectId ? e.source.projectId === conversation.projectId : e.source.conversationId === conversation.id) &&
        e.user.trashedAt === null &&
        accept(e),
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** 在会话右侧的功能区里打开来源目录里的一个文件，作为一个标签。按条目的来源定位（项目会话按项目），和 Space 里打开的是同一个标签。 */
function usePlayInPane() {
  const openPane = useShell((s) => s.openPane);
  return (entry: SpaceEntry) => openPane({ kind: 'file', target: videoTargetOf(entry) });
}

/**
 * 打开来源目录里的视频，或新建一个（产品设计 §2.3：从会话可以打开该项目下的视频）。视频在右边的编辑器里打开，会话留在左边。
 * 不属于项目的会话，视频建在它的工作目录里。
 */
function VideoSubmenu({ conversation }: { conversation: Conversation }) {
  const runtime = useRuntime();
  const ready = useSpace((s) => s.ready);
  const connected = useConnection((s) => s.state.status === 'connected');
  const openVideo = useShell((s) => s.openVideo);
  const videos = useSourceEntries(conversation, (e) => e.kind === 'video');
  const where = conversation.projectId ? 'project' : 'workdir';

  const onAction = (key: Key) => {
    if (key === 'new-video') {
      const scope = conversation.projectId ? { projectId: conversation.projectId } : { conversationId: conversation.id };
      runtime.videos
        .create(scope)
        .then((target) => openVideo(target))
        .catch((error: Error) => ToastQueue.negative(S.conversationHeader.newVideoFailed(error.message), { timeout: 5000 }));
      return;
    }
    const entry = videos.find((e) => e.id === key);
    if (entry) openVideo(videoTargetOf(entry));
  };

  return (
    <SubmenuTrigger>
      <MenuItem id="videos" textValue={S.conversationHeader.openVideo}>
        <MovieCamera />
        <Text slot="label">{S.conversationHeader.openVideo}</Text>
      </MenuItem>
      <Menu
        aria-label={S.conversationHeader.videosIn(where)}
        disabledKeys={[...(videos.length ? [] : ['no-video']), ...(connected ? [] : ['new-video'])]}
        onAction={onAction}>
        <MenuSection>
          <MenuHeader>
            <MenuHeading>{S.conversationHeader.videosIn(where)}</MenuHeading>
          </MenuHeader>
          {videos.length ? (
            videos.map((entry) => (
              <MenuItem key={entry.id} id={entry.id} textValue={entry.name}>
                <Text slot="label">{entry.name}</Text>
                <Text slot="description">{entry.relPath}</Text>
              </MenuItem>
            ))
          ) : (
            <MenuItem id="no-video" textValue={S.conversationHeader.none}>
              <Text slot="label">{ready ? S.conversationHeader.noVideosIn(where) : S.conversationHeader.scanning}</Text>
            </MenuItem>
          )}
        </MenuSection>
        <MenuSection>
          <MenuItem id="new-video" textValue={S.conversationHeader.newVideo}>
            <Add />
            <Text slot="label">{S.conversationHeader.newVideo}</Text>
          </MenuItem>
        </MenuSection>
      </Menu>
    </SubmenuTrigger>
  );
}

/** 在功能区播放来源目录里的视频文件或音频（产品设计 §3.3「用户手动打开」）：开成一个文件标签。 */
function MediaSubmenu({ conversation }: { conversation: Conversation }) {
  const ready = useSpace((s) => s.ready);
  const play = usePlayInPane();
  const media = useSourceEntries(conversation, (e) => isPlayable(e.fileName)).slice(0, 30);
  const where = conversation.projectId ? 'project' : 'workdir';

  return (
    <SubmenuTrigger>
      <MenuItem id="media" textValue={S.conversationHeader.playMedia}>
        <Play />
        <Text slot="label">{S.conversationHeader.playMedia}</Text>
      </MenuItem>
      <Menu
        aria-label={S.conversationHeader.mediaIn(where)}
        disabledKeys={media.length ? [] : ['no-media']}
        onAction={(key) => {
          const entry = media.find((e) => e.id === key);
          if (entry) play(entry);
        }}>
        <MenuSection>
          <MenuHeader>
            <MenuHeading>{S.conversationHeader.mediaIn(where)}</MenuHeading>
          </MenuHeader>
          {media.length ? (
            media.map((entry) => (
              <MenuItem key={entry.id} id={entry.id} textValue={entry.name}>
                <Text slot="label">{entry.name}</Text>
                <Text slot="description">
                  {entry.relPath === entry.fileName ? KIND_LABEL[entry.kind] : entry.relPath} · {formatBytes(entry.size)}
                </Text>
              </MenuItem>
            ))
          ) : (
            <MenuItem id="no-media" textValue={S.conversationHeader.none}>
              <Text slot="label">{ready ? S.conversationHeader.noMediaIn(where) : S.conversationHeader.scanning}</Text>
            </MenuItem>
          )}
        </MenuSection>
      </Menu>
    </SubmenuTrigger>
  );
}
