import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { SpaceEntry, SpaceEntryKind } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  Card,
  CardPreview,
  CardView,
  Cell,
  Column,
  Content,
  Footer,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  ProgressCircle,
  Row,
  StatusLight,
  TableBody,
  TableHeader,
  TableView,
  Text,
} from '@react-spectrum/s2';
import { Pressable } from 'react-aria-components';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Archive from '@react-spectrum/s2/icons/Archive';
import Chat from '@react-spectrum/s2/icons/Chat';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Clock from '@react-spectrum/s2/icons/Clock';
import ClockPending from '@react-spectrum/s2/icons/ClockPending';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import ColorHarmony from '@react-spectrum/s2/icons/ColorHarmony';
import Delete from '@react-spectrum/s2/icons/Delete';
import DevicePhone from '@react-spectrum/s2/icons/DevicePhone';
import Edit from '@react-spectrum/s2/icons/Edit';
import ExportTo from '@react-spectrum/s2/icons/ExportTo';
import FileText from '@react-spectrum/s2/icons/FileText';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import Folder from '@react-spectrum/s2/icons/Folder';
import Image from '@react-spectrum/s2/icons/Image';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Layers from '@react-spectrum/s2/icons/Layers';
import Layout from '@react-spectrum/s2/icons/Layout';
import LinkIcon from '@react-spectrum/s2/icons/Link';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Preview from '@react-spectrum/s2/icons/Preview';
import Redo from '@react-spectrum/s2/icons/Redo';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Revert from '@react-spectrum/s2/icons/Revert';
import Shapes from '@react-spectrum/s2/icons/Shapes';
import Star from '@react-spectrum/s2/icons/Star';
import StarFilled from '@react-spectrum/s2/icons/StarFilled';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import Template from '@react-spectrum/s2/icons/Template';
import TextParagraph from '@react-spectrum/s2/icons/TextParagraph';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { M as SEMANTIC } from '../../model/semantic-copy.ts';
import { continueBlock, entryJobId, entryMenuKey, inIndexFolder, isFailedPlaceholder, purgeBlock } from '../../model/space-actions.ts';
import {
  filesAttention,
  filesSummary,
  formatBytes,
  hitsText,
  KIND_LABEL,
  measureText,
  SPACE_STATUS,
  statusText,
  type SpaceRow,
} from '../../model/space.ts';
import { entryIndexTitle, type EntryIndexKey, type EntryIndexState } from '../../model/space-index.ts';
import type { SpaceTranscribeAction } from '../../model/tool-targets.ts';
import { useEntryThumbnail } from '../use-entry-thumbnail.ts';
import { SPACE_COPY as COPY } from './space-copy.ts';

/**
 * Space 的列表区（产品设计 §4.3–§4.4；原型 space-list.jsx）：网格是 CardView，列表是 TableView（名称、类型、来源、
 * 时长或尺寸、状态、最近活动）。两者都虚拟化，高度由外框给。这里只画；动作交给页面。
 * 卡片与名称列都先放缩略图（§4.3），列表的行高因此用 spacious 密度。
 * 「全部」与「视频」里一部视频只有一行（model/space.ts `groupEntries`）：它导出、生成的文件收在卡片的「N 个文件」与
 * 名称下面那行里；视频自己没有状态时，状态替这些文件里最该被看见的那个说话。
 */

export type EntryAction =
  | 'open'
  | 'view'
  | 'info'
  | 'continue'
  | 'transcribe'
  | 'favorite'
  | 'rename'
  | 'reveal'
  | 'task'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'clear'
  /** 按来源筛出从这部视频切出的短视频（卡片与行上的「N 支短视频」）。 */
  | 'shorts'
  /** 语义索引（检索规格 §9.1）：丢掉这一条的索引排到最前重建；设为不索引；把设了不索引的恢复。 */
  | 'reindex'
  | 'noindex'
  | 'include';

export const KIND_ICON: Record<SpaceEntryKind, ComponentType> = {
  video: Filmstrip,
  export: ExportTo,
  'video-file': Video,
  image: Image,
  audio: MusicNote,
  subtitle: CloseCaptions,
  document: FileText,
  package: Archive,
  template: Template,
};

const thumb = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'full',
  aspectRatio: 'video',
  backgroundColor: 'gray-100',
  color: 'gray-600',
  overflow: 'hidden',
});
/** 列表行里的缩略图（原型 sp-prev--small）：spacious 行高 48，缩略图取控件高度 32、16:9，上下各留 8。 */
const thumbSmall = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  height: 32,
  aspectRatio: 'video',
  borderRadius: 'sm',
  backgroundColor: 'gray-100',
  color: { default: 'gray-600', isMissing: 'gray-400' },
  overflow: 'hidden',
});
const thumbImage = style({ width: 'full', height: 'full', objectFit: 'cover', display: 'block' });
/** 文档与字幕：正文摘要印在一张纸上（原型 sp-prev--document）；列表行里只留纸面和类型图标。 */
const docBack = style({
  position: 'relative',
  width: 'full',
  aspectRatio: 'video',
  boxSizing: 'border-box',
  paddingTop: 16,
  paddingX: 20,
  backgroundColor: 'gray-75',
  overflow: 'hidden',
});
const docBackSmall = style({
  flexShrink: 0,
  height: 32,
  aspectRatio: 'video',
  boxSizing: 'border-box',
  paddingTop: 4,
  paddingX: '[6px]',
  borderRadius: 'sm',
  backgroundColor: 'gray-75',
  overflow: 'hidden',
});
const docPaper = style({
  height: 'full',
  boxSizing: 'border-box',
  padding: 16,
  borderTopRadius: 'default',
  backgroundColor: 'gray-25',
  boxShadow: 'elevated',
  overflow: 'hidden',
});
const docPaperSmall = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 'full',
  backgroundColor: 'gray-25',
  color: 'gray-600',
});
const docText = style({
  font: 'ui-sm',
  lineHeight: 'body',
  color: 'gray-700',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: 0,
});
const docType = style({
  position: 'absolute',
  insetEnd: 8,
  bottom: 8,
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-25',
  font: 'ui-sm',
  color: 'gray-700',
});
const missingFlag = style({
  position: 'absolute',
  insetStart: 8,
  bottom: 8,
  paddingX: '[6px]',
  paddingY: 2,
  borderRadius: 'sm',
  backgroundColor: 'red-900',
  font: 'ui-xs',
  color: 'gray-25',
});
const muted = style({ font: 'ui-sm', color: 'gray-600' });
const nameCell = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const nameText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const nameBody = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const nameSub = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 卡片底栏：状态在左，「N 个文件」推到右边（原型 sp-files）。 */
const filesButton = style({ marginStart: 'auto' });
const visuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: '[inset(50%)]',
  whiteSpace: 'nowrap',
});
const favMark = style({ display: 'flex', color: 'yellow-800', flexShrink: 0 });

/** 语义索引的标志（原型 space-list.jsx `IndexMark`、space.css `.sp-idx`）：图标按状态着色，在建时转圈。 */
const indexMark = style({
  display: 'inline-flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: 4,
  color: { default: 'gray-600', tone: { notice: 'orange-900', negative: 'red-900', informative: 'blue-900' } },
});
const indexMarkText = style({ font: 'ui-sm', color: 'gray-800' });
/** 右键菜单的锚点：指针那一点，0 尺寸，不挡点击（同时间轴的右键菜单）。 */
const contextAnchor = style({ position: 'fixed', width: 0, height: 0, pointerEvents: 'none', outlineStyle: 'none' });
const contextScope = style({ display: 'contents' });

const INDEX_ICON: Record<Exclude<EntryIndexKey, 'indexing'>, ComponentType> = {
  failed: AlertTriangle,
  stale: Refresh,
  queued: ClockPending,
  indexed: CheckmarkCircle,
  empty: InfoCircle,
  notNeeded: LinkIcon,
  excluded: StopProcessing,
};

/**
 * 查看框里的语义索引状态：图标 + 悬停说明；`withText` 时后面跟状态文字。
 */
export function IndexMark({ state, withText }: { state: EntryIndexState | null; withText?: boolean }) {
  if (!state || (!withText && state.key === 'empty')) return null;
  const title = entryIndexTitle(state);
  const Icon = state.key === 'indexing' ? null : INDEX_ICON[state.key];
  const label = state.pct !== null ? SEMANTIC.spaceIndex.withPct(state.label, state.pct) : state.label;
  return (
    <span className={indexMark({ tone: state.tone })} title={title} role="img" aria-label={title}>
      {Icon ? <Icon /> : <ProgressCircle size="S" isIndeterminate aria-label={state.label} />}
      {withText ? (
        <span className={indexMarkText} aria-hidden>
          {label}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 预览块（原型 ItemPreview）：画面铺满；文档与字幕是纸上的正文摘要；没有的画类型图标，缺失的加「找不到文件」。
 * `small` 是列表名称列里的那一档：名字就在旁边，整块对读屏隐藏；文档只留纸面和类型图标；缺失只靠灰底，文字由 aria-label 说。
 */
export function EntryThumb({ entry, small }: { entry: SpaceEntry; small?: boolean }) {
  const thumbnail = useEntryThumbnail(entry);
  const missing = entry.status === 'missing';
  const Icon = KIND_ICON[entry.kind];
  // 列表那一档的类型图标是 workflow 图标，走全局的 16px；网格卡片的是类型预览，保留 S2 原生画布（产品设计 §2.1）。
  const icons = small ? undefined : 'own';
  if (thumbnail?.kind === 'image') {
    return (
      <div className={small ? thumbSmall({}) : thumb} aria-hidden={small || undefined}>
        <img className={thumbImage} src={thumbnail.url} alt="" decoding="async" />
      </div>
    );
  }
  if (thumbnail?.kind === 'text') {
    return small ? (
      <div className={docBackSmall} data-bc-icons={icons} aria-hidden>
        <div className={docPaperSmall}>
          <Icon />
        </div>
      </div>
    ) : (
      <div className={docBack}>
        <div className={docPaper} aria-hidden>
          <p className={docText}>{thumbnail.excerpt}</p>
        </div>
        <span className={docType}>{KIND_LABEL[entry.kind]}</span>
      </div>
    );
  }
  if (small) {
    const a11y = missing ? { role: 'img', 'aria-label': COPY.missingFile } : { 'aria-hidden': true };
    return (
      <div className={thumbSmall({ isMissing: missing })} data-bc-icons={icons} {...a11y}>
        <Icon />
      </div>
    );
  }
  return (
    <div className={thumb} data-bc-icons={icons}>
      <Icon />
      {missing ? <span className={missingFlag}>{COPY.missingFile}</span> : null}
    </div>
  );
}

/** 最近活动：收了文件的视频取它和文件里最近的一次。 */
const activityOf = (row: SpaceRow) => row.activityAt ?? row.lastActivityAt;

/**
 * 状态：灯 + 字（原型 ItemStatus）。视频自己没有状态时看名下的文件（`filesAttention`）；都没有时列表里写一道横线，
 * 卡片上写最近活动（`quiet`）。
 */
function EntryStatus({ entry, now, quiet }: { entry: SpaceRow; now: number; quiet?: boolean }) {
  const text = statusText(entry);
  const files = entry.status ? null : filesAttention(entry);
  if (files) {
    return (
      <StatusLight size="S" variant={SPACE_STATUS[files.status].tone}>
        {files.text}
      </StatusLight>
    );
  }
  if (!entry.status || !text) return <span className={muted}>{quiet ? agoLabel(activityOf(entry), now) : COPY.noValue}</span>;
  return (
    <StatusLight size="S" variant={SPACE_STATUS[entry.status].tone}>
      {text}
    </StatusLight>
  );
}

/** 卡片上的「N 个文件」：点开是这部视频的查看框，文件逐个列在里面（原型 FilesButton）。 */
function FilesButton({ row, onAction }: { row: SpaceRow; onAction: (action: EntryAction, entry: SpaceEntry) => void }) {
  const n = row.files?.length ?? 0;
  if (!n) return null;
  return (
    <ActionButton size="S" isQuiet styles={filesButton} aria-label={COPY.filesButtonLabel(n, filesSummary(row))} onPress={() => onAction('view', row)}>
      <Layers />
      <Text>{COPY.filesButton(n)}</Text>
    </ActionButton>
  );
}

/** 父视频卡片上的「N 支短视频」（产品设计 §5.10）：点一下按来源筛出它们。 */
function ShortsButton({ row, count, onAction }: { row: SpaceRow; count: number; onAction: (action: EntryAction, entry: SpaceEntry) => void }) {
  if (!count) return null;
  return (
    <ActionButton size="S" isQuiet aria-label={COPY.shortsView} onPress={() => onAction('shorts', row)}>
      <DevicePhone />
      <Text>{COPY.shortsCount(count)}</Text>
    </ActionButton>
  );
}

/**
 * 条目的 ⋯ 菜单（原型 itemMenu，卡片与行共用）：视频是「打开视频」「查看信息」（查看框）与
 * 「视频详情…」（原型项目卡菜单的详情框，与编辑器顶栏 ⓘ 同一个框）；其余是「查看」；回收站里的是恢复与彻底删除，
 * 失败的生成占位只能清除。做不了的项置灰（原因在查看框里写明）。
 */
/**
 * 视频条目的「转录… / 重新转录… / 重试转录…」（产品设计 §4.4，原型 space-list.jsx `transcribeItem`）：进转录工具页、预选这部视频。
 * 重试排在最前（打开视频之前），另外两种跟在查看信息之后。
 */
function transcribeItem(action: SpaceTranscribeAction) {
  const label = COPY.transcribe[action];
  return (
    <MenuItem id="transcribe" textValue={label.replace('…', '')}>
      <Redo />
      <Text>{label}</Text>
    </MenuItem>
  );
}

/** 菜单要的、不在条目上的东西（卡片、行与右键菜单共用）。 */
interface MenuContext {
  canReveal: boolean;
  transcribe: SpaceTranscribeAction | null;
  /** 这一条的语义索引状态；不标时 null。 */
  index: EntryIndexState | null;
  /** 能不能在这里改索引（Electron；Web 只看标志，同设置页）。 */
  indexActions: boolean;
}

/** 语义索引的几项（原型 menuItems 的 reindex / noindex / include）：能做哪项给哪项。 */
function indexItems(index: EntryIndexState | null) {
  const S = SEMANTIC.spaceIndex;
  if (!index) return [];
  const items: ReactNode[] = [];
  if (index.canReindex) {
    items.push(
      <MenuItem key="reindex" id="reindex" textValue={S.reindex}>
        <Refresh />
        <Text slot="label">{S.reindex}</Text>
        <Text slot="description">{index.key === 'failed' ? S.retryDesc : S.reindexDesc}</Text>
      </MenuItem>,
    );
  }
  if (index.canExclude) {
    items.push(
      <MenuItem key="noindex" id="noindex" textValue={S.noIndex}>
        <StopProcessing />
        <Text slot="label">{S.noIndex}</Text>
        <Text slot="description">{S.noIndexDesc}</Text>
      </MenuItem>,
    );
  }
  if (index.canInclude) {
    items.push(
      <MenuItem key="include" id="include" textValue={S.include}>
        <Refresh />
        <Text slot="label">{S.include}</Text>
        <Text slot="description">{S.includeDesc}</Text>
      </MenuItem>,
    );
  }
  return items;
}

/** 菜单的各节与置灰的项（⋯ 与右键共用一份）。 */
function entryMenuParts(entry: SpaceRow, ctx: MenuContext): { disabled: EntryAction[]; sections: ReactNode } {
  const trashed = entry.user.trashedAt !== null;
  const failed = isFailedPlaceholder(entry);
  const jobId = entryJobId(entry);
  // 索引文件夹里的只读（检索规格 §9.1）：BaoCut 视频不打开编辑，条目不进回收站。
  const readOnly = inIndexFolder(entry);
  const isVideo = entry.kind === 'video' && !trashed && !readOnly;
  const openLabel = COPY.openVideo;
  const viewLabel = isVideo ? (entry.files?.length ? COPY.viewInfoFiles : COPY.viewInfo) : COPY.view;
  const transcribe = ctx.transcribe;
  const disabled: EntryAction[] = [];
  if (!ctx.canReveal) disabled.push('reveal');
  if (continueBlock(entry)) disabled.push('continue');
  if (trashed && purgeBlock(entry)) disabled.push('purge');
  const index = ctx.indexActions && !trashed ? indexItems(ctx.index) : [];
  const sections = (
    <>
      <MenuSection>
        {isVideo && transcribe === 'retry' ? transcribeItem(transcribe) : null}
        {isVideo ? (
          <MenuItem id="open" textValue={openLabel}>
            <OpenIn />
            <Text>{openLabel}</Text>
          </MenuItem>
        ) : null}
        <MenuItem id="view" textValue={viewLabel}>
          <Preview />
          <Text>{viewLabel}</Text>
        </MenuItem>
        {isVideo ? (
          <MenuItem id="info" textValue={COPY.info}>
            <InfoCircle />
            <Text>{COPY.info}</Text>
          </MenuItem>
        ) : null}
        {isVideo && transcribe && transcribe !== 'retry' ? transcribeItem(transcribe) : null}
        {trashed ? null : (
          <MenuItem id="continue" textValue={COPY.continue}>
            <Chat />
            <Text>{COPY.continue}</Text>
          </MenuItem>
        )}
      </MenuSection>
      {index.length ? <MenuSection>{index}</MenuSection> : null}
      <MenuSection>
        <MenuItem id="favorite" textValue={entry.user.favorite ? COPY.unfavorite : COPY.favorite}>
          {entry.user.favorite ? <StarFilled /> : <Star />}
          <Text>{entry.user.favorite ? COPY.unfavorite : COPY.favorite}</Text>
        </MenuItem>
        {failed ? null : (
          <MenuItem id="rename" textValue={COPY.rename}>
            <Edit />
            <Text>{COPY.rename}</Text>
          </MenuItem>
        )}
        <MenuItem id="reveal" textValue={COPY.reveal}>
          <Folder />
          <Text>{COPY.reveal}</Text>
        </MenuItem>
        {jobId ? (
          <MenuItem id="task" textValue={COPY.viewTask}>
            <Clock />
            <Text>{COPY.viewTask}</Text>
          </MenuItem>
        ) : null}
      </MenuSection>
      <MenuSection>
        {trashed ? (
          <>
            <MenuItem id="restore" textValue={COPY.restore}>
              <Revert />
              <Text>{COPY.restore}</Text>
            </MenuItem>
            <MenuItem id="purge" textValue={COPY.purge}>
              <Delete />
              <Text>{COPY.purge}</Text>
            </MenuItem>
          </>
        ) : failed ? (
          <MenuItem id="clear" textValue={COPY.clear}>
            <Delete />
            <Text>{COPY.clear}</Text>
          </MenuItem>
        ) : readOnly ? null : (
          <MenuItem id="trash" textValue={COPY.trash}>
            <Delete />
            <Text>{COPY.trash}</Text>
          </MenuItem>
        )}
      </MenuSection>
    </>
  );
  return { disabled, sections };
}

function entryMenu(entry: SpaceRow, ctx: MenuContext, onAction: (action: EntryAction, entry: SpaceEntry) => void) {
  const { disabled, sections } = entryMenuParts(entry, ctx);
  return (
    <ActionMenu
      aria-label={COPY.entryActions(entry.name)}
      isQuiet
      size="S"
      disabledKeys={disabled}
      onAction={(key) => onAction(key as EntryAction, entry)}>
      {sections}
    </ActionMenu>
  );
}

/** 卡片说明与「时长或尺寸」一列：有媒体信息时写时长与尺寸，没有时写文件大小。 */
function measureOf(entry: SpaceEntry): string {
  return measureText(entry) ?? (entry.size > 0 ? formatBytes(entry.size) : '');
}

/** 行与卡片的默认动作：视频打开编辑器，其余打开查看框（原型 onAction）。 */
const primaryAction = (entry: SpaceEntry): EntryAction =>
  entry.kind === 'video' &&
  !entry.user.trashedAt &&
  !inIndexFolder(entry)
    ? 'open'
    : 'view';

interface ListProps {
  entries: SpaceRow[];
  now: number;
  sourceOf: (entry: SpaceEntry) => string;
  /** 条目在磁盘上有没有能在文件夹中显示的路径。 */
  canReveal: (entry: SpaceEntry) => boolean;
  onAction: (action: EntryAction, entry: SpaceEntry) => void;
  /** 视频条目菜单里给哪个转录动作；不给时 null（转录中、源文件缺失、还不知道有没有文稿）。 */
  transcribeAction: (entry: SpaceEntry) => SpaceTranscribeAction | null;
  empty: () => ReactNode;
  /** 父视频派生出的子视频数（`derivedCount`，按 videoId）；不给时不显示。 */
  shorts?: ReadonlyMap<string, number>;
  /** 条目的语义索引标志（`useEntryIndex`）；不给时不标。 */
  indexOf?: (entry: SpaceEntry) => EntryIndexState | null;
  /** 索引状态变了就变（缓存的依赖键）。 */
  indexKey?: string;
  /** 菜单里给不给改索引的几项（Electron；Web 只看标志）。 */
  indexActions?: boolean;
}

const listStyles = style({ flexGrow: 1, minHeight: 0 });

/**
 * 集合的 `dependencies` 与稳定的菜单回调：CardView / TableBody 按条目对象缓存每项的渲染。后到的候选、`jobs`、保存位置、
 * 来源列和 `now` 不经 `entries` 传进来，得靠依赖键让缓存失效（`entryMenuKey`，内容变了才变）。缓存住的菜单回调也会过时，
 * 所以菜单拿一个身份不变、调用时转给最新 `onAction` 的函数。
 */
function useListDeps(props: ListProps, sourceOf?: ListProps['sourceOf']) {
  const { entries, now, canReveal, onAction, transcribeAction, shorts, indexOf, indexKey, indexActions } = props;
  const latest = useRef(onAction);
  useLayoutEffect(() => {
    latest.current = onAction;
  });
  const act = useCallback((action: EntryAction, entry: SpaceEntry) => latest.current(action, entry), []);
  const ctxOf = (entry: SpaceEntry): MenuContext => ({
    canReveal: canReveal(entry),
    transcribe: transcribeAction(entry),
    index: indexOf?.(entry) ?? null,
    indexActions: !!indexActions,
  });
  return { act, ctxOf, dependencies: [entryMenuKey(entries, canReveal, transcribeAction, sourceOf), now, shorts, indexKey, indexActions] };
}

interface ContextTarget {
  entry: SpaceRow;
  x: number;
  y: number;
}

/**
 * 列表区上的右键与菜单键（原型 `contextHandlers` / `SpaceContextMenu`）：找到指针或焦点所在的条目（React Aria 在行与卡片上
 * 写 data-key），在指针那一点（菜单键与 ⇧F10 在条目左上角）弹出和 ⋯ 同一份菜单。弹出层里的右键（菜单项也有 data-key）
 * 经 React 冒泡上来时不在列表区的 DOM 里，不理。
 */
function useEntryContextMenu(
  entries: SpaceRow[],
  ctxOf: (entry: SpaceEntry) => MenuContext,
  act: (action: EntryAction, entry: SpaceEntry) => void,
) {
  const [target, setTarget] = useState<ContextTarget | null>(null);
  const find = (scope: Element, el: Element | null) => {
    const row = el?.closest('[data-key]');
    if (!row || !scope.contains(row)) return null;
    const entry = entries.find((e) => e.id === row.getAttribute('data-key'));
    return entry ? { entry, row } : null;
  };
  const scopeProps = {
    className: contextScope,
    onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
      const hit = find(event.currentTarget, event.target as Element);
      if (!hit) return;
      event.preventDefault();
      setTarget({ entry: hit.entry, x: event.clientX, y: event.clientY });
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return;
      const hit = find(event.currentTarget, document.activeElement);
      if (!hit) return;
      event.preventDefault();
      const rect = hit.row.getBoundingClientRect();
      setTarget({ entry: hit.entry, x: rect.left + 16, y: rect.top + 16 });
    },
  };
  const menu = <EntryContextMenu target={target} ctxOf={ctxOf} onAction={act} onClose={() => setTarget(null)} />;
  return { scopeProps, menu };
}

function EntryContextMenu({
  target,
  ctxOf,
  onAction,
  onClose,
}: {
  target: ContextTarget | null;
  ctxOf: (entry: SpaceEntry) => MenuContext;
  onAction: (action: EntryAction, entry: SpaceEntry) => void;
  onClose: () => void;
}) {
  // 关上时的淡出还要画上一次的内容。
  const last = useRef<ContextTarget | null>(null);
  if (target) last.current = target;
  const at = last.current;
  if (!at) return null;
  const { disabled, sections } = entryMenuParts(at.entry, ctxOf(at.entry));
  const label = COPY.entryActions(at.entry.name);
  return (
    <MenuTrigger
      trigger="contextMenu"
      isOpen={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <Pressable>
        <span role="button" tabIndex={-1} aria-label={label} className={contextAnchor} style={{ left: at.x, top: at.y }} />
      </Pressable>
      <Menu
        aria-label={label}
        disabledKeys={disabled}
        onAction={(key) => {
          onClose();
          onAction(key as EntryAction, at.entry);
        }}>
        {sections}
      </Menu>
    </MenuTrigger>
  );
}

export function SpaceGrid(props: ListProps) {
  const { entries, now, onAction, empty, shorts } = props;
  const { act, ctxOf, dependencies } = useListDeps(props);
  const { scopeProps, menu } = useEntryContextMenu(entries, ctxOf, act);
  return (
    <div {...scopeProps}>
      <CardView
        aria-label={COPY.entriesLabel}
        layout="grid"
        size="M"
        variant="tertiary"
        items={entries}
        dependencies={dependencies}
        styles={listStyles}
        renderEmptyState={empty}
        onAction={(key) => {
          const entry = entries.find((e) => e.id === key);
          if (entry) onAction(primaryAction(entry), entry);
        }}>
        {(entry) => (
          <Card id={entry.id} textValue={entry.name}>
            <CardPreview>
              <EntryThumb entry={entry} />
            </CardPreview>
            <Content>
              <Text slot="title">{entry.name}</Text>
              {entryMenu(entry, ctxOf(entry), act)}
              <Text slot="description">{hitsText(entry) ?? [KIND_LABEL[entry.kind], measureOf(entry)].filter(Boolean).join(' · ')}</Text>
            </Content>
            <Footer>
              <EntryStatus entry={entry} now={now} quiet />
              {entry.user.favorite ? (
                <span className={favMark} aria-label={COPY.favorited}>
                  <StarFilled />
                </span>
              ) : null}
              <ShortsButton row={entry} count={shortsOf(shorts, entry)} onAction={act} />
              <FilesButton row={entry} onAction={act} />
            </Footer>
          </Card>
        )}
      </CardView>
      {menu}
    </div>
  );
}

/** 视频条目派生出的子视频数。 */
function shortsOf(shorts: ListProps['shorts'], entry: SpaceEntry): number {
  return shorts && entry.ref && 'videoId' in entry.ref ? (shorts.get(entry.ref.videoId) ?? 0) : 0;
}

/** 表格的列；列名在渲染时按当前语言取（`columnName`）。 */
const COLUMNS = [
  { id: 'name', isRowHeader: true, minWidth: 280 }, // 缩略图比原来的类型图标宽约 40，名字至少留出原来的宽度
  { id: 'kind', width: 88 },
  { id: 'source', minWidth: 180 },
  { id: 'size', width: 168 },
  { id: 'status', width: 144 },
  { id: 'activity', width: 112 },
  { id: 'menu', width: 64, hideHeader: true },
] as const;
type ColumnId = (typeof COLUMNS)[number]['id'];

function columnName(id: ColumnId): string {
  if (id === 'name') return COPY.columnName;
  if (id === 'kind') return COPY.columnKind;
  if (id === 'source') return COPY.columnSource;
  if (id === 'size') return COPY.columnMeasure;
  if (id === 'status') return COPY.columnStatus;
  if (id === 'activity') return COPY.columnActivity;
  return COPY.columnMenu;
}

export function SpaceTable(props: ListProps) {
  const { entries, now, sourceOf, onAction, empty, shorts } = props;
  const { act, ctxOf, dependencies } = useListDeps(props, sourceOf);
  const { scopeProps, menu } = useEntryContextMenu(entries, ctxOf, act);
  const cell = (entry: SpaceRow, column: ColumnId): ReactNode => {
    if (column === 'name') {
      // 收了文件的视频：名字下面一行写「N 个文件 · 成片 2 · 字幕 1」，只靠文件对上搜索时写找到的是哪个
      const n = entry.files?.length ?? 0;
      const kids = shortsOf(shorts, entry);
      const sub =
        hitsText(entry) ?? ([n ? COPY.filesLine(n, filesSummary(entry)) : null, kids ? COPY.shortsCount(kids) : null].filter(Boolean).join(' · ') || null);
      return (
        <span className={nameCell}>
          <EntryThumb entry={entry} small />
          <span className={nameBody}>
            <span className={nameText}>{entry.name}</span>
            {sub ? <span className={nameSub}>{sub}</span> : null}
          </span>
          {entry.user.favorite ? (
            <span className={favMark} aria-label={COPY.favorited}>
              <StarFilled />
            </span>
          ) : null}
        </span>
      );
    }
    if (column === 'kind') return KIND_LABEL[entry.kind];
    if (column === 'source') return sourceOf(entry);
    if (column === 'size') return measureOf(entry) || <span className={muted}>{COPY.noValue}</span>;
    if (column === 'status') return <EntryStatus entry={entry} now={now} />;
    if (column === 'activity') return agoLabel(activityOf(entry), now);
    return entryMenu(entry, ctxOf(entry), act);
  };
  return (
    <div {...scopeProps}>
      <TableView
        aria-label={COPY.entriesLabel}
        overflowMode="truncate"
        density="spacious"
        styles={listStyles}
        onAction={(key) => {
          const entry = entries.find((e) => e.id === key);
          if (entry) onAction(primaryAction(entry), entry);
        }}>
        <TableHeader columns={COLUMNS}>
          {(column) => (
            <Column
              id={column.id}
              isRowHeader={'isRowHeader' in column}
              width={'width' in column ? column.width : undefined}
              minWidth={'minWidth' in column ? column.minWidth : undefined}>
              {'hideHeader' in column ? <span className={visuallyHidden}>{columnName(column.id)}</span> : columnName(column.id)}
            </Column>
          )}
        </TableHeader>
        <TableBody items={entries} dependencies={dependencies} renderEmptyState={empty}>
          {(entry) => (
            <Row id={entry.id} columns={COLUMNS}>
              {(column) => <Cell>{cell(entry, column.id)}</Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
      {menu}
    </div>
  );
}
