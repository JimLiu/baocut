import { useEffect, useState } from 'react';
import {
  framesToSeconds,
  itemAssetRef,
  itemTimeMap,
  mediaTimeToSeconds,
  type AssetRecord,
  type AudioItem,
  type CompositionItem,
  type MediaTime,
  type Sequence,
  type SequenceItem,
  type VideoItem,
  type VisualItem,
  volumeToDb,
} from '@baocut/protocol';
import { ActionButton, Button, Switch, TextField } from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import Lock from '@react-spectrum/s2/icons/Lock';
import Target from '@react-spectrum/s2/icons/Target';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatFps, formatSeconds, formatTimecode, itemFrames, parseSecondsInput, trackRows } from '../../model/editor.ts';
import {
  SPEED_MAX,
  SPEED_MIN,
  decimalSeconds,
  formatDb,
  percentFromVolume,
  rateFromSpeed,
  speedOf,
  volumeFromPercent,
} from '../../model/property-values.ts';
import { useEditor } from '../../state/editor-store.ts';
import { DangerButton, Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import type { ItemEdit } from './use-item-edit.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const timeFields = style({ display: 'grid', gridTemplateColumns: ['1fr', '1fr'], gap: 8 });
const timeCell = style({ display: 'flex', alignItems: 'end', gap: 4, minWidth: 0 });
const timeInput = style({ flexGrow: 1, minWidth: 0 });
const grid = style({
  display: 'grid',
  gridTemplateColumns: ['auto', '1fr'],
  columnGap: 12,
  rowGap: '[6px]',
  font: 'ui-sm',
  alignItems: 'baseline',
});
const key = style({ color: 'gray-600', whiteSpace: 'nowrap' });
const value = style({ color: 'gray-900', minWidth: 0, overflowWrap: 'anywhere' });
const lockNote = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-300',
  font: 'ui-sm',
  color: 'gray-800',
});
const lockText = style({ flexGrow: 1 });

/** 一页里各节共用的东西：片段、序列、改法，以及现在能不能改（视频可编辑、片段与轨道都没锁）。 */
export interface ItemPageProps<T extends SequenceItem = SequenceItem> {
  item: T;
  sequence: Sequence;
  assets: Record<string, AssetRecord>;
  edit: ItemEdit;
  canChange: boolean;
}

/** 片段或它所在的轨道锁着：说清楚为什么都是灰的；片段自己锁着时给一个解锁钮。 */
export function LockNotice({
  item,
  sequence,
  edit,
  editable,
}: {
  item: SequenceItem;
  sequence: Sequence;
  edit: ItemEdit;
  editable: boolean;
}) {
  const track = sequence.tracks.find((t) => t.id === item.trackId);
  if (!item.locked && !track?.locked) return null;
  return (
    <div className={lockNote}>
      <Lock />
      <span className={lockText}>{item.locked ? IC.clipLocked : IC.trackLocked}</span>
      {item.locked ? (
        <Button
          variant="secondary"
          size="S"
          isDisabled={!editable || !!track?.locked}
          onPress={() => edit.commit([{ type: 'updateItem', sequenceId: sequence.id, itemId: item.id, locked: false }])}>
          {IC.unlock}
        </Button>
      ) : null}
    </div>
  );
}

/** 不透明度（有布局框的片段）。 */
export function OpacityRow({ item, sequence, edit, canChange }: ItemPageProps<VisualItem>) {
  return (
    <ValueRow
      label={IC.opacity}
      value={Math.round((item.place.opacity ?? 1) * 100)}
      min={0}
      max={100}
      unit="%"
      isDisabled={!canChange}
      onLive={(v) => edit.live({ place: { opacity: v / 100 } })}
      onCommit={(v) => edit.commit([{ type: 'setStyle', sequenceId: sequence.id, itemId: item.id, opacity: v / 100 }])}
    />
  );
}

const SPEEDS = [
  { key: '0.5', label: '0.5×' },
  { key: '1', label: '1×' },
  { key: '1.5', label: '1.5×' },
  { key: '2', label: '2×' },
  {
    key: 'custom',
    get label() {
      return IC.custom;
    },
  },
] as const;
type SpeedKey = (typeof SPEEDS)[number]['key'];

/** 变速（视频、音频的线性时间映射）：常用倍速一点即改，自定义 0.25–4×。取用的素材不变，长度按新速率重算。 */
export function SpeedSection({ item, sequence, edit, canChange }: ItemPageProps<VideoItem | AudioItem>) {
  const map = item.timeMap;
  const speed = map.kind === 'linear' ? speedOf(map.rate) : 1;
  const preset = SPEEDS.find((s) => s.key !== 'custom' && Number(s.key) === speed)?.key;
  const [custom, setCustom] = useState(!preset);
  useEffect(() => setCustom(!preset), [preset]);
  if (map.kind !== 'linear') return null;
  const commit = (next: number) => edit.commit([{ type: 'setSpeed', sequenceId: sequence.id, itemId: item.id, rate: rateFromSpeed(next) }]);
  return (
    <>
      <SecHead aside={IC.speedAside}>{IC.speedChange}</SecHead>
      <Sec>
        <Seg<SpeedKey>
          label={IC.speedChange}
          value={custom ? 'custom' : (preset ?? 'custom')}
          options={SPEEDS}
          isDisabled={!canChange}
          onChange={(key) => {
            if (key === 'custom') setCustom(true);
            else {
              setCustom(false);
              commit(Number(key));
            }
          }}
        />
        {custom ? (
          <ValueRow
            label={IC.speedRate}
            value={speed}
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.05}
            digits={2}
            unit="×"
            isDisabled={!canChange}
            onCommit={commit}
          />
        ) : null}
        <Note>{IC.speedNote}</Note>
      </Sec>
    </>
  );
}

function seconds(time: MediaTime | undefined): number {
  return time ? mediaTimeToSeconds(time) : 0;
}

function millis(value: number): MediaTime | undefined {
  return value > 0 ? { ticks: String(Math.round(value * 1000)), timescale: 1000 } : undefined;
}

/**
 * 声音：静音、音量（0–200%，数字框可到 400%，行尾是 dB）与淡入淡出（0–5 秒，两者之和不超过片段长度）。
 * 音频改自己的混音；视频与有声音的合成改它自带的那路声音（静音就是不用它）。
 */
export function SoundSection({ item, sequence, edit, canChange }: ItemPageProps<VideoItem | AudioItem | CompositionItem>) {
  const route = item.type === 'audio' ? item.mix : item.type === 'video' ? item.embeddedAudio : item.audio;
  if (!route) return null;
  const muted = item.type === 'audio' ? !!item.mix.muted : !(route as { enabled: boolean }).enabled;
  const range = itemFrames(item, sequence.fps);
  const length = framesToSeconds(range.end - range.start, sequence.fps);
  const fadeMax = Math.max(0, Math.min(5, length));
  const target = { sequenceId: sequence.id, itemId: item.id };
  const live = (patch: { volume?: number; fadeIn?: MediaTime; fadeOut?: MediaTime }) =>
    edit.live(item.type === 'audio' ? { mix: patch } : { embeddedAudio: patch });
  const volume = route.volume;
  return (
    <>
      <SecHead>{IC.sound}</SecHead>
      <Sec>
        <PRow label={IC.mute}>
          <Switch
            aria-label={IC.mute}
            size="S"
            isSelected={muted}
            isDisabled={!canChange}
            onChange={(on) => edit.commit([{ type: 'setAudioMix', ...target, muted: on }])}
          />
        </PRow>
        <ValueRow
          label={IC.volume}
          value={percentFromVolume(volume)}
          min={0}
          max={200}
          hardMax={400}
          unit="%"
          extra={formatDb(volumeToDb(volume))}
          isDisabled={!canChange || muted}
          onLive={(v) => live({ volume: volumeFromPercent(v) })}
          onCommit={(v) => edit.commit([{ type: 'setAudioMix', ...target, volume: volumeFromPercent(v) }])}
        />
        <ValueRow
          label={IC.fadeIn}
          value={seconds(route.fadeIn)}
          min={0}
          max={fadeMax}
          step={0.1}
          digits={1}
          unit={IC.seconds}
          isDisabled={!canChange || fadeMax <= 0}
          onLive={(v) => live({ fadeIn: millis(v) })}
          onCommit={(v) => edit.commit([{ type: 'setAudioMix', ...target, fadeIn: decimalSeconds(v) }])}
        />
        <ValueRow
          label={IC.fadeOut}
          value={seconds(route.fadeOut)}
          min={0}
          max={fadeMax}
          step={0.1}
          digits={1}
          unit={IC.seconds}
          isDisabled={!canChange || fadeMax <= 0}
          onLive={(v) => live({ fadeOut: millis(v) })}
          onCommit={(v) => edit.commit([{ type: 'setAudioMix', ...target, fadeOut: decimalSeconds(v) }])}
        />
      </Sec>
    </>
  );
}

/**
 * 时间：开始与结束（输入十进制秒或「分:秒」，按编辑帧率对齐到最近的一帧；旁边一枚钮设为播放头），
 * 下面是时长、时码、素材入点与轨道。
 */
export function TimeSection({ item, sequence, assets, edit, canChange }: ItemPageProps) {
  const fps = sequence.fps;
  const range = itemFrames(item, fps);
  const start = framesToSeconds(range.start, fps);
  const end = framesToSeconds(range.end, fps);
  const row = trackRows(sequence).find((r) => r.track.id === item.trackId);
  const timeMap = itemTimeMap(item);
  const sourceIn = timeMap?.kind === 'linear' ? mediaTimeToSeconds(timeMap.sourceIn) : null;
  const assetRef = itemAssetRef(item);
  const asset = assetRef ? assets[assetRef.id] : undefined;
  const target = { sequenceId: sequence.id, itemId: item.id };
  const moveTo = (text: string) =>
    edit.commit([{ type: 'moveItem', ...target, at: { unit: 'seconds', value: text }, alignment: 'nearest-frame' }]);
  const endAt = (text: string) =>
    edit.commit([{ type: 'trimItem', ...target, edge: 'end', at: { unit: 'seconds', value: text }, alignment: 'nearest-frame' }]);
  const playhead = () => decimalSeconds(useEditor.getState().playhead);
  return (
    <>
      <SecHead aside={IC.timeAside}>{IC.time}</SecHead>
      <Sec>
        <div className={timeFields}>
          <div className={timeCell}>
            <TimeField label={IC.start} seconds={start} isDisabled={!canChange} onCommit={moveTo} />
            <ActionButton isQuiet size="S" aria-label={IC.startAtPlayhead} isDisabled={!canChange} onPress={() => moveTo(playhead())}>
              <Target />
            </ActionButton>
          </div>
          <div className={timeCell}>
            <TimeField label={IC.end} seconds={end} isDisabled={!canChange} onCommit={endAt} />
            <ActionButton isQuiet size="S" aria-label={IC.endAtPlayhead} isDisabled={!canChange} onPress={() => endAt(playhead())}>
              <Target />
            </ActionButton>
          </div>
        </div>
        <div className={grid}>
          <span className={key}>{IC.duration}</span>
          <span className={value}>{formatSeconds(end - start)}</span>
          <span className={key}>{IC.timecode}</span>
          <span className={`${value} bc-tabular`}>
            {formatTimecode(start, fps)} – {formatTimecode(end, fps)}
          </span>
          {sourceIn !== null ? (
            <>
              <span className={key}>{IC.sourceIn}</span>
              <span className={value}>{formatSeconds(sourceIn)}</span>
            </>
          ) : null}
          <span className={key}>{IC.track}</span>
          <span className={value}>
            {row?.label ?? '—'} · {IC.editFps(formatFps(fps))}
          </span>
          {asset && assetRef ? (
            <>
              <span className={key}>{IC.asset}</span>
              <span className={value}>
                {asset.name} · {IC.revision(assetRef.revision)}
              </span>
            </>
          ) : null}
        </div>
      </Sec>
    </>
  );
}

/** 时间输入：回车或离开时提交十进制秒字符串（不先在界面上取整），由引擎量化；Esc 放弃。 */
function TimeField({
  label,
  seconds: value,
  isDisabled,
  onCommit,
}: {
  label: string;
  seconds: number;
  isDisabled: boolean;
  onCommit(text: string): void;
}) {
  const shown = value.toFixed(3);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(shown);
    setError(null);
  }, [shown]);
  const commit = () => {
    if (draft === shown) return;
    const parsed = parseSecondsInput(draft);
    if (parsed === null) {
      setError(IC.secondsInputError);
      return;
    }
    setError(null);
    onCommit(parsed);
  };
  return (
    <TextField
      label={IC.secondsField(label)}
      size="S"
      styles={timeInput}
      value={draft}
      isDisabled={isDisabled}
      isInvalid={error !== null}
      errorMessage={error ?? undefined}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(shown);
      }}
    />
  );
}

/** 页底的删除钮。 */
export function DeleteItem({ item, sequence, edit, canChange }: ItemPageProps) {
  return (
    <DangerButton
      isDisabled={!canChange}
      onPress={() => edit.commit([{ type: 'deleteItems', sequenceId: sequence.id, itemIds: [item.id] }])}>
      <Delete />
      <span>{IC.deleteClip}</span>
    </DangerButton>
  );
}
