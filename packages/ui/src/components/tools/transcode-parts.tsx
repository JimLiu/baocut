import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExternalToolStatus, JobRecord } from '@baocut/protocol';
import { ActionButton, Button, DropZone, Text, TextField, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Close from '@react-spectrum/s2/icons/Close';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import Move from '@react-spectrum/s2/icons/Move';
import Upload from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  Button as RacButton,
  DropIndicator,
  GridList,
  GridListItem,
  useDragAndDrop,
  type DropItem,
} from 'react-aria-components';
import {
  addInputs,
  addNotice,
  ffmpegLine,
  moveInput,
  moveInputs,
  parsePathInput,
  removeInput,
  transcodeJobs,
  type FfmpegLine,
} from '../../model/tools-transcode.ts';
import { liveCount } from '../../model/tools-records.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { EmptyCard, PageStatus } from '../models/model-parts.tsx';
import { useNow } from '../use-now.ts';
import { detail, Gate, SideFoot, SideHead } from './tool-parts.tsx';
import { RECORD_COPY, TRANSCODE_COPY } from './tools-copy.ts';
import { TranscodeRecord } from './transcode-record.tsx';

/*
 * 压缩视频与合并视频共用的部件（设计稿 tool-video.jsx 的共享层：拖放区、片段行、ffmpeg 卡、右栏「任务队列」）。
 * 选文件三条路：拖进来（桌面端经 `pathForFile` 拿到路径）、「选择视频…」（`baocut:pick-media`）、粘贴完整路径——
 * 最后一条在浏览器预览里拿不到原生对话框时也能用。
 */

// ---- 记录与 ffmpeg ----

/** `transcode` 的记录（压缩与合并在一起）：`jobs` 主题里这台电脑的界面提交的父任务，去掉本机藏起来的。 */
export function useTranscodeRecords(): { ready: boolean; list: JobRecord[]; all: JobRecord[]; live: number } {
  const ready = useJobs((s) => s.ready);
  const all = useJobs((s) => s.jobs);
  const hidden = useTools((s) => s.hidden);
  const list = useMemo(() => transcodeJobs(all, hidden), [all, hidden]);
  return { ready, list, all, live: liveCount(list) };
}

export type FfmpegState = { status: 'checking' } | { status: 'done'; line: FfmpegLine } | { status: 'failed'; message: string };

/**
 * 这台电脑上的 ffmpeg（`externalTools.detect`，只跑 `ffmpeg -version`、不联网）。浏览器里不检测（Runtime 不对网页开放）。
 * 检测本身失败时不拦提交：Runtime 提交时会再查一次，不可用就以原因拒绝。
 */
export function useFfmpeg(enabled: boolean): { state: FfmpegState; recheck: () => void } {
  const runtime = useRuntime();
  const [state, setState] = useState<FfmpegState>({ status: 'checking' });
  const recheck = useCallback(() => {
    setState({ status: 'checking' });
    runtime.detectExternalTool('ffmpeg').then(
      (tool: ExternalToolStatus | null) => setState({ status: 'done', line: ffmpegLine(tool) }),
      (e: Error) => setState({ status: 'failed', message: e.message }),
    );
  }, [runtime]);
  useEffect(() => {
    if (enabled) recheck();
  }, [enabled, recheck]);
  return { state, recheck };
}

/** ffmpeg 不能用时的门卡（设计稿 `FfmpegCard` 的「要先装」；装与升级 Runtime 不代办，照它给的修法写）。 */
export function FfmpegGate({ state, recheck }: { state: FfmpegState; recheck: () => void }) {
  if (state.status !== 'done' || state.line.ready) return null;
  return (
    <Gate
      title={state.line.text}
      body={state.line.remedy ?? ''}
      actions={
        <Button variant="secondary" size="S" onPress={recheck}>
          {TRANSCODE_COPY.recheck}
        </Button>
      }
    />
  );
}

// ---- 选文件 ----

const dropZone = style({ width: 'full' });
const dropBody = style({
  display: 'flex',
  flexDirection: { default: 'column', isCompact: 'row' },
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: { default: 12, isCompact: 8 },
  paddingY: { default: 32, isCompact: 12 },
  paddingX: 16,
  textAlign: 'center',
});
const dropIcon = style({ display: 'flex', color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const dropTitle = style({ font: 'title-sm', color: 'gray-900' });
const dropSub = style({ font: 'ui-xs', color: 'gray-600', maxWidth: 360 });
const pathRow = style({ display: 'flex', alignItems: 'end', gap: 8, minWidth: 0 });
const pathField = style({ flexGrow: 1, minWidth: 0 });

/**
 * 拖放区与「选择视频…」，下面一行粘贴路径。空的时候是大块的拖放区（设计稿 `.vdrop`）；已经有文件时收成一行，还能再拖进来。
 */
export function FilePicker({
  inputs,
  onChange,
  title,
  sub,
  withAudio = false,
}: {
  inputs: readonly string[];
  onChange: (inputs: string[]) => void;
  title: string;
  sub: string;
  /** 提取音频另收音频文件。 */
  withAudio?: boolean;
}) {
  const runtime = useRuntime();
  const [typed, setTyped] = useState('');
  const take = (paths: readonly string[]) => {
    if (!paths.length) return;
    const result = addInputs(inputs, paths, withAudio);
    const notice = addNotice(result);
    if (notice) ToastQueue.neutral(notice, { timeout: 5000 });
    if (result.inputs.length !== inputs.length) onChange(result.inputs);
  };
  const pick = () => {
    void runtime.host.pickMediaFiles().then(take);
  };
  const drop = async (items: readonly DropItem[]) => {
    const paths: string[] = [];
    let lost = 0;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = await item.getFile();
      const path = runtime.host.pathForFile(file);
      if (path) paths.push(path);
      else lost += 1;
    }
    if (lost) ToastQueue.negative(TRANSCODE_COPY.noPath, { timeout: 6000 });
    take(paths);
  };
  const addTyped = () => {
    const path = parsePathInput(typed);
    if (!path) return;
    take([path]);
    setTyped('');
  };
  const compact = inputs.length > 0;
  return (
    <>
      <DropZone styles={dropZone} onDrop={(e) => void drop(e.items)}>
        <div className={dropBody({ isCompact: compact })}>
          <span className={dropIcon} aria-hidden>
            <Upload />
          </span>
          {compact ? (
            <span className={dropSub}>{TRANSCODE_COPY.dropMore}</span>
          ) : (
            <>
              <span className={dropTitle}>{title}</span>
              <span className={dropSub}>{sub}</span>
            </>
          )}
          <Button variant="secondary" size={compact ? 'S' : 'M'} onPress={pick}>
            {compact ? TRANSCODE_COPY.add : TRANSCODE_COPY.pick}
          </Button>
        </div>
      </DropZone>
      <div className={pathRow}>
        <TextField
          styles={pathField}
          size="S"
          label={TRANSCODE_COPY.pathLabel}
          placeholder={TRANSCODE_COPY.pathPlaceholder}
          value={typed}
          onChange={setTyped}
          onKeyDown={(e) => {
            // React Aria 默认拦住键盘事件冒泡；⌘↵ 要放行给 Workbench 提交。
            if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return e.continuePropagation();
            e.preventDefault();
            addTyped();
          }}
        />
        <Button variant="secondary" size="S" isDisabled={!typed.trim()} onPress={addTyped}>
          {TRANSCODE_COPY.pathAdd}
        </Button>
      </div>
    </>
  );
}

const CLIP_TYPE = 'application/x-baocut-transcode-input';

const list = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, outlineStyle: 'none' });
const clip = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingY: 8,
  paddingStart: 12,
  paddingEnd: 8,
  borderRadius: 'default',
  backgroundColor: { default: 'gray-25', isDragging: 'blue-100' },
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  opacity: { default: 1, isDragging: 0.6 },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  minWidth: 0,
});
const clipIndex = style({ font: 'code-xs', color: 'gray-600', width: 20, flexShrink: 0, textAlign: 'end' });
const clipIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const grip = style({
  display: 'flex',
  flexShrink: 0,
  padding: 4,
  borderRadius: 'sm',
  backgroundColor: 'transparent',
  borderStyle: 'none',
  color: 'gray-600',
  cursor: 'grab',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const clipText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const clipName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const clipPath = style({ font: 'code-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' });
const indicator = style({
  height: 2,
  marginY: '[-3px]',
  borderRadius: 'full',
  backgroundColor: { default: 'transparent', isDropTarget: 'blue-800' },
  outlineStyle: 'none',
});

/** 一个图标按钮带提示（设计稿 `IconBtn tip`）。 */
function IconButton({ label, onPress, isDisabled, children }: { label: string; onPress: () => void; isDisabled?: boolean; children: ReactNode }) {
  return (
    <TooltipTrigger>
      <ActionButton isQuiet size="S" aria-label={label} isDisabled={isDisabled} onPress={onPress}>
        {children}
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

/**
 * 选好的文件（设计稿 `ClipRow` / `SourceRow`）：合并时带序号、拖动手柄与上移 / 下移（RAC 的拖放，键盘也能拖），
 * 压缩时只有移出。同一个文件只进一次，所以路径（Space 条目是 `space:<entryId>`）就是行的 key。
 */
export function InputList({
  inputs,
  ordered,
  onChange,
  nameOf,
}: {
  inputs: readonly string[];
  ordered: boolean;
  onChange: (inputs: string[]) => void;
  nameOf: (input: string) => { name: string; sub: string };
}) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ [CLIP_TYPE]: String(key), 'text/plain': String(key) })),
    acceptedDragTypes: [CLIP_TYPE],
    getDropOperation: () => 'move',
    onReorder: (e) => {
      if (e.target.dropPosition === 'on') return;
      onChange(moveInputs(inputs, [...e.keys].map(String), String(e.target.key), e.target.dropPosition));
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className={({ isDropTarget }) => indicator({ isDropTarget })} />,
  });
  const items = inputs.map((path) => ({ id: path, path }));
  return (
    <GridList
      aria-label={TRANSCODE_COPY.listLabel}
      items={items}
      selectionMode="none"
      dragAndDropHooks={ordered ? dragAndDropHooks : undefined}
      className={list}>
      {(item) => {
        const index = inputs.indexOf(item.path);
        const { name, sub } = nameOf(item.path);
        return (
          <GridListItem id={item.id} textValue={name} className={({ isDragging, isFocusVisible }) => clip({ isDragging, isFocusVisible })}>
            {ordered ? (
              <>
                <span className={clipIndex}>{index + 1}</span>
                <RacButton slot="drag" aria-label={TRANSCODE_COPY.dragLabel(name)} className={({ isFocusVisible }) => grip({ isFocusVisible })}>
                  <Move />
                </RacButton>
              </>
            ) : (
              <span className={clipIcon} aria-hidden>
                <Filmstrip />
              </span>
            )}
            <span className={clipText}>
              <span className={clipName} title={name}>
                {name}
              </span>
              <span className={clipPath} title={sub}>
                {sub}
              </span>
            </span>
            {ordered ? (
              <>
                <IconButton label={TRANSCODE_COPY.moveUp} isDisabled={index === 0} onPress={() => onChange(moveInput(inputs, index, -1))}>
                  <ChevronUp />
                </IconButton>
                <IconButton label={TRANSCODE_COPY.moveDown} isDisabled={index === inputs.length - 1} onPress={() => onChange(moveInput(inputs, index, 1))}>
                  <ChevronDown />
                </IconButton>
              </>
            ) : null}
            <IconButton label={TRANSCODE_COPY.remove} onPress={() => onChange(removeInput(inputs, index))}>
              <Close />
            </IconButton>
          </GridListItem>
        );
      }}
    </GridList>
  );
}

// ---- 右栏 ----

/**
 * 右栏「处理记录」：压缩与合并的记录列在一起（设计稿 `JobList`）。取消了的照设计稿留一张「重新排队」
 * （本机执行，不计费）；没做成的、做完的都列。「带回左边再来一版」由记录卡自己按它是压缩还是合并带回对应的页。
 */
export function TranscodeSide() {
  const records = useTranscodeRecords();
  const now = useNow(30_000);
  return (
    <>
      <SideHead
        title={TRANSCODE_COPY.side}
        live={records.live ? RECORD_COPY.live(records.live) : null}
        count={RECORD_COPY.count(records.list.length)}
      />
      {!records.ready ? (
        <PageStatus>{TRANSCODE_COPY.loading}</PageStatus>
      ) : records.list.length ? (
        records.list.map((job) => <TranscodeRecord key={job.jobId} job={job} all={records.all} now={now} />)
      ) : (
        <EmptyCard icon={<Filmstrip />} title={TRANSCODE_COPY.empty} body={TRANSCODE_COPY.emptyBody} />
      )}
      <SideFoot>{TRANSCODE_COPY.sideFoot}</SideFoot>
    </>
  );
}
