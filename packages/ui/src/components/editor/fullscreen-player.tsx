import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import {
  ActionButton,
  Header,
  Keyboard,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Provider,
  Slider,
  Text,
  ToastQueue,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import ChevronDoubleLeft from '@react-spectrum/s2/icons/ChevronDoubleLeft';
import ChevronDoubleRight from '@react-spectrum/s2/icons/ChevronDoubleRight';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import FullScreenExit from '@react-spectrum/s2/icons/FullScreenExit';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeOne from '@react-spectrum/s2/icons/VolumeOne';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider';
import { Slider as AriaSlider, SliderThumb, SliderTrack } from 'react-aria-components/Slider';
import { PREVIEW_KEYS_COPY } from '../../copy.ts';
import { captionChips, languageName } from '../../model/caption-tracks.ts';
import { chapterAt, nextChapterStart, prevChapterStart, sequenceChapters, visibleChapters, type ChapterSpan } from '../../model/chapters.ts';
import { durationSeconds, playButtonState, type PlayButtonState } from '../../model/editor.ts';
import { formatTenths } from '../../model/format.ts';
import { keyLabel } from '../../model/key-labels.ts';
import {
  PLAYER_KEYS,
  SEEK_STEP,
  SEEK_STEP_LONG,
  captionAvailability,
  captionModes,
  chapterTicks,
  chromeHidden,
  cycleCaptionMode,
  effectiveCaptionMode,
  holdingVisible,
  percentTime,
  previewSize,
  resolvePlayerKey,
  seekFraction,
  seekFrame,
  stepTime,
  timeAt,
  type CaptionMode,
  type PlayerKey,
} from '../../model/player.ts';
import { monitorGain, monitorLevel, stepMonitor, toggleMute, type MonitorLevel } from '../../model/preview-volume.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { PLAYBACK_RATES } from '../../state/player-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { P } from '../player/player-copy.ts';
import { CHAPTER_COPY } from './chapter-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { FULLSCREEN_PLAYER_COPY as F } from './fullscreen-player-copy.ts';
import './fullscreen-player.css';

/**
 * 编辑器的全屏播放器（原型 player.jsx、model-player.js；判据在 model/player.ts）。预览舞台进了全屏（preview.tsx）时盖在画面上：
 *
 * - 画面不重画：还是预览引擎那一份，只是字幕按档位过滤（`engine.setCaptionView`）、倍速乘在时钟上（`engine.setRate`）。
 *   这两样都是这个窗口的视图态，不进视频、不进撤销、不影响导出。字幕档位只管这一次全屏，退出时回到舞台的字幕显隐；
 *   倍速与舞台工具条共用一份（editor-store），退出全屏后照旧。
 * - 控件：进度条（章节刻痕、悬停气泡里一格画面 + 时码 + 章节名、拖动）· 播放 · 上一章 / 下一章 · 音量（悬停展开滑杆）·
 *   时码 · 字幕四档 · 倍速 · 键表 · 退出全屏。在播且鼠标 3 秒不动时连同指针一起收起（`chromeHidden`）。
 * - 键盘：全屏时播放器独占（捕获阶段接、编辑器的快捷键让位，见 video-editor 的 `useEditorKeys`），键表是 `PLAYER_KEYS`。
 *   浏览器给了键盘锁定（Chromium / Electron）时 Esc 归播放器：开着键表先关表，再按一次退出；没给时 Esc 由浏览器直接退出全屏。
 * - 画面上单击 = 播放 / 暂停，双击 = 退出全屏。
 *
 * 这一层贴在视频上，底下的亮度谁也不知道，所以不随明暗主题翻转：控件用 S2 的 `staticColor="white"`，控件条下垫渐变遮罩，
 * 菜单、提示与滑杆走深色（嵌一层 `Provider colorScheme="dark"`）。弹层挂进全屏的舞台里（全屏时只有它的子树看得见）。
 */

const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const PLAY_ICON = { play: Play, pause: Pause, replay: Refresh } satisfies Record<PlayButtonState, unknown>;

const root = style({ position: 'absolute', inset: 0, outlineStyle: 'none' });
/** 画面上点、双击的那一层：盖满舞台，舞台上的提示卡（`children`）与控件都在它上面。 */
const surface = style({ position: 'absolute', inset: 0 });
const title = style({ font: 'title', color: 'white', truncate: true });
const subtitle = style({ font: 'ui-sm', color: 'transparent-white-800', truncate: true });
const row = style({ display: 'flex', alignItems: 'center', gap: 8 });
const spacer = style({ flexGrow: 1 });
const clock = style({ font: 'code-sm', color: 'white', whiteSpace: 'nowrap', paddingX: 4 });
const clockTotal = style({ color: 'transparent-white-600' });
const volumeSlider = style({ width: 80, flexShrink: 0 });
const keyRow = style({ display: 'flex', alignItems: 'center', gap: 12, minHeight: 24, font: 'ui-sm', color: 'transparent-white-800' });
const keyLabelStyle = style({ flexGrow: 1, minWidth: 0 });
const keyPill = style({ flexShrink: 0, paddingX: '[6px]', borderRadius: 'sm', backgroundColor: 'transparent-white-200', color: 'white', font: 'code-xs', whiteSpace: 'nowrap' });
const keysTitle = style({ font: 'title', color: 'white', marginTop: 0, marginBottom: 12 });
const keysFooter = style({ font: 'ui-xs', color: 'transparent-white-600', marginTop: 12, marginBottom: 0 });
const seekFill = style({ backgroundColor: 'accent' });
const bubbleTime = style({ font: 'code-xs', color: 'white' });
const bubbleChapter = style({ font: 'ui-xs', color: 'transparent-white-800', maxWidth: 220, truncate: true });

/** 浏览器的键盘锁定（Keyboard Lock API，只在全屏里能锁 Esc）；Safari 与 Firefox 没有。 */
type KeyboardLock = { lock?(keys?: string[]): Promise<void>; unlock?(): void };

/** 预览舞台进全屏（F 与预览顶上的入口钮）：要在用户手势的这一拍里调用，浏览器只认瞬时激活；要不到时提示一句。 */
export function enterPreviewFullscreen(stage: HTMLElement | null): void {
  const failed = () => ToastQueue.neutral(PREVIEW_KEYS_COPY.fullscreenFailed, { timeout: 5000 });
  if (!stage?.requestFullscreen) return void failed();
  void stage.requestFullscreen().catch(failed);
}

export function exitPreviewFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

export function FullscreenPlayer({
  stage,
  sequence,
  assets,
  documents,
  children,
}: {
  /** 全屏的那个元素（预览舞台）：弹层挂进它里面。 */
  stage: RefObject<HTMLElement | null>;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  /** 舞台上的提示卡（主媒体放不出来、载入与卡住）：夹在画面点击层与控件之间。 */
  children?: ReactNode;
}) {
  const { engine, seek, togglePlay } = useEditorActions();
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const name = useVideo((s) => s.video?.state?.video.name ?? s.video?.ref?.name) ?? sequence.name;
  const duration = durationSeconds(sequence);
  const chapters = useMemo(() => sequenceChapters(sequence), [sequence]);
  const shownChapters = useMemo(() => visibleChapters(chapters), [chapters]);
  const chapter = chapters[chapterAt(chapters, playhead)] ?? null;
  const rootRef = useRef<HTMLDivElement>(null);

  // 音量跟着引擎（编辑器里 ↑/↓、M 调的是同一份监听音量）。
  const [level, setLevelState] = useState<MonitorLevel>(() => monitorLevel(engine.monitor));
  useEffect(() => engine.onMonitor((gain) => setLevelState(monitorLevel(gain))), [engine]);
  const setLevel = useCallback((next: MonitorLevel) => engine.setMonitor(monitorGain(next)), [engine]);

  // 倍速与舞台工具条共用一份（editor-store），交给引擎的是 preview.tsx。
  const rate = useEditor((s) => s.rate);
  const setRate = useEditor((s) => s.setRate);

  // 字幕档位：选过的档还在就用它，否则按画面上实有的字幕取默认档；舞台上隐藏了字幕时从「关闭」起步。
  const [picked, setPicked] = useState<CaptionMode | null>(() => (useEditor.getState().captionsHidden ? 'off' : null));
  const { hasSource, hasTranslation } = useMemo(() => captionAvailability(sequence, documents), [sequence, documents]);
  const mode = effectiveCaptionMode(picked, hasSource, hasTranslation);
  const modes = captionModes(hasSource, hasTranslation);
  const languages = useMemo(() => captionLanguages(sequence, documents), [sequence, documents]);
  // 退出全屏后由 preview.tsx 按舞台的字幕显隐还原。
  useEffect(() => engine.setCaptionView(mode), [engine, mode]);

  // ---- 收起 ----
  const [popup, setPopup] = useState<'captions' | 'rate' | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);
  const lastPoke = useRef(performance.now());
  const [idleMs, setIdleMs] = useState(0);
  const poke = useCallback(() => {
    lastPoke.current = performance.now();
    setIdleMs(0);
  }, []);
  useEffect(() => {
    // 只在可能收起的时候起表：暂停时判据恒为 false。
    if (!playing) return;
    const timer = setInterval(() => setIdleMs(performance.now() - lastPoke.current), 250);
    return () => clearInterval(timer);
  }, [playing]);
  const holding = holdingVisible({ scrubbing, popup: popup !== null || keysOpen, volumeDragging });
  const hidden = chromeHidden({ playing, hovering, holding, idleMs });

  // 焦点挪进全屏的子树：留在外面的话 Tab 会走到看不见的编辑器控件上。
  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);

  // Esc 归播放器：只在全屏里锁得住；锁住了键表才写「按 Esc 关掉这张表」。
  const [escOwned, setEscOwned] = useState(false);
  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    if (!keyboard?.lock) return;
    let alive = true;
    keyboard.lock(['Escape']).then(
      () => alive && setEscOwned(true),
      () => {},
    );
    return () => {
      alive = false;
      keyboard.unlock?.();
    };
  }, []);

  const playState = playButtonState({ playing, playhead, duration });
  const playPause = () => {
    // 停在片尾：从头再播。
    if (playButtonState({ playing: engine.playing, playhead: useEditor.getState().playhead, duration }) === 'replay') seek(0);
    togglePlay();
  };

  const run = ({ action, digit }: PlayerKey) => {
    const now = useEditor.getState().playhead;
    switch (action) {
      case 'keys':
        return setKeysOpen((open) => !open);
      case 'exit':
        // 开着键表时先关表：开着一张表按 Esc，期待的是关掉这张表，不是连片子一起退出。
        if (keysOpen) return setKeysOpen(false);
        return exitPreviewFullscreen();
      case 'play':
        return playPause();
      case 'back':
      case 'fwd':
        return seek(stepTime(now, action === 'back' ? -SEEK_STEP : SEEK_STEP, duration));
      case 'back10':
      case 'fwd10':
        return seek(stepTime(now, action === 'back10' ? -SEEK_STEP_LONG : SEEK_STEP_LONG, duration));
      case 'prevChapter':
        return seek(prevChapterStart(chapters, now));
      case 'nextChapter':
        return seek(nextChapterStart(chapters, now));
      case 'volUp':
      case 'volDown':
        return setLevel(stepMonitor(level, action === 'volUp' ? 1 : -1));
      case 'mute':
        return setLevel(toggleMute(level));
      case 'captions':
        return setPicked(cycleCaptionMode(mode, hasSource, hasTranslation));
      case 'start':
        return seek(0);
      case 'end':
        return seek(duration);
      case 'percent':
        return seek(percentTime(digit ?? 0, duration));
    }
  };
  const latest = useRef({ run, poke, popup });
  latest.current = { run, poke, popup };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      // 菜单开着时方向键、回车、Esc 归菜单。
      if (latest.current.popup) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return;
      const key = resolvePlayerKey(event);
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      latest.current.poke();
      latest.current.run(key);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const portal = useCallback(() => stage.current ?? document.body, [stage]);
  const PlayIcon = PLAY_ICON[playState];
  const VolumeIcon = level.muted || level.volume === 0 ? VolumeOff : level.volume <= 50 ? VolumeOne : VolumeTwo;
  const noChapters = shownChapters.length === 0;
  const captionSub = (m: CaptionMode) => (m === 'source' ? languages.original : m === 'trans' ? languages.translation : null);

  return (
    <UNSAFE_PortalProvider getContainer={portal}>
      <div
        ref={rootRef}
        className={`${root} bc-fsp`}
        data-idle={hidden || undefined}
        tabIndex={-1}
        role="region"
        aria-label={F.region}
        onPointerMove={poke}
        onPointerDown={poke}>
        <div
          className={surface}
          onClick={() => {
            poke();
            playPause();
          }}
          onDoubleClick={exitPreviewFullscreen}
        />
        {children}
        <Provider colorScheme="dark" UNSAFE_className="bc-fsp-chrome">
          <div className="bc-fsp-top">
            <div className={title}>{name}</div>
            {chapter ? <div className={subtitle}>{chapter.title}</div> : null}
          </div>

          {keysOpen ? (
            <div className="bc-fsp-keys" onClick={() => setKeysOpen(false)}>
              <div className="bc-fsp-keys-card" role="dialog" aria-label={F.keysTitle} onClick={(event) => event.stopPropagation()}>
                <h2 className={keysTitle}>{F.keysTitle}</h2>
                {PLAYER_KEYS.map((key) => (
                  <div key={key.action} className={keyRow}>
                    <span className={keyLabelStyle}>{F.keys[key.action as keyof typeof F.keys]}</span>
                    <Keyboard styles={keyPill}>{keyLabel(key.keys, MAC)}</Keyboard>
                  </div>
                ))}
                {escOwned ? <p className={keysFooter}>{F.keysFooter}</p> : null}
              </div>
            </div>
          ) : null}

          <div
            className="bc-fsp-bar"
            onPointerEnter={() => {
              setHovering(true);
              poke();
            }}
            onPointerLeave={() => setHovering(false)}>
            <SeekBar
              sequence={sequence}
              assets={assets}
              duration={duration}
              playhead={playhead}
              chapters={chapters}
              ticks={chapterTicks(shownChapters, duration)}
              onSeek={seek}
              onScrub={setScrubbing}
            />
            <div className={row}>
              <Tip label={E.playTip[playState]}>
                <ActionButton isQuiet staticColor="white" size="L" aria-label={E.playLabel[playState]} onPress={playPause}>
                  <PlayIcon />
                </ActionButton>
              </Tip>
              <Tip label={`${CHAPTER_COPY.prev} ${keyLabel('⇧←', MAC)}`}>
                <ActionButton
                  isQuiet
                  staticColor="white"
                  aria-label={CHAPTER_COPY.prev}
                  isDisabled={noChapters}
                  onPress={() => seek(prevChapterStart(chapters, useEditor.getState().playhead))}>
                  <ChevronDoubleLeft />
                </ActionButton>
              </Tip>
              <Tip label={`${CHAPTER_COPY.next} ${keyLabel('⇧→', MAC)}`}>
                <ActionButton
                  isQuiet
                  staticColor="white"
                  aria-label={CHAPTER_COPY.next}
                  isDisabled={noChapters}
                  onPress={() => seek(nextChapterStart(chapters, useEditor.getState().playhead))}>
                  <ChevronDoubleRight />
                </ActionButton>
              </Tip>
              {/* 音量：钮常驻，滑杆悬停、聚焦或拖动时展开——控件行不为一条平时用不到的杆常年占 80px。 */}
              <div className="bc-fsp-volume" data-dragging={volumeDragging || undefined}>
                <Tip label={level.muted ? P.unmuteTip : P.muteTip}>
                  <ActionButton isQuiet staticColor="white" aria-label={level.muted ? P.unmute : P.mute} onPress={() => setLevel(toggleMute(level))}>
                    <VolumeIcon />
                  </ActionButton>
                </Tip>
                <div className="bc-fsp-volume-slider">
                  <Slider
                    size="S"
                    aria-label={P.volume}
                    styles={volumeSlider}
                    minValue={0}
                    maxValue={100}
                    step={5}
                    value={level.muted ? 0 : level.volume}
                    onChange={(volume) => {
                      setVolumeDragging(true);
                      setLevel({ volume, muted: volume === 0 });
                    }}
                    onChangeEnd={() => setVolumeDragging(false)}
                  />
                </div>
              </div>
              <span className={`${clock} bc-tabular`} aria-label={E.playhead}>
                {formatTenths(playhead)}
                <span className={clockTotal}> / {formatTenths(duration)}</span>
              </span>
              <div className={spacer} />
              <MenuTrigger align="end" direction="top" onOpenChange={(open) => setPopup(open ? 'captions' : null)}>
                <Tip label={F.captionsTip(F.captionMode[mode])}>
                  <ActionButton isQuiet staticColor="white" aria-label={F.captions}>
                    <CloseCaptions />
                  </ActionButton>
                </Tip>
                <Menu aria-label={F.captions}>
                  <MenuSection
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[mode]}
                    onSelectionChange={(keys) => {
                      const [next] = keys === 'all' ? [] : [...keys];
                      if (next !== undefined) setPicked(next as CaptionMode);
                    }}>
                    <Header>{F.captions}</Header>
                    {modes.map((m) => {
                      const sub = captionSub(m);
                      return (
                        <MenuItem key={m} id={m} textValue={F.captionMode[m]}>
                          <Text slot="label">{F.captionMode[m]}</Text>
                          {sub ? <Text slot="description">{sub}</Text> : null}
                        </MenuItem>
                      );
                    })}
                  </MenuSection>
                </Menu>
              </MenuTrigger>
              <MenuTrigger align="end" direction="top" onOpenChange={(open) => setPopup(open ? 'rate' : null)}>
                <Tip label={P.rate}>
                  <ActionButton staticColor="white" aria-label={P.rateCurrent(rate)}>
                    <Text UNSAFE_className="bc-tabular">{`${rate}×`}</Text>
                  </ActionButton>
                </Tip>
                <Menu
                  aria-label={P.rate}
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[String(rate)]}
                  onSelectionChange={(keys) => {
                    const [next] = keys === 'all' ? [] : [...keys];
                    if (next !== undefined) setRate(Number(next));
                  }}>
                  {PLAYBACK_RATES.map((r) => (
                    <MenuItem key={r} id={String(r)} textValue={`${r}×`}>
                      {r === 1 ? P.rateNormal : `${r}×`}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
              <Tip label={F.keysTip}>
                <ToggleButton isQuiet staticColor="white" aria-label={F.keysTitle} isSelected={keysOpen} onChange={setKeysOpen}>
                  <HelpCircle />
                </ToggleButton>
              </Tip>
              <Tip label={P.exitFullscreen}>
                <ActionButton isQuiet staticColor="white" aria-label={P.exitFullscreen} onPress={exitPreviewFullscreen}>
                  <FullScreenExit />
                </ActionButton>
              </Tip>
            </div>
          </div>
        </Provider>
      </div>
    </UNSAFE_PortalProvider>
  );
}

/**
 * 进度条（react-aria 的 Slider：拖动、键盘与读屏都是它的）。上面画章节刻痕；悬停或拖动时冒一个气泡——一格画面、松手会落到的时码、
 * 那一刻在哪一章。气泡跟着指针走，不跟着播放头：它是「松手会落到哪一帧」的预告。
 */
function SeekBar({
  sequence,
  assets,
  duration,
  playhead,
  chapters,
  ticks,
  onSeek,
  onScrub,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  duration: number;
  playhead: number;
  chapters: readonly ChapterSpan[];
  ticks: number[];
  onSeek(seconds: number): void;
  onScrub(scrubbing: boolean): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const timeOf = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? timeAt(clientX, rect, duration) : 0;
  };
  const max = duration || 1;
  return (
    <AriaSlider
      aria-label={P.position}
      className="bc-fsp-seek"
      data-active={dragging || undefined}
      minValue={0}
      maxValue={max}
      step={0.01}
      isDisabled={!(duration > 0)}
      value={Math.min(playhead, max)}
      onChange={(seconds) => {
        if (!dragging) {
          setDragging(true);
          onScrub(true);
        }
        setHover(seconds);
        onSeek(seconds);
      }}
      onChangeEnd={(seconds) => {
        onSeek(seconds);
        setDragging(false);
        onScrub(false);
        if (!inside.current) setHover(null);
      }}
      formatOptions={{ style: 'unit', unit: 'second', unitDisplay: 'long', maximumFractionDigits: 0 }}>
      <SliderTrack
        ref={trackRef}
        className="bc-fsp-seek-track"
        onPointerEnter={() => (inside.current = true)}
        onPointerMove={(event) => setHover(timeOf(event.clientX))}
        onPointerLeave={() => {
          inside.current = false;
          if (!dragging) setHover(null);
        }}>
        {({ state }) => (
          <>
            <div className="bc-fsp-seek-rail">
              <div className={`bc-fsp-seek-fill ${seekFill}`} style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
              {ticks.map((at) => (
                <i key={at} className="bc-fsp-seek-tick" style={{ left: `${at * 100}%` }} />
              ))}
            </div>
            <SliderThumb className="bc-fsp-seek-thumb" />
            {hover === null ? null : (
              <SeekBubble sequence={sequence} assets={assets} chapters={chapters} seconds={hover} left={seekFraction(hover, duration)} />
            )}
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}

function SeekBubble({
  sequence,
  assets,
  chapters,
  seconds,
  left,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  chapters: readonly ChapterSpan[];
  seconds: number;
  left: number;
}) {
  const media = useRuntime().videos.media;
  useSyncExternalStore(media.subscribe, media.version);
  const frame = seekFrame(sequence, assets, seconds);
  const url = frame ? media.thumbnail(frame.asset, frame.at) : null;
  const size = previewSize(sequence.canvas);
  const chapter = chapters[chapterAt(chapters, seconds)];
  return (
    <div className="bc-fsp-bubble" style={{ left: `${left * 100}%` }} aria-hidden>
      <div className="bc-fsp-bubble-frame" style={{ width: size.width, height: size.height, backgroundImage: url ? `url("${url}")` : undefined }} />
      <span className={`${bubbleTime} bc-tabular`}>{formatTenths(seconds)}</span>
      {chapter ? <span className={bubbleChapter}>{chapter.title}</span> : null}
    </div>
  );
}

/** 字幕档位下面那行小字：原文与译文各是哪种语言（项目里可能有好几门译文，只写「译文」得切过去才知道是哪一门）。 */
function captionLanguages(sequence: Sequence, documents: Record<Id, DocumentRecord>): { original: string | null; translation: string | null } {
  const names = { original: new Set<string>(), translation: new Set<string>() };
  for (const chip of captionChips(sequence, documents)) {
    if (chip.state !== 'on') continue;
    const language = documents[chip.documentId]?.language;
    names[chip.kind].add(language ? languageName(language) : chip.name);
  }
  const join = (set: Set<string>) => (set.size ? [...set].join(' · ') : null);
  return { original: join(names.original), translation: join(names.translation) };
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger placement="top">
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
