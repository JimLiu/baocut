import { useMemo, useRef, type ReactElement } from 'react';
import type { Sequence } from '@baocut/protocol';
import { ActionButton, Button, Keyboard, Menu, MenuItem, MenuTrigger, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDoubleLeft from '@react-spectrum/s2/icons/ChevronDoubleLeft';
import ChevronDoubleRight from '@react-spectrum/s2/icons/ChevronDoubleRight';
import Cut from '@react-spectrum/s2/icons/Cut';
import Delete from '@react-spectrum/s2/icons/Delete';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import Redo from '@react-spectrum/s2/icons/Redo';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Undo from '@react-spectrum/s2/icons/Undo';
import ZoomIn from '@react-spectrum/s2/icons/ZoomIn';
import ZoomOut from '@react-spectrum/s2/icons/ZoomOut';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { nextChapterStart, prevChapterStart, sequenceChapters, visibleChapters } from '../../model/chapters.ts';
import { durationSeconds, frameAt, playButtonState, type PlayButtonState } from '../../model/editor.ts';
import { deletableItemIds, splitOperations } from '../../model/editor-ops.ts';
import { formatTenths } from '../../model/format.ts';
import { keyLabel } from '../../model/key-labels.ts';
import { ZOOM_MENU, zoomLabel as formatZoom, type ZoomAction } from '../../model/timeline-zoom.ts';
import { TIMELINE_ZOOM_COPY as ZOOM_COPY } from '../../copy.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useNarrow } from '../use-narrow.ts';
import { CHAPTER_COPY } from './chapter-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { deleteSelection } from './timeline-commands.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

/**
 * 走带（原型 `.tport`）：左边撤销、重做、拆分、删除；中间播放；右边时码与缩放。两侧等分剩余宽度，让播放键居中；
 * 两侧都不小于自己的内容宽，放不下等分时播放键让出几像素，不把按钮裁成半个。中间一组是上一章 / 下一章（设计稿的 « »，
 * 没有章节时置灰）夹着播放键；播放键是这一条上唯一的主操作：accent 36px 正圆，播放 / 暂停 / 重播三态（`playButtonState`）。
 * 图标一律 16px（app.css 的全局 workflow 图标规则，产品设计 §2.1）。逐帧走只用 ← → 键（video-editor.tsx），走带上不放按钮。
 * 时码与原型同一写法：「00:16.1 / 03:12.4」，满一小时才带时位（「1:02:03.5」，`formatTenths`）。走带恒在，越窄收起越多
 * （见下面三档）；仍放不下时在外缘裁掉，不画到旁边的面板上（原型 `.tport` 的 overflow: hidden）。
 */
const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxSizing: 'border-box',
  height: 46,
  flexShrink: 0,
  paddingX: 12,
  backgroundColor: 'gray-25',
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  overflow: 'hidden',
});
const side = style({ display: 'flex', alignItems: 'center', gap: 4, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 'max' });
const group = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 });
const end = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'end',
  gap: 4,
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 'max',
});
const divider = style({ width: 1, height: 20, backgroundColor: 'gray-300', marginX: 4 });
const timecode = style({ font: 'code-sm', color: 'gray-800', whiteSpace: 'nowrap', marginEnd: 8 });
const total = style({ color: 'gray-600' });
// 标签从「0.012%」到「1000%」：数字等宽（bc-tabular，style 宏会丢掉 fontVariantNumeric），40 的最小宽度放得下最宽的几种。
const zoomLabel = style({ font: 'ui-xs', color: 'gray-700', minWidth: 40, textAlign: 'center' });

/** 比这窄时（会话与素材面板都打开的小窗口），时码不带总长，不显示缩放比例。 */
const COMPACT_WIDTH = 720;
/** 再窄（原型 timeline.jsx 的 `stageW < 520`）：不显示时码。 */
const NARROW_WIDTH = 520;
/** 最窄：中间只留播放键，上一章 / 下一章也收起。 */
const TIGHT_WIDTH = 400;

const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';
const PLAY_ICON = { play: Play, pause: Pause, replay: Refresh } satisfies Record<PlayButtonState, unknown>;
const ZOOM_KEYS = Object.fromEntries(ZOOM_MENU.map(({ id, keys }) => [id, keyLabel(keys, MAC)])) as Record<ZoomAction, string>;

/**
 * `onZoom` 是时间线的缩放动作（timeline.tsx 的 handle.zoom）：按钮、百分比菜单与快捷键共用。
 * 窄档（compact）不显示百分比，菜单跟着收起，缩放的快捷键照用。
 */
export function Transport({ sequence, onZoom }: { sequence: Sequence; onZoom(action: ZoomAction): void }) {
  const actions = useEditorActions();
  const { togglePlay, seek, apply, undo } = actions;
  const video = useVideo((s) => s.video);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.pxPerSecond);
  const editable = canEdit(video);
  const undoStep = video?.undo.undo;
  const redoStep = video?.undo.redo;
  const fps = sequence.fps;
  const frame = frameAt(playhead, fps);
  const splits = splitOperations(sequence, selection, frame);
  const deletable = deletableItemIds(sequence, selection).length > 0;
  const ref = useRef<HTMLDivElement>(null);
  const compact = useNarrow(ref, COMPACT_WIDTH);
  const narrow = useNarrow(ref, NARROW_WIDTH);
  const tight = useNarrow(ref, TIGHT_WIDTH);
  const totalSeconds = durationSeconds(sequence);
  const duration = formatTenths(totalSeconds);
  const play = playButtonState({ playing, playhead, duration: totalSeconds });
  const PlayIcon = PLAY_ICON[play];
  const chapters = useMemo(() => sequenceChapters(sequence), [sequence]);
  const noChapters = visibleChapters(chapters).length === 0;

  return (
    <div ref={ref} className={bar}>
      <div className={side}>
        <Tip label={undoStep ? E.undoTip(undoStep.label, `${MOD}Z`) : E.nothingToUndo}>
          <ActionButton isQuiet aria-label={E.undo} isDisabled={!editable || !undoStep} onPress={() => void undo('undo')}>
            <Undo />
          </ActionButton>
        </Tip>
        <Tip label={redoStep ? E.redoTip(redoStep.label, `⇧${MOD}Z`) : E.nothingToRedo}>
          <ActionButton isQuiet aria-label={E.redo} isDisabled={!editable || !redoStep} onPress={() => void undo('redo')}>
            <Redo />
          </ActionButton>
        </Tip>
        <span className={divider} />
        <Tip label={E.splitTip}>
          <ActionButton isQuiet aria-label={E.split} isDisabled={!editable || splits.length === 0} onPress={() => void apply(splits, E.splitClips)}>
            <Cut />
          </ActionButton>
        </Tip>
        {/* 与 Delete 键、检查器、右键菜单同一条路（deleteSelection），灰不灰读同一份 deletableItemIds。只删时间线上选中的片段；
            文稿面板的 ⌫ 在面板里截住、剪的是选中的字，不经这里（产品设计 §5.7）。 */}
        <Tip label={E.deleteTip}>
          <ActionButton isQuiet aria-label={E.deleteSelected} isDisabled={!editable || !deletable} onPress={() => void deleteSelection(actions)}>
            <Delete />
          </ActionButton>
        </Tip>
      </div>
      <div className={group}>
        {tight ? null : (
          <Tip label={CHAPTER_COPY.prev}>
            <ActionButton
              isQuiet
              aria-label={CHAPTER_COPY.prev}
              isDisabled={noChapters}
              onPress={() => seek(prevChapterStart(chapters, useEditor.getState().playhead))}>
              <ChevronDoubleLeft />
            </ActionButton>
          </Tip>
        )}
        <Tip label={E.playTip[play]}>
          <Button
            variant="accent"
            aria-label={E.playLabel[play]}
            UNSAFE_className="bc-transport-play"
            onPress={() => {
              // 停在片尾：从头再播（引擎停着，toggle 就是开播）。
              if (play === 'replay') seek(0);
              togglePlay();
            }}>
            <PlayIcon />
          </Button>
        </Tip>
        {tight ? null : (
          <Tip label={CHAPTER_COPY.next}>
            <ActionButton
              isQuiet
              aria-label={CHAPTER_COPY.next}
              isDisabled={noChapters}
              onPress={() => seek(nextChapterStart(chapters, useEditor.getState().playhead))}>
              <ChevronDoubleRight />
            </ActionButton>
          </Tip>
        )}
      </div>
      <div className={end}>
        {narrow ? null : (
          <span className={`${timecode} bc-tabular`} aria-label={E.playhead} title={E.totalLength(duration)}>
            {formatTenths(playhead)}
            {compact ? null : <span className={total}> / {duration}</span>}
          </span>
        )}
        <Tip label={`${ZOOM_COPY.out} ${ZOOM_KEYS.out}`}>
          <ActionButton isQuiet aria-label={ZOOM_COPY.out} onPress={() => onZoom('out')}>
            <ZoomOut />
          </ActionButton>
        </Tip>
        {compact ? null : (
          <MenuTrigger align="end">
            <TooltipTrigger>
              <ActionButton isQuiet aria-label={`${ZOOM_COPY.menu} ${formatZoom(zoom)}`}>
                <span className={`${zoomLabel} bc-tabular`}>{formatZoom(zoom)}</span>
              </ActionButton>
              <Tooltip>{ZOOM_COPY.tip}</Tooltip>
            </TooltipTrigger>
            <Menu aria-label={ZOOM_COPY.menu} onAction={(key) => onZoom(key as ZoomAction)}>
              {ZOOM_MENU.map(({ id }) => (
                <MenuItem key={id} id={id} textValue={ZOOM_COPY[id]}>
                  <Text slot="label">{ZOOM_COPY[id]}</Text>
                  <Keyboard>{ZOOM_KEYS[id]}</Keyboard>
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        )}
        <Tip label={`${ZOOM_COPY.in} ${ZOOM_KEYS.in}`}>
          <ActionButton isQuiet aria-label={ZOOM_COPY.in} onPress={() => onZoom('in')}>
            <ZoomIn />
          </ActionButton>
        </Tip>
      </div>
    </div>
  );
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger>
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
