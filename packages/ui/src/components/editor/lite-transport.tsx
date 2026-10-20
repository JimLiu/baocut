import { useRef, type ReactElement } from 'react';
import type { Sequence } from '@baocut/protocol';
import { ActionButton, Button, Menu, MenuItem, MenuTrigger, Text, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDoubleLeft from '@react-spectrum/s2/icons/ChevronDoubleLeft';
import ChevronDoubleRight from '@react-spectrum/s2/icons/ChevronDoubleRight';
import DataRefresh from '@react-spectrum/s2/icons/DataRefresh';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import StepBackward from '@react-spectrum/s2/icons/StepBackward';
import ZoomIn from '@react-spectrum/s2/icons/ZoomIn';
import ZoomOut from '@react-spectrum/s2/icons/ZoomOut';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TIMELINE_ZOOM_COPY as ZOOM_COPY } from '../../copy.ts';
import { durationSeconds, playButtonState, type PlayButtonState } from '../../model/editor.ts';
import { formatTenths } from '../../model/format.ts';
import {
  LITE_ZOOM_MENU,
  liteZoomLabel,
  nextSegmentStart,
  prevSegmentStart,
  type LiteSegment,
  type LiteZoomAction,
} from '../../model/lite-segments.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useNarrow } from '../use-narrow.ts';
import { useEditorActions } from './editor-context.tsx';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { LITE_COPY as L } from './lite-copy.ts';

/**
 * 轻量视图的走带（轻量编辑器设计 §3「走带」；原型 editor-lite.jsx 的 `LiteTransport`）：与时间线的走带同一副骨架
 * （transport.tsx：46px、两侧等分、播放键居中、图标 16px），只是左边不放编辑键——换成从头播放与循环；中间是上一段 / 下一段夹着
 * 播放键；右边时码与片条的缩放（按钮、百分比菜单，`onZoom` 交给片条）。窄了同样分三档收起。
 * 缩放菜单不标快捷键（设计 §11 第 10 条：⌘= / ⌘− 留给时间线的习惯，这里不写进菜单）。
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
  borderBottomWidth: 0,
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
const timecode = style({ font: 'code-sm', color: 'gray-800', whiteSpace: 'nowrap', marginEnd: 8 });
const total = style({ color: 'gray-600' });
const zoomLabel = style({ font: 'ui-xs', color: 'gray-700', minWidth: 40, textAlign: 'center' });

const COMPACT_WIDTH = 720;
const NARROW_WIDTH = 520;
const TIGHT_WIDTH = 400;
const PLAY_ICON = { play: Play, pause: Pause, replay: Refresh } satisfies Record<PlayButtonState, unknown>;

export function LiteTransport({
  sequence,
  segments,
  loop,
  onLoop,
  onZoom,
}: {
  sequence: Sequence;
  segments: readonly LiteSegment[];
  loop: boolean;
  onLoop(next: boolean): void;
  onZoom(action: LiteZoomAction): void;
}) {
  const { togglePlay, seek } = useEditorActions();
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const zoom = useEditor((s) => s.liteZoom);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useNarrow(ref, COMPACT_WIDTH);
  const narrow = useNarrow(ref, NARROW_WIDTH);
  const tight = useNarrow(ref, TIGHT_WIDTH);
  const totalSeconds = durationSeconds(sequence);
  const duration = formatTenths(totalSeconds);
  const play = playButtonState({ playing, playhead, duration: totalSeconds });
  const PlayIcon = PLAY_ICON[play];
  const single = segments.length <= 1;
  const zoomCopy: Record<LiteZoomAction, string> = {
    in: ZOOM_COPY.in,
    out: ZOOM_COPY.out,
    fit: L.zoomFit,
    segment: L.zoomSegment,
    playhead: L.zoomPlayhead,
  };

  return (
    <div ref={ref} className={bar}>
      <div className={side}>
        <Tip label={L.restart}>
          <ActionButton
            isQuiet
            aria-label={L.restart}
            onPress={() => {
              seek(0);
              if (!useEditor.getState().playing) togglePlay();
            }}
          >
            <StepBackward />
          </ActionButton>
        </Tip>
        <Tip label={loop ? L.loopOn : L.loopOff}>
          <ToggleButton isQuiet aria-label={L.loopOn} isSelected={loop} onChange={onLoop}>
            <DataRefresh />
          </ToggleButton>
        </Tip>
      </div>
      <div className={group}>
        {tight ? null : (
          <Tip label={L.prevSegment}>
            <ActionButton
              isQuiet
              aria-label={L.prevSegment}
              isDisabled={single}
              onPress={() => seek(prevSegmentStart(segments, useEditor.getState().playhead))}
            >
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
              if (play === 'replay') seek(0);
              togglePlay();
            }}
          >
            <PlayIcon />
          </Button>
        </Tip>
        {tight ? null : (
          <Tip label={L.nextSegment}>
            <ActionButton
              isQuiet
              aria-label={L.nextSegment}
              isDisabled={single}
              onPress={() => seek(nextSegmentStart(segments, useEditor.getState().playhead))}
            >
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
        <Tip label={ZOOM_COPY.out}>
          <ActionButton isQuiet aria-label={ZOOM_COPY.out} onPress={() => onZoom('out')}>
            <ZoomOut />
          </ActionButton>
        </Tip>
        {compact ? null : (
          <MenuTrigger align="end">
            <TooltipTrigger>
              <ActionButton isQuiet aria-label={`${ZOOM_COPY.menu} ${liteZoomLabel(zoom)}`}>
                <span className={`${zoomLabel} bc-tabular`}>{liteZoomLabel(zoom)}</span>
              </ActionButton>
              <Tooltip>{ZOOM_COPY.tip}</Tooltip>
            </TooltipTrigger>
            <Menu aria-label={ZOOM_COPY.menu} onAction={(key) => onZoom(key as LiteZoomAction)}>
              {LITE_ZOOM_MENU.map((id) => (
                <MenuItem key={id} id={id} textValue={zoomCopy[id]}>
                  <Text slot="label">{zoomCopy[id]}</Text>
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        )}
        <Tip label={ZOOM_COPY.in}>
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
