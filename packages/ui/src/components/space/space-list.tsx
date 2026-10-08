import { useCallback, useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react';
import type { SpaceEntry, SpaceEntryKind } from '@baocut/protocol';
import {
  ActionMenu,
  Card,
  CardPreview,
  CardView,
  Cell,
  Column,
  Content,
  Footer,
  MenuItem,
  MenuSection,
  Row,
  StatusLight,
  TableBody,
  TableHeader,
  TableView,
  Text,
} from '@react-spectrum/s2';
import Archive from '@react-spectrum/s2/icons/Archive';
import Chat from '@react-spectrum/s2/icons/Chat';
import Clock from '@react-spectrum/s2/icons/Clock';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import ExportTo from '@react-spectrum/s2/icons/ExportTo';
import FileText from '@react-spectrum/s2/icons/FileText';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import Folder from '@react-spectrum/s2/icons/Folder';
import Image from '@react-spectrum/s2/icons/Image';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Preview from '@react-spectrum/s2/icons/Preview';
import Redo from '@react-spectrum/s2/icons/Redo';
import Revert from '@react-spectrum/s2/icons/Revert';
import Star from '@react-spectrum/s2/icons/Star';
import StarFilled from '@react-spectrum/s2/icons/StarFilled';
import Template from '@react-spectrum/s2/icons/Template';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { continueBlock, entryJobId, entryMenuKey, isFailedPlaceholder, purgeBlock } from '../../model/space-actions.ts';
import { formatBytes, KIND_LABEL, measureText, SPACE_STATUS, statusText } from '../../model/space.ts';
import type { SpaceTranscribeAction } from '../../model/tool-targets.ts';
import { useEntryThumbnail } from '../use-entry-thumbnail.ts';
import { SPACE_COPY as COPY } from './space-copy.ts';

/**
 * Space 的列表区（产品设计 §4.3–§4.4；原型 space-list.jsx）：网格是 CardView，列表是 TableView（名称、类型、来源、
 * 时长或尺寸、状态、最近活动）。两者都虚拟化，高度由外框给。这里只画；动作交给页面。
 * 卡片与名称列都先放缩略图（§4.3），列表的行高因此用 spacious 密度。
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
  | 'clear';

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
const visuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: '[inset(50%)]',
  whiteSpace: 'nowrap',
});
const favMark = style({ display: 'flex', color: 'yellow-800', flexShrink: 0 });

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

/** 状态：灯 + 字（原型 ItemStatus）。没有状态时列表里写一道横线，卡片上写最近活动（`quiet`）。 */
function EntryStatus({ entry, now, quiet }: { entry: SpaceEntry; now: number; quiet?: boolean }) {
  const text = statusText(entry);
  if (!entry.status || !text) return <span className={muted}>{quiet ? agoLabel(entry.lastActivityAt, now) : COPY.noValue}</span>;
  return (
    <StatusLight size="S" variant={SPACE_STATUS[entry.status].tone}>
      {text}
    </StatusLight>
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

function entryMenu(
  entry: SpaceEntry,
  canReveal: boolean,
  onAction: (action: EntryAction, entry: SpaceEntry) => void,
  transcribe: SpaceTranscribeAction | null,
) {
  const trashed = entry.user.trashedAt !== null;
  const failed = isFailedPlaceholder(entry);
  const jobId = entryJobId(entry);
  const isVideo = entry.kind === 'video' && !trashed;
  const disabled: EntryAction[] = [];
  if (!canReveal) disabled.push('reveal');
  if (continueBlock(entry)) disabled.push('continue');
  if (trashed && purgeBlock(entry)) disabled.push('purge');
  return (
    <ActionMenu
      aria-label={COPY.entryActions(entry.name)}
      isQuiet
      size="S"
      disabledKeys={disabled}
      onAction={(key) => onAction(key as EntryAction, entry)}>
      <MenuSection>
        {isVideo && transcribe === 'retry' ? transcribeItem(transcribe) : null}
        {isVideo ? (
          <MenuItem id="open" textValue={COPY.openVideo}>
            <OpenIn />
            <Text>{COPY.openVideo}</Text>
          </MenuItem>
        ) : null}
        <MenuItem id="view" textValue={isVideo ? COPY.viewInfo : COPY.view}>
          <Preview />
          <Text>{isVideo ? COPY.viewInfo : COPY.view}</Text>
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
        ) : (
          <MenuItem id="trash" textValue={COPY.trash}>
            <Delete />
            <Text>{COPY.trash}</Text>
          </MenuItem>
        )}
      </MenuSection>
    </ActionMenu>
  );
}

/** 卡片说明与「时长或尺寸」一列：有媒体信息时写时长与尺寸，没有时写文件大小。 */
function measureOf(entry: SpaceEntry): string {
  return measureText(entry) ?? (entry.size > 0 ? formatBytes(entry.size) : '');
}

/** 行与卡片的默认动作：视频打开编辑器，其余打开查看框（原型 onAction）。 */
const primaryAction = (entry: SpaceEntry): EntryAction => (entry.kind === 'video' && !entry.user.trashedAt ? 'open' : 'view');

interface ListProps {
  entries: SpaceEntry[];
  now: number;
  sourceOf: (entry: SpaceEntry) => string;
  /** 条目在磁盘上有没有能在文件夹中显示的路径。 */
  canReveal: (entry: SpaceEntry) => boolean;
  onAction: (action: EntryAction, entry: SpaceEntry) => void;
  /** 视频条目菜单里给哪个转录动作；不给时 null（转录中、源文件缺失、还不知道有没有文稿）。 */
  transcribeAction: (entry: SpaceEntry) => SpaceTranscribeAction | null;
  empty: () => ReactNode;
}

const listStyles = style({ flexGrow: 1, minHeight: 0 });

/**
 * 集合的 `dependencies` 与稳定的菜单回调：CardView / TableBody 按条目对象缓存每项的渲染。后到的候选、`jobs`、保存位置、
 * 来源列和 `now` 不经 `entries` 传进来，得靠依赖键让缓存失效（`entryMenuKey`，内容变了才变）。缓存住的菜单回调也会过时，
 * 所以菜单拿一个身份不变、调用时转给最新 `onAction` 的函数。
 */
function useListDeps({ entries, now, canReveal, onAction, transcribeAction }: ListProps, sourceOf?: ListProps['sourceOf']) {
  const latest = useRef(onAction);
  useLayoutEffect(() => {
    latest.current = onAction;
  });
  const act = useCallback((action: EntryAction, entry: SpaceEntry) => latest.current(action, entry), []);
  return { act, dependencies: [entryMenuKey(entries, canReveal, transcribeAction, sourceOf), now] };
}

export function SpaceGrid(props: ListProps) {
  const { entries, now, canReveal, onAction, transcribeAction, empty } = props;
  const { act, dependencies } = useListDeps(props);
  return (
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
            {entryMenu(entry, canReveal(entry), act, transcribeAction(entry))}
            <Text slot="description">{[KIND_LABEL[entry.kind], measureOf(entry)].filter(Boolean).join(' · ')}</Text>
          </Content>
          <Footer>
            <EntryStatus entry={entry} now={now} quiet />
            {entry.user.favorite ? (
              <span className={favMark} aria-label={COPY.favorited}>
                <StarFilled />
              </span>
            ) : null}
          </Footer>
        </Card>
      )}
    </CardView>
  );
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
  const { entries, now, sourceOf, canReveal, onAction, transcribeAction, empty } = props;
  const { act, dependencies } = useListDeps(props, sourceOf);
  const cell = (entry: SpaceEntry, column: ColumnId): ReactNode => {
    if (column === 'name') {
      return (
        <span className={nameCell}>
          <EntryThumb entry={entry} small />
          <span className={nameText}>{entry.name}</span>
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
    if (column === 'activity') return agoLabel(entry.lastActivityAt, now);
    return entryMenu(entry, canReveal(entry), act, transcribeAction(entry));
  };
  return (
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
  );
}
