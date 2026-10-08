import { useEffect, useRef, useState, useCallback } from 'react';
import type { MediaHandle } from '@baocut/protocol';
import {
  ActionButton,
  CustomDialog,
  DialogContainer,
  DialogTrigger,
  Popover,
  MenuTrigger,
  Menu,
  MenuItem,
  MenuSection,
  Header,
  Text,
  Slider,
  ToastQueue,
} from '@react-spectrum/s2';
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider';
import Play from '@react-spectrum/s2/icons/Play';
import Pause from '@react-spectrum/s2/icons/Pause';
import More from '@react-spectrum/s2/icons/More';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import FullScreenExit from '@react-spectrum/s2/icons/FullScreenExit';
import Close from '@react-spectrum/s2/icons/Close';
import { P } from '../player/player-copy.ts';
import { IMAGE as M } from '../image-preview-copy.ts';
import { S } from '../shell-copy.ts';
import { pauseOtherPreviews } from '../../model/image-preview.ts';
import { usePlayer } from '../../state/player-store.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { KIND_LABEL } from '../../model/space.ts';
import { mediaTheme } from './theme.tsx';
import './media.css';

export interface PreviewPlayback {
  time: number;
  volume: number;
  muted: boolean;
  rate: number;
  paused: boolean;
}
const positions = new Map<string, PreviewPlayback>();
const transfers = new Set<string>();
const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const clock = (n: number) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`;
export function downloadPreview(handle: MediaHandle, name = handle.fileName) {
  const url = new URL(handle.url, location.href);
  if (url.protocol === 'http:' || url.protocol === 'https:') url.searchParams.set('download', '1');
  const link = document.createElement('a');
  link.href = url.href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
export function CompactPlayer({
  handle,
  fileName,
  kind,
  memoryKey,
  active = true,
  onOpenTab,
  path,
  subtitles,
}: {
  handle: MediaHandle;
  fileName: string;
  kind: 'audio' | 'video';
  memoryKey: string;
  active?: boolean;
  onOpenTab?: () => void;
  path?: string;
  subtitles?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false),
    [showSubtitles, setShowSubtitles] = useState(false);
  const close = () => {
    transfers.add(memoryKey);
    setExpanded(false);
    setShowSubtitles(false);
  };
  return (
    <>
      <PlayerSurface
        {...{ handle, fileName, kind, memoryKey, path, onOpenTab }}
        active={active && !expanded && !showSubtitles}
        restoreKey={expanded || showSubtitles}
        onExpand={() => setExpanded(true)}
        onSubtitles={subtitles ? () => setShowSubtitles(true) : undefined}
      />
      {(expanded || showSubtitles) && (
        <DialogContainer onDismiss={close}>
          <CustomDialog size="fullscreen" padding="none" aria-label={fileName} UNSAFE_className={`${mediaTheme} bc-media-dialog`}>
            <header>
              <strong>{fileName}</strong>
              <ActionButton aria-label={M.cancel} onPress={close}>
                <Close />
              </ActionButton>
            </header>
            {showSubtitles ? subtitles : <PlayerSurface {...{ handle, fileName, kind, memoryKey, path }} active={active} />}
          </CustomDialog>
        </DialogContainer>
      )}
    </>
  );
}
function PlayerSurface({
  handle,
  fileName,
  kind,
  memoryKey,
  active,
  restoreKey,
  onOpenTab,
  onExpand,
  onSubtitles,
  path,
}: {
  handle: MediaHandle;
  fileName: string;
  kind: 'audio' | 'video';
  memoryKey: string;
  active: boolean;
  restoreKey?: boolean;
  onOpenTab?: () => void;
  onExpand?: () => void;
  onSubtitles?: () => void;
  path?: string;
}) {
  const element = useRef<HTMLVideoElement>(null),
    root = useRef<HTMLElement>(null),
    handedOff = useRef(false),
    initialized = useRef(false),
    scrub = useRef<boolean | null>(null);
  const [state, setState] = useState({ time: 0, duration: 0, paused: true, volume: 1, muted: false, rate: 1, ready: false });
  const [error, setError] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [pip, setPip] = useState(false),
    [attempt, setAttempt] = useState(0);
  const runtime = useRuntime();
  const [playbackUrl, setPlaybackUrl] = useState<string | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    initialized.current = false;
    setState(current => ({ ...current, ready: false, paused: true }));
    setPlaybackUrl(undefined);
    setError(false);
    void runtime.playbackMedia(handle, controller.signal).then(
      media => { if (!controller.signal.aborted) setPlaybackUrl(media.url); },
      () => { if (!controller.signal.aborted) setError(true); },
    );
    return () => controller.abort();
  }, [runtime, handle.url, attempt]);
  const report = (e: unknown) => ToastQueue.negative(S.filePreview.failed(e instanceof Error ? e.message : M.unavailable));
  const snapshot = (e: HTMLMediaElement): PreviewPlayback => ({
    time: e.currentTime,
    volume: e.volume,
    muted: e.muted,
    rate: e.playbackRate,
    paused: e.paused,
  });
  const read = () => {
    const e = element.current;
    if (e) {
      setState({ ...snapshot(e), duration: Number.isFinite(e.duration) ? e.duration : 0, ready: e.readyState > 0 });
      if (initialized.current && !handedOff.current) positions.set(memoryKey, snapshot(e));
    }
  };
  const restore = () => {
    const e = element.current,
      saved = positions.get(memoryKey);
    if (!e) return;
    if (!saved) {
      initialized.current = true;
      read();
      return;
    }
    e.currentTime = Math.min(saved.time, Number.isFinite(e.duration) ? e.duration : saved.time);
    e.volume = saved.volume;
    e.muted = saved.muted;
    e.playbackRate = saved.rate;
    if (transfers.delete(memoryKey) && !saved.paused && active) void e.play().catch(report);
    handedOff.current = false;
    initialized.current = true;
    read();
  };
  useEffect(() => {
    if (!active) element.current?.pause();
    else if (element.current?.readyState) restore();
  }, [active, restoreKey]);
  useEffect(() => {
    const e = element.current;
    return () => {
      if (e) {
        if (!handedOff.current) {
          positions.set(memoryKey, snapshot(e));
          usePlayer.getState().remember(memoryKey, e.currentTime);
        }
        e.pause();
      }
    };
  }, [memoryKey, attempt]);
  useEffect(() => {
    const e = element.current;
    const full = () => setFullscreen(document.fullscreenElement === root.current),
      enter = () => setPip(true),
      leave = () => setPip(false);
    document.addEventListener('fullscreenchange', full);
    e?.addEventListener('enterpictureinpicture', enter);
    e?.addEventListener('leavepictureinpicture', leave);
    return () => {
      document.removeEventListener('fullscreenchange', full);
      e?.removeEventListener('enterpictureinpicture', enter);
      e?.removeEventListener('leavepictureinpicture', leave);
    };
  }, [attempt]);
  const handoff = (action?: () => void) => {
    const e = element.current;
    if (!e || !action) return;
    positions.set(memoryKey, snapshot(e));
    usePlayer.getState().remember(memoryKey, e.currentTime);
    transfers.add(memoryKey);
    handedOff.current = true;
    e.pause();
    void (async () => {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      if (document.pictureInPictureElement === e) await document.exitPictureInPicture();
      action();
    })().catch((error) => {
      transfers.delete(memoryKey);
      handedOff.current = false;
      report(error);
    });
  };
  const toggle = () => {
    const e = element.current;
    if (e) e.paused ? void e.play().catch(report) : e.pause();
  };
  const portal = useCallback(() => (fullscreen ? root.current : document.body), [fullscreen]);
  const seek = (value: number) => {
    if (element.current) {
      element.current.currentTime = value;
      read();
    }
  };
  const end = () => {
    const resume = scrub.current;
    scrub.current = null;
    if (resume && active) void element.current?.play().catch(report);
  };
  const progress = (
    <div
      className="bc-media-seek"
      onPointerDownCapture={() => {
        if (scrub.current === null && element.current) {
          scrub.current = !element.current.paused;
          element.current.pause();
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <Slider
        size="S"
        aria-label={P.position}
        value={Math.min(state.time, state.duration || 1)}
        minValue={0}
        maxValue={state.duration || 1}
        step={0.1}
        isDisabled={!state.ready || error}
        isEmphasized={kind === 'audio'}
        UNSAFE_className="bc-media-slider"
        onChange={seek}
        onChangeEnd={end}
      />
    </div>
  );
  const play = (
    <ActionButton size="XS" isQuiet aria-label={state.paused ? P.play : P.pause} isDisabled={!state.ready || error} onPress={toggle}>
      {state.paused ? <Play /> : <Pause />}
    </ActionButton>
  );
  const menu = (
    <MenuTrigger align="end" direction={kind === 'audio' ? 'bottom' : 'top'}>
      <ActionButton size="XS" isQuiet aria-label={M.more}>
        <More />
      </ActionButton>
      <Menu
        size="S"
        onAction={(key) => {
          if (key === 'save') downloadPreview(handle, fileName);
          if (key === 'copy') void navigator.clipboard.writeText(path || fileName).catch(report);
          if (key === 'pip') {
            const e = element.current;
            if (e)
              void (document.pictureInPictureElement === e ? document.exitPictureInPicture() : e.requestPictureInPicture()).catch(report);
          }
          if (key === 'expand') handoff(onExpand);
          if (key === 'tab') handoff(onOpenTab);
          if (key === 'subtitles') handoff(onSubtitles);
        }}
      >
        <MenuSection>
          {kind === 'audio' && <MenuItem id="copy">{M.copyPath}</MenuItem>}
          <MenuItem id="save">{M.saveCopy}</MenuItem>
        </MenuSection>
        {kind === 'video' && (
          <MenuSection
            selectionMode="single"
            selectedKeys={[String(state.rate)]}
            onSelectionChange={(keys) => {
              const rate = Number([...keys][0]);
              if (element.current && rates.includes(rate)) element.current.playbackRate = rate;
            }}
          >
            <Header>{P.rate}</Header>
            {rates.map((rate) => (
              <MenuItem key={rate} id={String(rate)} isDisabled={error}>
                <Text slot="label">{rate}×</Text>
              </MenuItem>
            ))}
          </MenuSection>
        )}
        {kind === 'video' && (
          <MenuSection>
            <MenuItem id="pip" isDisabled={!document.pictureInPictureEnabled || !element.current?.requestPictureInPicture || error}>
              {M.pip}
            </MenuItem>
            {onExpand && !fullscreen && !pip && <MenuItem id="expand">{M.fullPreview}</MenuItem>}
            {onOpenTab && <MenuItem id="tab">{M.openTab}</MenuItem>}
            {onSubtitles && <MenuItem id="subtitles">{P.subtitles}</MenuItem>}
          </MenuSection>
        )}
      </Menu>
    </MenuTrigger>
  );
  return (
    <UNSAFE_PortalProvider getContainer={portal}>
      <section ref={root} className={`${mediaTheme} bc-media-player bc-media-${kind}`} aria-label={fileName}>
        <video
          key={attempt}
          ref={element}
          src={playbackUrl}
          preload="metadata"
          playsInline
          hidden={kind === 'audio'}
          data-bc-media-preview=""
          aria-label={fileName}
          onLoadedMetadata={restore}
          onDurationChange={read}
          onTimeUpdate={read}
          onPause={read}
          onEnded={read}
          onVolumeChange={read}
          onRateChange={read}
          onPlay={(event) => {
            handedOff.current = false;
            pauseOtherPreviews(event.currentTarget);
            read();
          }}
          onError={() => setError(true)}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === ' ') {
              e.preventDefault();
              toggle();
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              seek(Math.max(0, Math.min(state.duration, state.time + (e.key === 'ArrowLeft' ? -5 : 5))));
            }
          }}
          tabIndex={kind === 'video' ? 0 : -1}
        />
        {kind === 'audio' && (
          <div className="bc-media-audio-head">
            <span className="bc-media-audio-icon">
              <AudioWave />
            </span>
            <span className="bc-media-audio-name">
              <strong title={fileName}>{fileName}</strong>
              <small>
                {(fileName.split('.').pop() || handle.mimeType.split('/').pop())?.toUpperCase()} {KIND_LABEL.audio}
              </small>
            </span>
            {play}
            {menu}
          </div>
        )}
        {error ? (
          <div role="status" className="bc-media-error">
            {P.mediaError.decode}
            <ActionButton
              onPress={() => {
                setError(false);
                setAttempt((n) => n + 1);
              }}
            >
              {M.retry}
            </ActionButton>
          </div>
        ) : (
          <div className="bc-media-controls">
            {kind === 'video' && play}
            {progress}
            <span className="bc-media-clock">
              {clock(state.time)} / {clock(state.duration)}
            </span>
            {kind === 'video' && (
              <>
                <DialogTrigger>
                  <ActionButton size="XS" isQuiet aria-label={P.volume}>
                    {state.muted || !state.volume ? <VolumeOff /> : <VolumeTwo />}
                  </ActionButton>
                  <Popover
                    placement="top"
                    hideArrow
                    padding="none"
                    UNSAFE_className={`${mediaTheme} bc-media-volume`}
                    aria-label={P.volume}
                  >
                    <ActionButton
                      size="XS"
                      isQuiet
                      aria-label={state.muted ? P.unmute : P.mute}
                      onPress={() => {
                        if (element.current) element.current.muted = !state.muted;
                      }}
                    >
                      {state.muted ? <VolumeOff /> : <VolumeTwo />}
                    </ActionButton>
                    <Slider
                      size="S"
                      aria-label={P.volume}
                      minValue={0}
                      maxValue={1}
                      step={0.05}
                      value={state.muted ? 0 : state.volume}
                      formatOptions={{ style: 'percent' }}
                      UNSAFE_className="bc-media-slider"
                      onChange={(value) => {
                        if (element.current) {
                          element.current.volume = value;
                          element.current.muted = false;
                        }
                      }}
                    />
                  </Popover>
                </DialogTrigger>
                {menu}
                <ActionButton
                  size="XS"
                  isQuiet
                  aria-label={fullscreen ? P.exitFullscreen : P.fullscreen}
                  isDisabled={pip}
                  onPress={() => {
                    const pending = fullscreen ? document.exitFullscreen?.() : root.current?.requestFullscreen?.();
                    if (pending) void pending.catch(report);
                    else ToastQueue.negative(M.unavailable);
                  }}
                >
                  {fullscreen ? <FullScreenExit /> : <FullScreen />}
                </ActionButton>
              </>
            )}
          </div>
        )}
      </section>
    </UNSAFE_PortalProvider>
  );
}
