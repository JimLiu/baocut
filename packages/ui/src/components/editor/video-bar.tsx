import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { localizeText, type VideoRef, type Sequence } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import {
  ActionButton,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  ProgressCircle,
  SegmentedControl,
  SegmentedControlItem,
  StatusLight,
  SubmenuTrigger,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import Asset from '@react-spectrum/s2/icons/Asset';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Close from '@react-spectrum/s2/icons/Close';
import Edit from '@react-spectrum/s2/icons/Edit';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import History from '@react-spectrum/s2/icons/History';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { durationSeconds, formatFps } from '../../model/editor.ts';
import { formatClock } from '../../model/format.ts';
import { isEditorView, type EditorViewDefault } from '../../model/lite-segments.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, type OpenVideo } from '../../state/video-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ExportButton } from '../export/export-button.tsx';
import { NameDialog } from '../name-dialog.tsx';
import { TaskPill } from '../task-pill.tsx';
import { useNarrow } from '../use-narrow.ts';
import { useEditorActions } from './editor-context.tsx';
import { EditorVideoInfo } from './video-info.tsx';
import { VersionsControl, type VersionsEntry } from './video-versions.tsx';
import { VIDEO_BAR_COPY as VB } from './video-bar-copy.ts';
import { VIDEO_VERSIONS_COPY as VC } from './video-versions-copy.ts';
import { LITE_COPY as L } from './lite-copy.ts';

/**
 * 视频栏（产品设计 §5.1；原型 shell.jsx `Moviebar`）：左边视频名与状态，中间「审片 / 时间线」，右边任务进度环 · 导出（从 Space 打开时再加关闭）。
 * 视频名本身是菜单入口：详情、重命名、版本记录、在 Space / 文件夹中显示、默认打开哪种视图都收在这里；保存状态跟在元数据后面。
 * 视频名优先占宽度：切换居中在视频名与右段之间的空里，两边空白都收到 16px 后视频名才截断，截断时悬停看全名。
 * 很窄时（编辑器不到 600px）视频名独占一行，切换与操作排在下面，放不下再折一行。
 */
const NARROW = 600;
const bar = style({
  display: { default: 'grid', isNarrow: 'flex' },
  gridTemplateColumns: '[minmax(0, max-content) minmax(16px, 1fr) auto minmax(16px, 1fr) auto]',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: { default: 0, isNarrow: 8 },
  boxSizing: 'border-box',
  minHeight: 64,
  flexShrink: 0,
  paddingX: { default: 16, isNarrow: 8 },
  paddingY: 8,
  borderBottomWidth: 2,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  backgroundColor: 'gray-25',
});
const titleBlock = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  minWidth: 0,
  gridColumnStart: 1,
  flexBasis: { default: 'auto', isNarrow: 'full' },
  flexGrow: { default: 0, isNarrow: 1 },
});
/** 视频名是菜单入口：安静按钮，左内边距用负外边距抵掉，文字左缘与下面的元数据对齐。 */
const nameButton = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  maxWidth: '[calc(100% + 8px)]',
  height: 32,
  marginY: 0,
  marginStart: '[-8px]',
  marginEnd: 0,
  paddingX: 8,
  paddingY: 0,
  borderWidth: 0,
  borderRadius: 'default',
  font: 'title',
  color: 'neutral',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isPressed: 'gray-200' },
  transition: 'colors',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const nameText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 快照两边都改过：圆点从原来的版本记录按钮搬到视频名右上角（版本记录设计 §12.4）。 */
const conflictDot = style({ position: 'absolute', top: 4, insetEnd: 4, size: 8, borderRadius: 'full', backgroundColor: 'accent' });
const metaRow = style({ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 'full', minWidth: 0, font: 'ui-xs', color: 'gray-600' });
const meta = style({ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
const mid = style({ display: 'flex', justifyContent: { default: 'center', isNarrow: 'start' }, gridColumnStart: 3, flexShrink: 0 });
const acts = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'end',
  gap: 8,
  minWidth: 0,
  gridColumnStart: 5,
  flexGrow: { default: 0, isNarrow: 1 },
  flexShrink: 0,
});
const sep = style({ flexShrink: 0, width: 2, height: 24, backgroundColor: 'gray-100' });
const saveText = style({ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 });
const agentText = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: 240 });
const agentLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export function VideoBar({ video, sequence }: { video: OpenVideo; sequence: Sequence | null }) {
  // 版本记录的对话框挂在菜单之外（菜单一关就卸载）；视频还没读出来时没有版本记录入口。
  if (!video.state) return <Bar video={video} sequence={sequence} versions={null} />;
  return <VersionsControl video={video}>{(versions) => <Bar video={video} sequence={sequence} versions={versions} />}</VersionsControl>;
}

function Bar({ video, sequence, versions }: { video: OpenVideo; sequence: Sequence | null; versions: VersionsEntry | null }) {
  const runtime = useRuntime();
  const { apply } = useEditorActions();
  const closeVideo = useShell((s) => s.closeVideo);
  // 只有从 Space 打开时才有关闭：Home 里视频是功能区的一个标签，关在标签上。
  const fromSpace = useShell((s) => s.route.tab === 'space');
  const [renaming, setRenaming] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const isNarrow = useNarrow(barRef, NARROW, 'border-box');
  const name = video.state?.video.name ?? video.ref?.name ?? VB.untitled;
  const review = runtime.review;

  const parts: string[] = [];
  if (sequence) {
    parts.push(formatClock(durationSeconds(sequence), { tenths: true }));
    parts.push(`${sequence.canvas.width}×${sequence.canvas.height}`);
    parts.push(formatFps(sequence.fps));
  }
  if (video.ref) parts.push(video.ref.relPath);

  return (
    <header ref={barRef} className={bar({ isNarrow })}>
      <div className={titleBlock({ isNarrow })}>
        <VideoName
          video={video}
          name={name}
          versions={versions}
          onInfo={() => setShowInfo(true)}
          onRename={() => setRenaming(true)}
          onMenu={(key) => onMenu(key, video.ref)}
        />
        <div className={metaRow}>
          {parts.length ? <span className={meta}>{parts.join(' · ')}</span> : null}
          {parts.length ? <span aria-hidden="true">·</span> : null}
          <SaveState video={video} />
        </div>
      </div>
      {sequence ? (
        <div className={mid({ isNarrow })}>
          <ViewToggle />
        </div>
      ) : null}
      <div className={acts({ isNarrow })}>
        {review ? null : <TaskPill videoId={video.videoId} />}
        {/* 审片页（架构设计 §12.8）只有这一部视频：不导出、不去 Space、不关闭。 */}
        {review ? null : <ExportButton video={video} sequence={sequence} />}
        {!review && fromSpace ? <span className={sep} aria-hidden="true" /> : null}
        {!review && fromSpace ? (
          <Tip label={VB.closeToSpace}>
            <ActionButton isQuiet aria-label={VB.close} onPress={closeVideo}>
              <Close />
            </ActionButton>
          </Tip>
        ) : null}
      </div>
      {renaming ? (
        <NameDialog
          title={VB.rename}
          label={VB.nameLabel}
          initial={name}
          submitLabel={VB.save}
          onClose={() => setRenaming(false)}
          onSubmit={async (next) => {
            const receipt = await apply([{ type: 'renameVideo', name: next }], EditLabel.renameVideo());
            if (receipt) setRenaming(false);
          }}
        />
      ) : null}
      {showInfo ? <EditorVideoInfo video={video} sequence={sequence} onClose={() => setShowInfo(false)} /> : null}
    </header>
  );

  function onMenu(key: string, ref: VideoRef | null) {
    if (!ref) return;
    if (key === 'reveal') void runtime.host.revealPath(ref.path);
    else if (key === 'space') {
      const shell = useShell.getState();
      shell.closeVideo();
      shell.go({ tab: 'space', category: 'video', projectId: ref.source.projectId });
    }
  }
}

/**
 * 视频名与它的菜单。名字只在真被截断时给全名提示（短名字再悬停出一遍同样的字是噪音）：栏宽或名字一变就量，悬停前已经知道。
 * 「默认打开」改全局偏好（轻量编辑器设计 §6，只管以后打开的视频），放在子菜单里。
 */
function VideoName({
  video,
  name,
  versions,
  onInfo,
  onRename,
  onMenu,
}: {
  video: OpenVideo;
  name: string;
  versions: VersionsEntry | null;
  onInfo(): void;
  onRename(): void;
  onMenu(key: string): void;
}) {
  const runtime = useRuntime();
  const viewDefault = useEditor((s) => s.viewDefault);
  const setViewDefault = useEditor((s) => s.setViewDefault);
  const textRef = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const text = textRef.current;
    const box = text?.parentElement?.parentElement;
    if (!text || !box) return;
    const measure = () => setCut(text.scrollWidth > text.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [name]);

  const editable = canEdit(video);
  const fileActions = !runtime.review && video.ref !== null;
  const canReveal = runtime.host.platform !== 'web';
  const defaultLabel = viewDefault === 'lite' ? L.defaultLite : viewDefault === 'timeline' ? L.defaultTimeline : L.defaultAuto;
  const onAction = (key: string) => {
    if (key === 'info') onInfo();
    else if (key === 'rename') onRename();
    else if (key === 'versions') versions?.open();
    else onMenu(key);
  };

  return (
    <MenuTrigger>
      <TooltipTrigger isDisabled={!cut} placement="bottom">
        <RACButton className={nameButton} aria-label={versions?.conflict ? `${name} · ${versions.tip}` : undefined}>
          <span ref={textRef} className={nameText}>
            {name}
          </span>
          <ChevronDown />
          {versions?.conflict ? <span className={conflictDot} aria-hidden="true" /> : null}
        </RACButton>
        <Tooltip>{name}</Tooltip>
      </TooltipTrigger>
      <Menu aria-label={VB.actions} disabledKeys={editable ? [] : ['rename']} onAction={(key) => onAction(String(key))}>
        <MenuSection aria-label={VB.actions}>
          <MenuItem id="info" textValue={VB.details}>
            <InfoCircle />
            <Text slot="label">{VB.details}</Text>
          </MenuItem>
          <MenuItem id="rename" textValue={VB.rename}>
            <Edit />
            <Text slot="label">{VB.rename}</Text>
          </MenuItem>
          {versions ? (
            <MenuItem id="versions" textValue={VC.title}>
              <History />
              <Text slot="label">{VC.title}</Text>
              {versions.hint ? <Text slot="description">{versions.hint}</Text> : null}
            </MenuItem>
          ) : null}
        </MenuSection>
        {fileActions ? (
          <MenuSection aria-label={VB.showInSpace}>
            <MenuItem id="space" textValue={VB.showInSpace}>
              <Asset />
              <Text slot="label">{VB.showInSpace}</Text>
            </MenuItem>
            {canReveal ? (
              <MenuItem id="reveal" textValue={VB.revealVideoFolder}>
                <OpenIn />
                <Text slot="label">{VB.revealVideoFolder}</Text>
              </MenuItem>
            ) : null}
          </MenuSection>
        ) : null}
        <MenuSection aria-label={L.defaultOpen}>
          <SubmenuTrigger>
            <MenuItem id="default-view" textValue={L.defaultOpen}>
              <Text slot="label">{L.defaultOpen}</Text>
              <Text slot="description">{defaultLabel}</Text>
            </MenuItem>
            <Menu
              aria-label={L.defaultOpen}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[viewDefault]}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const next = [...keys][0];
                if (next === 'auto' || isEditorView(next)) setViewDefault(next as EditorViewDefault);
              }}>
              <MenuSection>
                <Header>{L.defaultOpen}</Header>
                <MenuItem id="auto" textValue={L.defaultAuto}>
                  <Text slot="label">{L.defaultAuto}</Text>
                  <Text slot="description">{L.defaultAutoHint}</Text>
                </MenuItem>
                <MenuItem id="lite" textValue={L.defaultLite}>
                  <Text slot="label">{L.defaultLite}</Text>
                </MenuItem>
                <MenuItem id="timeline" textValue={L.defaultTimeline}>
                  <Text slot="label">{L.defaultTimeline}</Text>
                </MenuItem>
              </MenuSection>
            </Menu>
          </SubmenuTrigger>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

/**
 * 轻量 / 时间线的切换（轻量编辑器设计 §3.5、§5、§6）：视频栏正中一枚分段控件（照原型 `shell.jsx` 的 `MovieViewSwitch`：
 * 文稿图标 + 审片、胶片图标 + 时间线）。「默认打开」在视频名菜单里。同一部视频、同一个引擎，只换视频栏之下的那一片；
 * 按视频记住选择（editor-store 的 `viewByVideo`）。版面编辑器开着时不切（它占着时间线视图的右栏，切走会丢草稿）。
 */
function ViewToggle() {
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const studio = useEditor((s) => s.templateStudio !== null);
  return (
    <SegmentedControl
      aria-label={L.viewGroup}
      selectedKey={view}
      isDisabled={studio}
      onSelectionChange={(key) => {
        if (isEditorView(key) && key !== view) setView(key);
      }}>
      <SegmentedControlItem id="lite">
        <Transcript />
        <Text>{L.viewLite}</Text>
      </SegmentedControlItem>
      <SegmentedControlItem id="timeline">
        <Filmstrip />
        <Text>{L.viewTimeline}</Text>
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

/** 保存状态：已追平、正在提交、未追平（断线或重新打开中）、打不开（产品设计 §2.6：已连接不等于已追平）。跟在元数据后面，与视频名读作一组。 */
function SaveState({ video }: { video: OpenVideo }) {
  if (video.status === 'error')
    return (
      <StatusLight size="S" variant="negative">
        {VB.openFailed}
      </StatusLight>
    );
  if (video.status === 'stale')
    return (
      <StatusLight size="S" variant="notice">
        {VB.stale}
      </StatusLight>
    );
  if (video.status === 'opening')
    return (
      <span className={saveText}>
        <ProgressCircle size="S" isIndeterminate aria-label={VB.openingAria} />
        {VB.opening}
      </span>
    );
  if (video.inFlight > 0)
    return (
      <span className={saveText}>
        <ProgressCircle size="S" isIndeterminate aria-label={VB.savingAria} />
        {VB.saving}
      </span>
    );
  // 智能体刚改过：说一声改了什么，时间线上的变化才不显得莫名其妙（§1.5 共用一个编辑器）。
  if (video.lastChange?.by === 'agent') {
    const label = localizeText(video.lastChange.label, video.lastChange.labelRef);
    return (
      <span className={agentText} title={VB.agentChanged(label)}>
        <AIMark />
        <span className={agentLabel}>{VB.savedByAgent(label)}</span>
      </span>
    );
  }
  return <span className={saveText}>{VB.saved}</span>;
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger>
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
