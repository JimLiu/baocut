import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { FileTarget, Id, SpaceEntry, SpaceEntryKind } from '@baocut/protocol';
import {
  ActionButton,
  Content,
  Heading,
  IllustratedMessage,
  InlineAlert,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Header as MenuHeader,
  Heading as MenuHeading,
  Picker,
  PickerItem,
  ProgressCircle,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  SubmenuTrigger,
  SideNav,
  SideNavHeader,
  SideNavItem,
  SideNavItemContent,
  SideNavItemLink,
  SideNavSection,
  Text,
  ToastQueue,
  Button,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import AppsAll from '@react-spectrum/s2/icons/AppsAll';
import Archive from '@react-spectrum/s2/icons/Archive';
import Delete from '@react-spectrum/s2/icons/Delete';
import FileAdd from '@react-spectrum/s2/icons/FileAdd';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import Import from '@react-spectrum/s2/icons/Import';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Star from '@react-spectrum/s2/icons/Star';
import ViewGrid from '@react-spectrum/s2/icons/ViewGrid';
import ViewList from '@react-spectrum/s2/icons/ViewList';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { untitled } from '../../copy.ts';
import { mediaKindOf } from '../../model/new-flow.ts';
import { madeShorts } from '../../model/shorts-result.ts';
import {
  editBlock,
  entryConversationId,
  entryJobId,
  isFailedPlaceholder,
  packageScope,
  placeKindOf,
  relatedEntries,
  videoIdOf,
  videoNameOf,
} from '../../model/space-actions.ts';
import {
  countByCategory,
  derivedCount,
  derivedFrom,
  entryPath,
  filesOf,
  hostVideoOf,
  parentVideoOf,
  videoTargetOf,
  projectOptions,
  SPACE_CATEGORIES,
  SPACE_SORTS,
  SPACE_STATUS_FILTERS,
  sourceLabel,
  videoNamesOf,
  viewEntries,
  visibleCategories,
  type SpaceCategory,
  type SpaceSort,
  type SpaceStatusFilter,
} from '../../model/space.ts';
import type { EditorKind } from '../../model/workspace.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory, useProject } from '../../state/directory-store.ts';
import { hrefFor, useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { takeSpaceFocus, useSpaceFocus } from '../../state/space-focus-store.ts';
import { EditorWorkspace } from '../editor/editor-workspace.tsx';
import { VideoQuickChat } from '../editor/video-quick-chat.tsx';
import { createBlankVideo } from '../start/blank-video.ts';
import { openHome } from '../start/open-home.ts';
import { PageSidebar, SidebarNote, SidebarTitle, sidebarBody } from '../page-sidebar.tsx';
import { useNarrow } from '../use-narrow.ts';
import { useNow } from '../use-now.ts';
import { SpaceVideoInfo } from '../video-info-dialog.tsx';
import { SPACE_COPY as COPY } from './space-copy.ts';
import { SpaceDialogs, type SpaceDialogState } from './space-dialogs.tsx';
import { KIND_ICON, SpaceGrid, SpaceTable, type EntryAction } from './space-list.tsx';
import { SpaceSearchHits } from './space-search-hits.tsx';
import { useEntryTools } from '../tools/use-entry-tools.ts';
import { useTranscribedEntries } from '../tools/use-candidates.ts';
import { useVideoTools } from '../tools/use-video-tools.ts';
import { failedTranscribeJob, spaceTranscribeAction, transcribeState, type SpaceTranscribeAction } from '../../model/tool-targets.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { SpaceViewer, type ViewerActions } from './space-viewer.tsx';
import { useRelatedVideos } from './use-related-videos.ts';

const page = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0 });
const navRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: 'full' });
const navCount = style({ font: 'ui-xs', color: 'gray-600' });

/** Space 的内容区（产品设计 §4 用户修订）：两边留 40，内容区窄于 440 时收到 24。 */
const main = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
const bar = style({
  display: 'grid',
  gridTemplateColumns: { default: ['minmax(0, 1fr)', 'auto'], isStacked: ['minmax(0, 1fr)'] },
  alignItems: 'center',
  gap: 24,
  flexShrink: 0,
  paddingTop: { default: 32, isTight: 24 },
  paddingX: { default: 40, isTight: 24 },
  paddingBottom: 24,
});
const title = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  margin: 0,
  fontSize: '[22px]',
  fontWeight: 'bold',
  color: 'gray-900',
});
const titleCount = style({ font: 'ui', color: 'gray-600' });
const barActions = style({ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 });
const search = style({ width: { default: 280, isStacked: 'auto' }, flexGrow: { default: 0, isStacked: 1 }, minWidth: 0 });
const tools = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 16,
  flexShrink: 0,
  paddingX: { default: 40, isTight: 24 },
  paddingBottom: 24,
});
const filters = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexGrow: 1, minWidth: 0 });
const picker = style({ width: 140, maxWidth: 'full' });
const viewTools = style({ display: 'flex', alignItems: 'center', gap: 8 });
/** 按来源筛选时的那一条：「从「X」切出的短视频」加清除。 */
const fromChip = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', color: 'gray-800' });
const notes = style({ display: 'flex', flexDirection: 'column', gap: 8, paddingX: { default: 40, isTight: 24 }, paddingBottom: 16 });
/** 内容命中下面那一块的小标题「名称与文件」（同原型 `space__sub`）。 */
const namesHead = style({ font: 'title-sm', marginY: 0, paddingX: { default: 40, isTight: 24 } });
/** 名称与文件没对上时那一行：上面已有内容命中，不用大号空态。空态容器是居中的竖排 flex，用 `marginBottom: auto` 顶到上面；网格两边少留了卡片间距，这里补上才和小标题对齐。 */
const namesNone = style({
  font: 'body-sm',
  color: 'gray-700',
  marginTop: 0,
  marginBottom: 'auto',
  paddingY: 4,
  paddingX: { isGrid: 12 },
  alignSelf: 'start',
});
/** CardView 在两端也留一份卡片间距（约 12）：网格少留这么多，卡片才和标题对齐。 */
const list = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
  paddingTop: 8,
  paddingX: { default: 40, isGrid: 28, isTight: { default: 24, isGrid: 12 } },
  paddingBottom: 24,
});

const MINE_ICON: Partial<Record<SpaceCategory, ComponentType>> = { all: AppsAll, favorite: Star, trash: Delete };

/**
 * Space（产品设计 §4）：所有项目里的视频、素材与产物的视图。0.2 列出项目目录与临时会话目录里的文件；
 * 文件仍在各自的目录里，这里只加收藏、回收站这类标记。
 */
export function SpacePage({
  category,
  projectId,
  video,
  from = null,
}: {
  category: SpaceCategory;
  projectId: Id | null;
  video: FileTarget | null;
  /** 只看从这部视频派生的视频（`viewEntries` 的 `from`）。 */
  from?: Id | null;
}) {
  return (
    <div className={page}>
      <SpaceSidebar category={category} projectId={projectId} />
      {video ? <SpaceVideo video={video} /> : <SpaceMain category={category} projectId={projectId} from={from} />}
    </div>
  );
}

/** Space 的页面侧栏；侧栏浮出（app-shell.tsx）时按浮出区域的路由传 category 与 projectId。 */
export function SpaceSidebar({ category, projectId }: { category: SpaceCategory; projectId: Id | null }) {
  const entries = useSpace((s) => s.entries);
  const counts = useMemo(() => countByCategory(entries), [entries]);
  const categories = visibleCategories(counts);
  const item = (key: SpaceCategory, label: string) => {
    const Icon = MINE_ICON[key] ?? KIND_ICON[key as SpaceEntryKind];
    const href = hrefFor({ tab: 'space', category: key, projectId });
    return (
      <SideNavItem key={key} id={key} textValue={label} href={href} data-bc-row="">
        <SideNavItemContent>
          <SideNavItemLink>
            <Icon />
            <Text>
              <span className={navRow}>
                <span>{label}</span>
                <span className={navCount}>{counts[key]}</span>
              </span>
            </Text>
          </SideNavItemLink>
        </SideNavItemContent>
      </SideNavItem>
    );
  };
  return (
    <PageSidebar label={COPY.sidebarLabel}>
      <SidebarTitle>Space</SidebarTitle>
      <div className={`${sidebarBody} bc-scroll`}>
        <SideNav aria-label={COPY.sidebarLabel} selectedRoute={hrefFor({ tab: 'space', category, projectId })}>
          <SideNavSection id="kinds">
            <SideNavHeader>{COPY.kindsHeader}</SideNavHeader>
            {categories.filter((c) => c.group === 'kinds').map((c) => item(c.key, c.label))}
          </SideNavSection>
          <SideNavSection id="mine">
            <SideNavHeader>{COPY.mineHeader}</SideNavHeader>
            {categories.filter((c) => c.group === 'mine').map((c) => item(c.key, c.label))}
          </SideNavSection>
        </SideNav>
      </div>
      <SidebarNote>{COPY.sidebarNote}</SidebarNote>
    </PageSidebar>
  );
}

/** 动作失败时的一句话（Runtime 的拒绝原因原样带上）。 */
const failed = (what: string) => (error: Error) => ToastQueue.negative(COPY.failed(what, error.message), { timeout: 6000 });

/**
 * 把便携包打开成新视频并进编辑器（架构设计 §5.8）：包里带着全部素材，解开要一会儿，先挂一条进行中的提示。
 * 校验不过时 Runtime 拒绝、不留下视频目录，原样报给用户。成功时返回 true。
 */
async function openPackageAs(runtime: RuntimeSession, scope: { projectId: Id } | { conversationId: Id }, path: string): Promise<boolean> {
  const name = videoNameOf(path);
  const close = ToastQueue.neutral(COPY.packageOpening(name));
  try {
    const target = await runtime.importPackage(scope, path);
    close();
    useShell.getState().openVideo(target);
    ToastQueue.positive(COPY.packageOpened(name), { timeout: 4000 });
    return true;
  } catch (error) {
    close();
    failed(COPY.openPackage)(error as Error);
    return false;
  }
}

function SpaceMain({ category, projectId, from }: { category: SpaceCategory; projectId: Id | null; from: Id | null }) {
  const runtime = useRuntime();
  const { ready, scanning, entries, issues } = useSpace();
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const connected = useConnection((s) => s.state.status === 'connected');
  const view = useShell((s) => s.spaceView);
  const sort = useShell((s) => s.spaceSort);
  const { replace, go, setSpaceView, setSpaceSort, openVideo } = useShell.getState();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SpaceStatusFilter>('any');
  const [viewingId, setViewingId] = useState<Id | null>(null);
  const [infoId, setInfoId] = useState<Id | null>(null);
  const [dialog, setDialog] = useState<SpaceDialogState | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  // 从工具结果、任务详情的「在 Space 中查看」来：条目到了就打开它的查看器。
  const focus = useSpaceFocus((s) => s.focus);
  useEffect(() => {
    const id = takeSpaceFocus((id) => entries.some((e) => e.id === id));
    if (id) setViewingId(id);
  }, [focus, entries]);
  const now = useNow(60_000);
  const ref = useRef<HTMLDivElement>(null);
  // 窄于 900 时标题与搜索上下排；窄于 440 时两边的留白收到 24。
  const isStacked = useNarrow(ref, 900);
  const isTight = useNarrow(ref, 440);

  const dirs = { projects, conversations };
  const rows = useMemo(
    () => viewEntries(entries, { category, projectId, search: query, sort, status, from }),
    [entries, category, projectId, query, sort, status, from],
  );
  // 父视频卡片 / 行上的「N 支短视频」。
  const shorts = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const entry of entries) {
      const parent = entry.user.trashedAt ? null : derivedFrom(entry);
      if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return counts;
  }, [entries]);
  const showShorts = (entry: SpaceEntry) => {
    const videoId = videoIdOf(entry);
    if (!videoId) return;
    setViewingId(null);
    go({ tab: 'space', category: 'all', projectId: null, from: videoId });
  };
  const options = useMemo(() => projectOptions(entries, projects), [entries, projects]);
  const videoNames = useMemo(() => videoNamesOf(entries), [entries]);
  const importable = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const label = SPACE_CATEGORIES.find((c) => c.key === category)?.label ?? COPY.all;
  const viewing = viewingId ? (entries.find((e) => e.id === viewingId) ?? null) : null;
  const info = infoId ? (entries.find((e) => e.id === infoId) ?? null) : null;
  // 视频的查看框列出名下的文件，文件的查看框能回到所属的视频（§4.3）：从哪个分类、哪里打开都一样，所以按全部条目算。
  const viewingFiles = useMemo(() => (viewing?.kind === 'video' ? filesOf(entries, viewing.id) : []), [entries, viewing]);
  const viewingHost = useMemo(() => (viewing ? hostVideoOf(entries, viewing) : null), [entries, viewing]);
  // 视频的查看框列出它切出的短视频，短视频的查看框能回到父视频（§4.5）。
  const viewingShorts = useMemo(() => {
    const videoId = viewing?.kind === 'video' ? videoIdOf(viewing) : null;
    return videoId ? madeShorts(entries, videoId) : [];
  }, [entries, viewing]);
  const viewingParent = useMemo(() => (viewing ? parentVideoOf(entries, viewing) : null), [entries, viewing]);
  const viewingTools = useEntryTools(viewing);
  // 讲相近内容的视频（创作辅助集成设计 §2.4）：打开视频的查看框时才算。
  const viewingRelated = useRelatedVideos(viewing, entries);
  const viewingConversationId = viewing ? entryConversationId(viewing) : null;
  const viewingConversation = viewingConversationId ? conversations.find((c) => c.id === viewingConversationId) : undefined;
  const filtered = query.trim() !== '' || projectId !== null || status !== 'any' || !!from;
  const fromName = from ? (videoNames.get(from) ?? untitled()) : null;
  // 内容命中只在视频与「全部」里找（架构设计 §5.11：内容索引只建在视频上）。
  const searchContent = query.trim() !== '' && (category === 'all' || category === 'video');

  const sourceOf = (entry: SpaceEntry) => sourceLabel(entry, dirs, untitled(), videoNames);
  const canReveal = (entry: SpaceEntry) => entryPath(entry, dirs) !== null;

  const reveal = (entry: SpaceEntry) => {
    const path = entryPath(entry, dirs);
    if (path) void runtime.host.revealPath(path);
    else ToastQueue.neutral(COPY.revealUnavailable, { timeout: 4000 });
  };

  const setTrashed = (entry: SpaceEntry, trashed: boolean) => runtime.updateSpaceEntry(entry.id, { trashed });

  // 带「撤销」的提示不会自己消失（S2 有动作的 Toast 不计时）；条目从回收站恢复后收起它，免得留一个过时的撤销。
  const undoToasts = useRef(new Map<Id, () => void>());
  const closeUndo = (id: Id) => {
    undoToasts.current.get(id)?.();
    undoToasts.current.delete(id);
  };

  const trashNow = (entry: SpaceEntry) =>
    setTrashed(entry, true)
      .then(() => {
        closeUndo(entry.id);
        const close = ToastQueue.neutral(COPY.trashed(entry.name), {
          timeout: 5000,
          actionLabel: COPY.undo,
          onAction: () => void setTrashed(entry, false).catch(failed(COPY.undo)),
          onClose: () => undoToasts.current.delete(entry.id),
          shouldCloseOnAction: true,
        });
        undoToasts.current.set(entry.id, close);
      })
      .catch(failed(COPY.trash));

  /** 删除视频（产品设计 §4.9）：由它导出、生成的条目不随视频删除；有这样的条目时先列出来确认。 */
  const trash = (entry: SpaceEntry) => {
    const videoId = entry.kind === 'video' ? videoIdOf(entry) : null;
    const related = videoId ? relatedEntries(entries, videoId) : [];
    const kids = videoId ? derivedCount(entries, videoId) : 0;
    if (related.length || kids) {
      setViewingId(null);
      setDialog({ kind: 'trash-video', entry, related, shorts: kids });
    } else void trashNow(entry);
  };

  const restore = (entry: SpaceEntry) =>
    setTrashed(entry, false)
      .then(() => {
        closeUndo(entry.id);
        ToastQueue.positive(COPY.restored(entry.name), { timeout: 4000 });
      })
      .catch(failed(COPY.restore));

  /** 彻底删除与清除失败的占位（架构设计 §5.5）：仍被引用时 Runtime 什么也不删，列出谁在用。 */
  const purgeNow = (entry: SpaceEntry) => {
    const clearing = isFailedPlaceholder(entry);
    runtime
      .purgeSpaceEntry(entry.id)
      .then((result) => {
        if (result.status === 'blocked') {
          setViewingId(null);
          setDialog({ kind: 'blocked', entry, references: result.references });
          return;
        }
        setViewingId((id) => (id === entry.id ? null : id));
        closeUndo(entry.id);
        ToastQueue.positive(clearing ? COPY.cleared(entry.name) : COPY.purged(entry.name), { timeout: 4000 });
      })
      .catch(failed(clearing ? COPY.clear : COPY.purge));
  };

  /**
   * 在会话中继续（架构设计 §5.7）：Runtime 只建会话（或回到条目原来的会话）并附上引用，不启动任务；
   * 引用随用户下一次发送一起交给智能体。
   */
  const continueIn = (entry: SpaceEntry) => {
    runtime
      .continueSpaceEntry(entry.id)
      .then(({ conversation, created }) => {
        setViewingId(null);
        go({ tab: 'home', conversationId: conversation.id, projectId: null });
        ToastQueue.positive(COPY.continued(created, entry.name, conversation.title || untitled()), { timeout: 6000 });
      })
      .catch(failed(COPY.continue));
  };

  /** 打开 `space.openForEdit` 给的视频条目：Space 里有它时按来源目录打开（与列表一致），否则按条目 id。 */
  const openEntry = (target: { entryId: Id }) => {
    const known = entries.find((e) => e.id === target.entryId);
    setViewingId(null);
    openVideo(known && known.kind === 'video' ? videoTargetOf(known) : target);
  };

  /**
   * 二次编辑（产品设计 §4.6；架构设计 §5.7「从成片回到视频」）：去哪里由 `space.openForEdit` 回答。
   * 回到来源视频：来源已经改过时先说明差异；以它为素材新建视频：新建空视频再导入这个文件放上主序列。
   */
  const edit = async (entry: SpaceEntry) => {
    let result;
    try {
      result = await runtime.openSpaceEntryForEdit(entry.id);
    } catch (error) {
      failed(COPY.openForEdit)(error as Error);
      return;
    }
    if (result.mode === 'video') return openEntry(result.target);
    if (result.mode === 'source-video') {
      const target = result.target;
      if (!target) return void ToastQueue.neutral(COPY.sourceGone, { timeout: 5000 });
      if (result.changed) {
        setViewingId(null);
        setDialog({ kind: 'source-changed', entry, result: { ...result, target } });
        return;
      }
      return openEntry(target);
    }
    const path = entryPath(entry, dirs);
    const conversationId = entry.source.conversationId;
    const scope = result.projectId ? { projectId: result.projectId } : conversationId ? { conversationId } : null;
    if (!path || !scope) {
      ToastQueue.neutral(editBlock(entry, null) ?? COPY.sourceGone, { timeout: 5000 });
      return;
    }
    // 视频与音频（有项目时）到那个项目的起始页，挂成交给 Agent 的素材，在输入框里说怎么处理（原型 space-viewer.jsx `newProject({entry: 'media', file})`）。
    if (result.projectId && mediaKindOf(path) !== 'other') {
      setViewingId(null);
      openHome(result.projectId, { materials: [path] });
      return;
    }
    const name = videoNameOf(path);
    try {
      const { target, importError } = await runtime.createVideoFromFile(scope, path, placeKindOf(entry.fileName) ?? 'video', name);
      setViewingId(null);
      openVideo(target);
      if (importError) ToastQueue.negative(COPY.createdEmpty(importError), { timeout: 8000 });
      else ToastQueue.positive(COPY.createdFromFile(name), { timeout: 4000 });
    } catch (error) {
      failed(COPY.newVideo)(error as Error);
    }
  };

  const rename = async (entry: SpaceEntry, name: string | null) => {
    await runtime.renameSpaceEntry(entry.id, name);
    ToastQueue.positive(COPY.renamed, { timeout: 3000 });
  };

  // 视频条目的转录动作（§4.4）：有没有文稿读候选，转录中 / 排队 / 上次失败从 `jobs` 推。
  const transcribed = useTranscribedEntries();
  const jobs = useJobs((s) => s.jobs);
  const transcribeAction = (entry: SpaceEntry): SpaceTranscribeAction | null => {
    if (entry.kind !== 'video' || entry.user.trashedAt || entry.status === 'generating' || entry.status === 'failed') return null;
    return spaceTranscribeAction(transcribeState(videoIdOf(entry), jobs), transcribed(entry.id), entry.status === 'missing');
  };
  /** 进转录工具页、预选这部视频；「重试转录…」带上失败的那次（预填参数、说明原因）。 */
  const openTranscribe = (entry: SpaceEntry) => {
    const failedJob = transcribeAction(entry) === 'retry' ? failedTranscribeJob(videoIdOf(entry), jobs) : null;
    const tools = useVideoTools.getState();
    tools.setPreset({ tool: 'transcribe', entryId: entry.id, ...(failedJob ? { retryJobId: failedJob.jobId } : {}) });
    tools.setView('transcribe', null);
    go({ tab: 'tools', tool: 'transcribe' });
  };

  /**
   * 幻灯片、设计稿与设计系统在做它的那条会话（项目里的在项目起始页）的功能区里开各自的标签
   * （docs/design/slides §8.1、docs/design/canvas §8.1、§10）。`videoTargetOf` 只是按来源目录与相对路径给定位，这几种目录同样适用。
   */
  const openEditorTab = (kind: EditorKind, entry: SpaceEntry) => {
    const { projectId, conversationId } = entry.source;
    if (!projectId && !conversationId) return;
    setViewingId(null);
    useShell.getState().openPane({ kind, target: videoTargetOf(entry) }, { conversationId, projectId });
  };
  const openSlides = (entry: SpaceEntry) => openEditorTab('slides', entry);
  const openDesign = (entry: SpaceEntry) => openEditorTab('design', entry);
  const openDesignSystem = (entry: SpaceEntry) => openEditorTab('design-system', entry);

  const onAction = (action: EntryAction, entry: SpaceEntry) => {
    if (action === 'open') {
      if (entry.kind === 'slides') openSlides(entry);
      else if (entry.kind === 'design') openDesign(entry);
      else if (entry.kind === 'design-system') openDesignSystem(entry);
      else openVideo(videoTargetOf(entry));
    } else if (action === 'transcribe') openTranscribe(entry);
    else if (action === 'view') setViewingId(entry.id);
    else if (action === 'info') setInfoId(entry.id);
    else if (action === 'continue') continueIn(entry);
    else if (action === 'favorite') runtime.updateSpaceEntry(entry.id, { favorite: !entry.user.favorite }).catch(failed(COPY.favorite));
    else if (action === 'rename') setDialog({ kind: 'rename', entry });
    else if (action === 'reveal') reveal(entry);
    else if (action === 'task') {
      const jobId = entryJobId(entry);
      if (jobId) go({ tab: 'tasks', taskId: jobId });
    } else if (action === 'trash') trash(entry);
    else if (action === 'restore') void restore(entry);
    else if (action === 'purge') setDialog({ kind: 'purge', entry });
    else if (action === 'clear') purgeNow(entry);
    else if (action === 'shorts') showShorts(entry);
  };

  const viewerActions: ViewerActions = {
    onFavorite: (entry) => onAction('favorite', entry),
    onReveal: reveal,
    onContinue: continueIn,
    onOpenVideo: (entry) => {
      setViewingId(null);
      openVideo(videoTargetOf(entry));
    },
    onOpenSlides: openSlides,
    onOpenDesign: openDesign,
    onOpenDesignSystem: openDesignSystem,
    onEdit: (entry) => void edit(entry),
    onOpenPackage: (entry) => {
      const path = entryPath(entry, dirs);
      const scope = packageScope(entry);
      if (!path || !scope) return;
      void openPackageAs(runtime, scope, path).then((ok) => ok && setViewingId(null));
    },
    onRename: (entry) => {
      setViewingId(null);
      setDialog({ kind: 'rename', entry });
    },
    onRestore: (entry) => void restore(entry),
    onPurge: (entry) => {
      setViewingId(null);
      setDialog({ kind: 'purge', entry });
    },
    onClear: purgeNow,
    onTask: (jobId) => go({ tab: 'tasks', taskId: jobId }),
    onConversation: (conversationId) => go({ tab: 'home', conversationId, projectId: null }),
    onSwitch: (entryId) => setViewingId(entryId),
    onShorts: showShorts,
    onClose: () => setViewingId(null),
  };

  const rebuild = () => {
    setRebuilding(true);
    runtime
      .rebuildSpaceIndex()
      .then((result) => ToastQueue.positive(COPY.rebuilt(result.entries, result.pendingVideos), { timeout: 5000 }))
      .catch(failed(COPY.rebuild))
      .finally(() => setRebuilding(false));
  };

  // 上面已有「讲话内容里」时，名称没对上只写一行；用大号的「没有符合条件的条目」会像是整个搜索都没结果。
  const named = searchContent && connected;
  const otherFilters = projectId !== null || status !== 'any' || !!from;
  const empty = () =>
    named ? (
      <p className={namesNone({ isGrid: view === 'grid' })}>{COPY.emptyNames(query.trim(), otherFilters)}</p>
    ) : (
      <IllustratedMessage size="S">
        <Heading>
          {filtered
            ? COPY.emptyFiltered
            : category === 'trash'
              ? COPY.emptyTrash
              : category === 'favorite'
                ? COPY.emptyFavorite
                : category === 'all'
                  ? COPY.emptyAll
                  : COPY.emptyCategory(label)}
        </Heading>
        <Content>{filtered ? COPY.emptyFilteredBody : category === 'trash' ? COPY.emptyTrashBody : COPY.emptyBody}</Content>
      </IllustratedMessage>
    );

  const busy = scanning || rebuilding;

  return (
    <div ref={ref} className={main}>
      <header className={bar({ isStacked, isTight })}>
        <h1 className={title}>
          {label}
          <span className={titleCount}>{rows.length}</span>
        </h1>
        <div className={barActions}>
          <SearchField
            aria-label={COPY.searchLabel}
            placeholder={COPY.searchPlaceholder}
            size="M"
            styles={search({ isStacked })}
            value={query}
            onChange={setQuery}
          />
          <NewMenu projectId={projectId} onImport={() => setDialog({ kind: 'import' })} />
        </div>
      </header>
      <div className={tools({ isTight })}>
        <div className={filters}>
          <Picker
            aria-label={COPY.projectPicker}
            size="M"
            styles={picker}
            menuWidth={240}
            value={projectId ?? 'any'}
            onChange={(key) => replace({ tab: 'space', category, projectId: key === 'any' || key === null ? null : String(key) })}>
            <PickerItem id="any" textValue={COPY.allProjects}>
              {COPY.allProjects}
            </PickerItem>
            {options.map((o) => (
              <PickerItem key={o.key} id={o.key} textValue={o.label}>
                {o.label}
              </PickerItem>
            ))}
          </Picker>
          <Picker
            aria-label={COPY.statusPicker}
            size="M"
            styles={picker}
            menuWidth={180}
            value={status}
            onChange={(key) => key && setStatus(key as SpaceStatusFilter)}>
            {SPACE_STATUS_FILTERS.map((s) => (
              <PickerItem key={s.key} id={s.key} textValue={s.label}>
                {s.label}
              </PickerItem>
            ))}
          </Picker>
          <Picker
            aria-label={COPY.sortPicker}
            size="M"
            styles={picker}
            menuWidth={180}
            value={sort}
            onChange={(key) => key && setSpaceSort(key as SpaceSort)}>
            {SPACE_SORTS.map((s) => (
              <PickerItem key={s.key} id={s.key} textValue={s.label}>
                {s.label}
              </PickerItem>
            ))}
          </Picker>
        </div>
        <div className={viewTools}>
          <MenuTrigger>
            <TooltipTrigger>
              <ActionButton aria-label={COPY.refreshMenu} isQuiet isDisabled={!connected || busy}>
                {busy ? <ProgressCircle isIndeterminate size="S" aria-label={scanning ? COPY.scanning : COPY.rebuild} /> : <Refresh />}
              </ActionButton>
              <Tooltip>{scanning ? COPY.scanning : rebuilding ? COPY.rebuild : COPY.refreshMenu}</Tooltip>
            </TooltipTrigger>
            <Menu
              aria-label={COPY.refreshMenu}
              onAction={(key) => {
                if (key === 'rescan') void runtime.rescanSpace().catch(failed(COPY.rescan));
                else if (key === 'rebuild') rebuild();
              }}>
              <MenuItem id="rescan" textValue={COPY.rescan}>
                <Text slot="label">{COPY.rescan}</Text>
                <Text slot="description">{COPY.rescanHint}</Text>
              </MenuItem>
              <MenuItem id="rebuild" textValue={COPY.rebuild}>
                <Text slot="label">{COPY.rebuild}</Text>
                <Text slot="description">{COPY.rebuildHint}</Text>
              </MenuItem>
            </Menu>
          </MenuTrigger>
          <SegmentedControl aria-label={COPY.viewPicker} selectedKey={view} onSelectionChange={(key) => setSpaceView(key as 'grid' | 'list')}>
            <SegmentedControlItem id="grid" aria-label={COPY.viewGrid}>
              <ViewGrid />
            </SegmentedControlItem>
            <SegmentedControlItem id="list" aria-label={COPY.viewList}>
              <ViewList />
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>

      {fromName ? (
        <div className={notes({ isTight })}>
          <span className={fromChip}>
            <Text>{COPY.shortsFilter(fromName)}</Text>
            <ActionButton size="S" isQuiet onPress={() => replace({ tab: 'space', category, projectId })}>
              {COPY.shortsFilterClear}
            </ActionButton>
          </span>
        </div>
      ) : null}

      {issues.length ? (
        <div className={notes({ isTight })}>
          <InlineAlert variant="notice">
            <Heading>{COPY.issuesTitle(issues.length)}</Heading>
            <Content>
              {issues.map((issue) => (
                <div key={issue.sourceKey}>
                  {issue.kind === 'truncated' ? COPY.issueTruncated(issue.detail) : COPY.issueUnreadable(issue.detail)}
                </div>
              ))}
            </Content>
          </InlineAlert>
        </div>
      ) : null}

      {searchContent && connected ? (
        <div className={notes({ isTight })}>
          <SpaceSearchHits query={query} projectId={projectId} entries={entries} />
        </div>
      ) : null}
      {named ? <h2 className={namesHead({ isTight })}>{COPY.namesTitle}</h2> : null}

      <div className={list({ isTight, isGrid: view === 'grid' })}>
        {!ready ? (
          <IllustratedMessage size="S">
            <Heading>{COPY.preparing}</Heading>
            <Content>{COPY.preparingBody}</Content>
          </IllustratedMessage>
        ) : view === 'list' ? (
          <SpaceTable
            entries={rows}
            now={now}
            sourceOf={sourceOf}
            canReveal={canReveal}
            onAction={onAction}
            transcribeAction={transcribeAction}
            empty={empty}
            shorts={shorts}
          />
        ) : (
          <SpaceGrid
            entries={rows}
            now={now}
            sourceOf={sourceOf}
            canReveal={canReveal}
            onAction={onAction}
            transcribeAction={transcribeAction}
            empty={empty}
            shorts={shorts}
          />
        )}
      </div>

      <SpaceViewer
        entry={viewing}
        source={viewing ? sourceOf(viewing) : ''}
        path={viewing ? entryPath(viewing, dirs) : null}
        conversation={viewingConversation ? { id: viewingConversation.id, title: viewingConversation.title || untitled() } : null}
        now={now}
        actions={viewerActions}
        tools={viewingTools}
        files={viewingFiles}
        host={viewingHost}
        shorts={viewingShorts}
        parent={viewingParent}
        related={viewingRelated}
      />
      <SpaceDialogs
        dialog={dialog}
        projects={importable}
        defaultProjectId={projectId}
        onClose={() => setDialog(null)}
        onRename={rename}
        onPurge={purgeNow}
        onTrashVideo={(entry) => void trashNow(entry)}
        onOpenSource={openEntry}
      />
      {info ? <SpaceVideoInfo entry={info} dirs={dirs} onClose={() => setInfoId(null)} /> : null}
    </div>
  );
}

/** 在 Space 里打开的视频：侧栏照旧，右边只有编辑器，右下角浮着悬浮会话（产品设计 §2.2 用户修订）。 */
function SpaceVideo({ video }: { video: FileTarget }) {
  // 换一个视频就是一段新的悬浮会话，没发出的草稿不跟过去。
  return <EditorWorkspace overlay={<VideoQuickChat key={JSON.stringify(video)} />} />;
}

/**
 * 「新建」（产品设计 §4 用户修订；原型 page-space.jsx 的新建菜单）：
 * - 新建空视频：不转录、不排队，立即可用；
 * - 从文件新建视频：新建空视频，导入选的文件放上主序列，再进编辑器（不自动转录：转录是另一个要排队的任务）；
 * - 从便携包新建视频：选一个 .baocut，在项目里建成新视频（`videos.importPackage`，只在桌面端）；
 * - 导入素材：登记为项目的素材，不放进任何视频（导入框里选项目）。
 * 视频是项目目录下的一个子目录：筛了项目时直接建在那里，否则先选项目。
 */
function NewMenu({ projectId, onImport }: { projectId: Id | null; onImport: () => void }) {
  const runtime = useRuntime();
  const projects = useDirectory((s) => s.projects);
  const connected = useConnection((s) => s.state.status === 'connected');
  const open = useProject(projectId);
  const owner = open && !open.archived ? open : undefined;
  // 空视频直接建（16:9）并打开（原型 page-space.jsx `newProject({entry: 'blank', dir})`）；视频、音频文件到那个项目的起始页挂成素材，
  // 在输入框里说怎么处理（加字幕、音频转视频、翻译…）。图片照旧直接建视频放上时间线。
  const createBlank = (projectId: Id) => createBlankVideo(runtime, projectId, '16:9');
  const createFromFile = async (projectId: Id) => {
    const [path] = await runtime.host.pickMediaFiles();
    if (!path) return;
    const kind = placeKindOf(path);
    if (!kind) return void ToastQueue.neutral(COPY.pickNotMedia, { timeout: 4000 });
    if (kind !== 'image' && mediaKindOf(path) !== 'other') return openHome(projectId, { materials: [path] });
    const name = videoNameOf(path);
    try {
      const { target, importError } = await runtime.createVideoFromFile({ projectId }, path, kind, name);
      useShell.getState().openVideo(target);
      if (importError) ToastQueue.negative(COPY.createdEmpty(importError), { timeout: 8000 });
      else ToastQueue.positive(COPY.createdFromFile(name), { timeout: 4000 });
    } catch (error) {
      failed(COPY.newVideo)(error as Error);
    }
  };
  // 别处导出的便携包：桌面端用系统的打开对话框选 .baocut（网页宿主没有，菜单里不列）。
  const pickFiles = runtime.host.pickFiles;
  const createFromPackage = async (projectId: Id) => {
    if (!pickFiles) return;
    const [path] = await pickFiles({
      title: COPY.pickPackageTitle,
      buttonLabel: COPY.pickPackageButton,
      filters: [{ name: COPY.pickPackageFilter, extensions: ['baocut'] }],
    });
    if (path) await openPackageAs(runtime, { projectId }, path);
  };
  const choices = projects.filter((p) => !p.archived).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

  /** 没筛项目时，「新建空视频」「从文件新建视频」「从便携包新建视频」各带一个选项目的子菜单。 */
  const projectMenu = (id: 'blank' | 'file' | 'package', Icon: ComponentType, label: string, hint: string, run: (projectId: Id) => unknown) =>
    owner ? (
      <MenuItem id={id} textValue={label}>
        <Icon />
        <Text slot="label">{label}</Text>
        <Text slot="description">{COPY.createIn(owner.name, hint)}</Text>
      </MenuItem>
    ) : (
      <SubmenuTrigger>
        <MenuItem id={id} textValue={label}>
          <Icon />
          <Text slot="label">{label}</Text>
          <Text slot="description">{hint}</Text>
        </MenuItem>
        <Menu
          aria-label={COPY.whichProjectFor(label)}
          disabledKeys={choices.length ? [] : ['none']}
          onAction={(key) => key !== 'none' && void run(String(key))}>
          <MenuSection>
            <MenuHeader>
              <MenuHeading>{COPY.whichProject}</MenuHeading>
            </MenuHeader>
            {choices.length ? (
              choices.map((p) => (
                <MenuItem key={p.id} id={p.id} textValue={p.name}>
                  <Text slot="label">{p.name}</Text>
                </MenuItem>
              ))
            ) : (
              <MenuItem id="none" textValue={COPY.noProject}>
                <Text slot="label">{COPY.noProject}</Text>
              </MenuItem>
            )}
          </MenuSection>
        </Menu>
      </SubmenuTrigger>
    );

  return (
    <MenuTrigger>
      <Button variant="accent" size="M" isDisabled={!connected}>
        <Add />
        <Text>{COPY.newLabel}</Text>
      </Button>
      <Menu
        aria-label={COPY.newLabel}
        onAction={(key) => {
          if (key === 'import') onImport();
          else if (owner && key === 'blank') void createBlank(owner.id);
          else if (owner && key === 'file') void createFromFile(owner.id);
          else if (owner && key === 'package') void createFromPackage(owner.id);
        }}>
        <MenuSection>
          {projectMenu('blank', Filmstrip, COPY.newBlank, COPY.newBlankHint, createBlank)}
          {projectMenu('file', FileAdd, COPY.newFromFile, COPY.newFromFileHint, createFromFile)}
          {pickFiles ? projectMenu('package', Archive, COPY.newFromPackage, COPY.newFromPackageHint, createFromPackage) : null}
        </MenuSection>
        <MenuSection>
          <MenuItem id="import" textValue={COPY.importAssets}>
            <Import />
            <Text slot="label">{COPY.importAssets}</Text>
            <Text slot="description">{COPY.importAssetsHint}</Text>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}
