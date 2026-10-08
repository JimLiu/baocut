import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { MediaHandle, MediaTarget, SubtitleTrack } from '@baocut/protocol';
import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Picker,
  PickerItem,
  ProgressCircle,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import FullScreenExit from '@react-spectrum/s2/icons/FullScreenExit';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeOne from '@react-spectrum/s2/icons/VolumeOne';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components/Slider';
import { formatClock } from '../../model/format.ts';
import { targetKey } from '../../model/media.ts';
import { kindOfFileName } from '../../model/space.ts';
import { activeCues, decodeSubtitleText, parseSubtitles, seekTimeOf, subtitleFormatOf, type Cue } from '../../model/subtitles.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { PLAYBACK_RATES, usePlayer } from '../../state/player-store.ts';
import { PlaybackController, usePlaybackStatus, usePlaybackTime } from './playback.ts';
import { P } from './player-copy.ts';
import { SubtitleList } from './subtitle-list.tsx';
import './player.css';
import { pauseOtherPreviews } from '../../model/image-preview.ts';

/** 字幕文件读全文的上限。 */
const SUBTITLE_LIMIT = 5 * 1024 * 1024;
const NO_TRACK = '__none__';

const root = style({ display: 'flex', gap: 16, minHeight: 0, minWidth: 0, outlineStyle: 'none' });
const screen = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const stage = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  borderRadius: 'lg',
  backgroundColor: 'black',
  outlineStyle: 'none',
});
const audioStage = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 160,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  color: 'gray-600',
  outlineStyle: 'none',
});
const video = style({ display: 'block', width: 'full', maxHeight: '[52vh]', objectFit: 'contain' });
const hidden = style({ display: 'none' });
const stageNote = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  font: 'ui',
  color: 'white',
  backgroundColor: '[rgb(0 0 0 / 70%)]',
});
const spinner = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
});
const controls = style({ display: 'flex', flexDirection: 'column', gap: 2 });
const controlRow = style({ display: 'flex', alignItems: 'center', gap: 4 });
const spacer = style({ flexGrow: 1 });
const clock = style({ font: 'ui-sm', color: 'gray-700', whiteSpace: 'nowrap', paddingX: 4 });
// 滑块拇指以数值为中心，两端留出半个拇指，免得压到边上的按钮。
const scrubber = style({ width: 'full', paddingX: 8 });
const volumeSlider = style({ width: 80, paddingX: 8, flexShrink: 0 });
const track = style({ position: 'relative', height: 20, width: 'full', cursor: 'default' });
const rail = style({ position: 'absolute', insetX: 0, top: 8, height: 4, borderRadius: 'full', backgroundColor: 'gray-300' });
const fill = style({ position: 'absolute', insetStart: 0, top: 8, height: 4, borderRadius: 'full', backgroundColor: 'accent' });
const thumb = style({
  top: '[3px]',
  size: 14,
  borderRadius: 'full',
  backgroundColor: 'white',
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'gray-800',
  boxShadow: 'elevated',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const side = style({ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, minWidth: 0 });
const sideHead = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const sideTitle = style({ font: 'title-sm', whiteSpace: 'nowrap' });
const sideCount = style({ font: 'ui-sm', color: 'gray-600', whiteSpace: 'nowrap', flexGrow: 1 });
const note = style({ font: 'ui-sm', color: 'gray-600', margin: 0, paddingY: 8 });

type CueState = { status: 'none' } | { status: 'loading' } | { status: 'ready'; cues: Cue[] } | { status: 'error'; message: string };

/**
 * 只读播放器（产品设计 §11.1 的 0.3）：播放项目目录里的视频或音频，叠加同目录的字幕文件，
 * 字幕列表与画面同步，点一句跳到那里。会话的功能区与 Space 的查看框用的是同一个组件：
 * 功能区窄，列表在下（column）；查看框宽，列表在右（row）。播放器不写任何文件。
 */
export function MediaPlayer({
  target,
  fileName,
  layout = 'column',
  memoryKey,
  resolvedHandle,
  mediaKind,
}: {
  target: MediaTarget;
  fileName: string;
  layout?: 'column' | 'row';
  /** 记播放位置与字幕选择用的键。项目里的文件从会话还是从 Space 打开都该记在一处；不给时按 target。 */
  memoryKey?: string;
  resolvedHandle?: MediaHandle;
  mediaKind?: 'audio' | 'video';
}) {
  const runtime = useRuntime();
  const key = targetKey(target);
  const memory = memoryKey ?? key;
  const isAudio = mediaKind ? mediaKind === 'audio' : kindOfFileName(fileName) === 'audio';
  const [url, setUrl] = useState<{ status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string }>({
    status: 'loading',
  });
  const [tracks, setTracks] = useState<SubtitleTrack[] | null>(null);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [media, setMedia] = useState<HTMLVideoElement | null>(null);
  const [controller, setController] = useState<PlaybackController | null>(null);
  const status = usePlaybackStatus(controller);
  const screenRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(screenRef);

  const choice = usePlayer((s) => s.tracks[memory]);
  const chooseTrack = usePlayer((s) => s.chooseTrack);
  const captionsOn = usePlayer((s) => s.captions);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const rate = usePlayer((s) => s.rate);
  // 没选过时自动用同名的字幕；选了「不用字幕」就是 null。
  const chosen = choice === undefined ? (tracks?.find((t) => t.matched)?.fileName ?? null) : choice;
  const track = tracks?.find((t) => t.fileName === chosen) ?? null;
  const cueState = useCues(track);
  const cues = cueState.status === 'ready' ? cueState.cues : NO_CUES;

  // target 由 key 唯一确定，不把每次新建的对象放进依赖。
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setUrl({ status: 'loading' });
    setTracks(null);
    setTracksError(null);
    (resolvedHandle ? Promise.resolve(resolvedHandle) : runtime.resolveMedia(target))
      .then(handle => runtime.playbackMedia(handle, controller.signal))
      .then(
        (handle) => !cancelled && setUrl({ status: 'ready', url: handle.url }),
        (error: Error) => !cancelled && setUrl({ status: 'error', message: error.message }),
      );
    // 视频里的素材、消息附的图片没有旁边的字幕文件。
    ('videoId' in target || 'attachmentId' in target ? Promise.resolve([]) : runtime.listSubtitles(target)).then(
      (found) => !cancelled && setTracks(found),
      (error: Error) => !cancelled && setTracksError(error.message),
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runtime, key, resolvedHandle]);

  // 控制器跟着媒体元素：元素换了（换了文件）就重建。关掉时记下播放位置（产品设计 §3.3）。
  useEffect(() => {
    if (!media) return;
    const next = new PlaybackController(media);
    setController(next);
    return () => {
      usePlayer.getState().remember(memory, next.time);
      next.dispose();
      setController(null);
    };
  }, [media, memory]);

  // 元数据到了再回到上次的位置。
  useEffect(() => {
    if (!controller || !status.ready) return;
    const position = usePlayer.getState().positions[memory];
    if (position && position < status.duration - 0.5) controller.seek(position);
  }, [controller, status.ready, status.duration, memory]);

  useEffect(() => {
    if (!media) return;
    media.volume = volume;
    media.muted = muted;
    media.playbackRate = rate;
  }, [media, volume, muted, rate]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!controller || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    // 输入框、滑杆、菜单、字幕列表有自己的键；按钮上的空格与回车是按下按钮。
    if (el.closest('input, textarea, [contenteditable="true"], [role="slider"], [role="menu"], [role="listbox"]')) return;
    if (el.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
    const player = usePlayer.getState();
    const handled = (() => {
      switch (e.key) {
        case ' ':
        case 'k':
          controller.toggle();
          return true;
        case 'ArrowLeft':
          controller.nudge(-5);
          return true;
        case 'ArrowRight':
          controller.nudge(5);
          return true;
        case 'j':
          controller.nudge(-10);
          return true;
        case 'l':
          controller.nudge(10);
          return true;
        case 'ArrowUp':
          player.setVolume(player.volume + 0.1);
          return true;
        case 'ArrowDown':
          player.setVolume(player.volume - 0.1);
          return true;
        case 'm':
          player.setMuted(!player.muted);
          return true;
        case 'c':
          player.setCaptions(!player.captions);
          return true;
        case 'f':
          fullscreen.toggle();
          return true;
        case 'Home':
          controller.seek(0);
          return true;
        case 'End':
          controller.seek(status.duration);
          return true;
        default:
          if (/^[0-9]$/.test(e.key) && status.duration) {
            controller.seek((status.duration * Number(e.key)) / 10);
            return true;
          }
          return false;
      }
    })();
    if (handled) e.preventDefault();
  };

  const stageBody =
    url.status === 'ready' ? (
      <video
        data-bc-media-preview=""
        onPlay={event => pauseOtherPreviews(event.currentTarget)}
        ref={setMedia}
        className={isAudio ? hidden : video}
        src={url.url}
        preload="metadata"
        playsInline
        // 没有画面时声音照样播。
        aria-hidden={isAudio || undefined}
      />
    ) : null;

  const screenBlock = (
    <div ref={screenRef} className={`${screen} bc-player-screen`} style={layout === 'row' ? { flex: '3 1 0' } : undefined}>
      <div
        className={`${isAudio ? audioStage : stage} bc-player-stage`}
        tabIndex={0}
        role="group"
        aria-label={P.surface(fileName)}
        onClick={() => controller?.toggle()}
        onDoubleClick={() => !isAudio && fullscreen.toggle()}>
        {stageBody}
        {isAudio ? <AudioFace controller={controller} cues={cues} fileName={fileName} /> : null}
        {!isAudio && captionsOn ? <Captions controller={controller} cues={cues} /> : null}
        {url.status === 'loading' || (status.waiting && !status.paused) ? (
          <div className={spinner}>
            <ProgressCircle
              isIndeterminate
              staticColor={isAudio ? undefined : 'white'}
              aria-label={url.status === 'loading' ? P.loading : P.buffering}
            />
          </div>
        ) : null}
        {url.status === 'error' || status.error ? (
          <div className={stageNote} role="alert">
            {url.status === 'error' ? P.openFailed(url.message) : status.error}
          </div>
        ) : null}
      </div>
      <Controls controller={controller} fullscreen={fullscreen} hasCues={cues.length > 0} isAudio={isAudio} />
    </div>
  );

  return (
    <div
      className={root}
      style={{ flexDirection: layout === 'row' ? 'row' : 'column', flexGrow: 1, height: layout === 'row' ? '62vh' : undefined }}
      onKeyDown={onKeyDown}>
      {screenBlock}
      <section className={side} aria-label={P.subtitles} style={layout === 'row' ? { flex: '2 1 0' } : { flexGrow: 1 }}>
        <div className={sideHead}>
          <span className={sideTitle}>{P.subtitles}</span>
          <span className={sideCount}>{cueState.status === 'ready' ? P.cueCount(cues.length) : ''}</span>
          {tracks && tracks.length ? (
            <Picker
              aria-label={P.subtitleFile}
              size="S"
              isQuiet
              menuWidth={240}
              value={chosen ?? NO_TRACK}
              onChange={(value) => chooseTrack(memory, value === NO_TRACK || value === null ? null : String(value))}>
              {[
                ...tracks.map((t) => (
                  <PickerItem key={t.fileName} id={t.fileName} textValue={t.fileName}>
                    {t.fileName}
                  </PickerItem>
                )),
                <PickerItem key={NO_TRACK} id={NO_TRACK} textValue={P.noSubtitles}>
                  {P.noSubtitles}
                </PickerItem>,
              ]}
            </Picker>
          ) : null}
        </div>
        <SubtitleBody
          tracks={tracks}
          tracksError={tracksError}
          track={track}
          cueState={cueState}
          cues={cues}
          controller={controller}
          isAudio={isAudio}
        />
      </section>
    </div>
  );
}

const NO_CUES: Cue[] = [];

function SubtitleBody({
  tracks,
  tracksError,
  track,
  cueState,
  cues,
  controller,
  isAudio,
}: {
  tracks: SubtitleTrack[] | null;
  tracksError: string | null;
  track: SubtitleTrack | null;
  cueState: CueState;
  cues: Cue[];
  controller: PlaybackController | null;
  isAudio: boolean;
}) {
  if (tracksError) return <p className={note}>{P.listFailed(tracksError)}</p>;
  if (!tracks) return <p className={note}>{P.finding}</p>;
  if (!tracks.length) {
    return <p className={note}>{P.noneNearby(isAudio)}</p>;
  }
  if (!track) return <p className={note}>{P.noneSelected}</p>;
  if (cueState.status === 'loading') return <p className={note}>{P.reading(track.fileName)}</p>;
  if (cueState.status === 'error')
    return (
      <p className={note}>
        {P.readFailed(track.fileName, cueState.message)}
      </p>
    );
  if (!cues.length) return <p className={note}>{P.empty(track.fileName)}</p>;
  return <SubtitleList cues={cues} controller={controller} onSeek={(cue) => controller?.seek(seekTimeOf(cue))} />;
}

/** 读并解析一个字幕文件。换了文件时丢掉旧的结果，晚到的旧请求不覆盖新的。 */
function useCues(track: SubtitleTrack | null): CueState {
  const runtime = useRuntime();
  const [state, setState] = useState<CueState>({ status: 'none' });
  const trackKey = track ? targetKey(track.target) : null;
  useEffect(() => {
    if (!track) {
      setState({ status: 'none' });
      return;
    }
    const format = subtitleFormatOf(track.fileName);
    if (!format) {
      setState({ status: 'error', message: P.unknownFormat });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      const handle = await runtime.resolveMedia(track.target);
      if (handle.size > SUBTITLE_LIMIT) throw new Error(P.tooLarge);
      const response = await fetch(handle.url);
      if (!response.ok) throw new Error(P.fetchFailed(response.status));
      const text = decodeSubtitleText(new Uint8Array(await response.arrayBuffer()));
      return parseSubtitles(text, format);
    })().then(
      (cues) => !cancelled && setState({ status: 'ready', cues }),
      (error: Error) => !cancelled && setState({ status: 'error', message: error.message }),
    );
    return () => {
      cancelled = true;
    };
    // track 由 trackKey 唯一确定。
  }, [runtime, trackKey]);
  return state;
}

function Captions({ controller, cues }: { controller: PlaybackController | null; cues: readonly Cue[] }) {
  const shown = usePlaybackTime(controller, (t) =>
    activeCues(cues, t)
      .map((c) => c.index)
      .join(','),
  );
  if (!shown) return null;
  return (
    <div className="bc-captions" aria-hidden>
      {shown.split(',').map((i) => (
        <span key={i}>{cues[Number(i) - 1]?.text}</span>
      ))}
    </div>
  );
}

/** 音频没有画面：舞台上写当前句，没有字幕时写文件名。 */
function AudioFace({ controller, cues, fileName }: { controller: PlaybackController | null; cues: readonly Cue[]; fileName: string }) {
  const shown = usePlaybackTime(controller, (t) =>
    activeCues(cues, t)
      .map((c) => c.index)
      .join(','),
  );
  if (shown) {
    return (
      <div className="bc-captions" data-audio aria-hidden>
        {shown.split(',').map((i) => (
          <span key={i}>{cues[Number(i) - 1]?.text}</span>
        ))}
      </div>
    );
  }
  return (
    <>
      <MusicNote />
      <span className={note}>{fileName}</span>
    </>
  );
}

function Controls({
  controller,
  fullscreen,
  hasCues,
  isAudio,
}: {
  controller: PlaybackController | null;
  fullscreen: Fullscreen;
  hasCues: boolean;
  isAudio: boolean;
}) {
  const status = usePlaybackStatus(controller);
  const player = usePlayer();
  const playing = !status.paused;
  const long = status.duration >= 3600;
  const VolumeIcon = player.muted || player.volume === 0 ? VolumeOff : player.volume < 0.5 ? VolumeOne : VolumeTwo;
  const disabled = !controller || !status.ready || status.error !== null;

  return (
    <div className={`${controls} bc-player-controls`}>
      <Scrubber controller={controller} duration={status.duration} isDisabled={disabled} />
      <div className={controlRow}>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={playing ? P.pause : P.play} isDisabled={disabled} onPress={() => controller?.toggle()}>
            {playing ? <Pause /> : <Play />}
          </ActionButton>
          <Tooltip>{playing ? P.pauseTip : status.ended ? P.replayTip : P.playTip}</Tooltip>
        </TooltipTrigger>
        <span className={`${clock} bc-tabular`}>
          <ClockText controller={controller} long={long} /> / {formatClock(status.duration, { hours: long })}
        </span>
        <span className={spacer} />
        {!isAudio ? (
          <TooltipTrigger>
            <ToggleButton
              isQuiet
              size="S"
              aria-label={P.overlay}
              isDisabled={!hasCues}
              isSelected={player.captions && hasCues}
              onChange={player.setCaptions}>
              <CloseCaptions />
            </ToggleButton>
            <Tooltip>{player.captions ? P.hideTip : P.showTip}</Tooltip>
          </TooltipTrigger>
        ) : null}
        <MenuTrigger>
          <ActionButton isQuiet size="S" aria-label={P.rateCurrent(player.rate)}>
            <span className="bc-tabular">{player.rate}×</span>
          </ActionButton>
          <Menu
            aria-label={P.rate}
            selectionMode="single"
            selectedKeys={[String(player.rate)]}
            onSelectionChange={(keys) => {
              const [first] = keys === 'all' ? [] : [...keys];
              if (first !== undefined) player.setRate(Number(first));
            }}>
            {PLAYBACK_RATES.map((r) => (
              <MenuItem key={r} id={String(r)} textValue={`${r}×`}>
                {r === 1 ? P.rateNormal : `${r}×`}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={player.muted ? P.unmute : P.mute} onPress={() => player.setMuted(!player.muted)}>
            <VolumeIcon />
          </ActionButton>
          <Tooltip>{player.muted ? P.unmuteTip : P.muteTip}</Tooltip>
        </TooltipTrigger>
        <Slider
          aria-label={P.volume}
          className={volumeSlider}
          minValue={0}
          maxValue={1}
          step={0.05}
          value={player.muted ? 0 : player.volume}
          onChange={player.setVolume}
          formatOptions={{ style: 'percent' }}>
          <SliderTrack className={track}>
            {({ state }) => (
              <>
                <div className={rail} />
                <div className={fill} style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
                <SliderThumb className={thumb} />
              </>
            )}
          </SliderTrack>
        </Slider>
        {!isAudio ? (
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={fullscreen.active ? P.exitFullscreen : P.fullscreen} onPress={fullscreen.toggle}>
              {fullscreen.active ? <FullScreenExit /> : <FullScreen />}
            </ActionButton>
            <Tooltip>{fullscreen.active ? P.exitFullscreenTip : P.fullscreenTip}</Tooltip>
          </TooltipTrigger>
        ) : null}
      </div>
    </div>
  );
}

function ClockText({ controller, long }: { controller: PlaybackController | null; long: boolean }) {
  // 只在显示的秒数变了才重画。
  const text = usePlaybackTime(controller, (t) => formatClock(t, { hours: long }));
  return <>{text}</>;
}

/**
 * 进度条。拖动中每次变化都发定位请求，由 SeekQueue 合并；手里的位置优先于媒体报上来的时间，
 * 松手后交还（验收 T30：旧的定位结果不把滑块拉回去）。
 */
function Scrubber({ controller, duration, isDisabled }: { controller: PlaybackController | null; duration: number; isDisabled: boolean }) {
  const time = usePlaybackTime(controller, (t) => t);
  const [drag, setDrag] = useState<number | null>(null);
  const max = duration || 1;
  return (
    <Slider
      aria-label={P.position}
      className={scrubber}
      minValue={0}
      maxValue={max}
      step={0.01}
      isDisabled={isDisabled}
      value={Math.min(drag ?? time, max)}
      onChange={(value) => {
        setDrag(value);
        controller?.seek(value);
      }}
      onChangeEnd={(value) => {
        controller?.seek(value);
        setDrag(null);
      }}
      formatOptions={{ style: 'unit', unit: 'second', unitDisplay: 'long', maximumFractionDigits: 0 }}>
      <SliderTrack className={track}>
        {({ state }) => (
          <>
            <div className={rail} />
            <div className={fill} style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
            <SliderThumb className={thumb} />
          </>
        )}
      </SliderTrack>
    </Slider>
  );
}

interface Fullscreen {
  active: boolean;
  toggle: () => void;
}

function useFullscreen(ref: RefObject<HTMLElement | null>): Fullscreen {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);
  return {
    active,
    toggle: () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void ref.current?.requestFullscreen().catch(() => {});
    },
  };
}
