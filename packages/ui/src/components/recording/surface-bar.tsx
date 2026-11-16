import { useLayoutEffect, useRef, useState } from 'react';
import type { RecordingStreamStatus } from '@baocut/protocol';
import { ActionButton, Button, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Close from '@react-spectrum/s2/icons/Close';
import Delete from '@react-spectrum/s2/icons/Delete';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import type { RecordingBarAction } from '../../host.ts';
import { barActions, barStatus, canPreview, choiceFromOptions, DEFAULT_CHOICE, lowDisk } from '../../model/recording.ts';
import { deviceName, useMicLevel } from './recording-media.ts';
import { RS } from './recording-surface-copy.ts';
import { useSurface } from './recording-surface.tsx';
import { DragDots } from './surface-parts.tsx';

/*
 * 控制条（屏幕录制设计 §11「控制条」）：透明、置顶、不抢焦点、不被录进去的小窗，宽 320。条高 40：停止 + 计时（倒计时的数字也在这里）、
 * 麦克风电平、暂停 / 继续、重新开始、丢弃、拖动把手。条上方是警示卡（磁盘快满、设备断开、睡眠时自动暂停）与重新开始、丢弃的确认；它们出现时小窗变高，
 * 底边不动。
 */

const ROLE_NAME: Record<RecordingStreamStatus['role'], () => string> = {
  screen: () => RS.roleScreen,
  camera: () => RS.roleCamera,
  microphone: () => RS.roleMicrophone,
  'system-audio': () => RS.roleSystemAudio,
  pointer: () => RS.rolePointer,
  keyboard: () => RS.roleKeyboard,
};

export function SurfaceBar() {
  const s = useSurface();
  const r = s.state.recording!;
  const [ask, setAsk] = useState<'restart' | 'discard' | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const winRef = useRef<HTMLDivElement>(null);
  const status = barStatus(r);
  const acts = barActions(r.state);
  const paused = r.state === 'paused';
  const live = r.state === 'recording' || r.state === 'paused';
  const sources = s.sources;
  const micName = deviceName(sources, 'microphone', r.options.microphone);
  const micOn = !!r.options.microphone && canPreview(sources?.permissions.microphone);
  const level = useMicLevel(micOn && live ? micName : null, sources);

  // 剩余空间读 Runtime 录制中量到的（约每 5 秒一次）；还没量过时用打开启动器时的。
  const diskNow = sources && r.freeBytes !== undefined ? { ...sources, disk: { freeBytes: r.freeBytes } } : sources;
  const disk = live && diskNow ? lowDisk(choiceFromOptions(r.options, DEFAULT_CHOICE), diskNow, r.options.fps) : null;
  const lost = r.streams.filter((x) => x.lost).map((x) => ROLE_NAME[x.role]());
  const alerts: Array<{ key: string; text: string }> = [];
  if (paused && s.state.pausedBySleep) alerts.push({ key: 'slept', text: RS.sleptAlert });
  if (disk) alerts.push({ key: 'disk', text: RS.diskAlert(disk.minutes) });
  if (lost.length) alerts.push({ key: `lost:${lost.join(',')}`, text: RS.lostAlert(lost.join(', ')) });
  const shown = alerts.filter((a) => !gone.includes(a.key));

  // 小窗跟着内容变高（底边不动）。
  useLayoutEffect(() => {
    const el = winRef.current;
    if (!el) return;
    const report = () => void s.act({ type: 'bar-height', height: Math.ceil(el.scrollHeight) });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s, shown.length, ask]);

  const send = (action: RecordingBarAction) => void s.act({ type: 'bar', action });
  const stopLabel =
    status.kind === 'countdown' ? RS.stopCountdown(status.seconds) : status.kind === 'clock' ? RS.stopClock(status.text) : RS.stop;
  const timeText =
    status.kind === 'countdown'
      ? String(status.seconds)
      : status.kind === 'clock'
        ? status.text
        : status.kind === 'starting'
          ? RS.starting
          : status.kind === 'paused'
            ? RS.paused
            : RS.finishing;
  const stopKind = status.kind === 'countdown' ? 'countdown' : status.kind === 'clock' ? 'clock' : 'word';

  return (
    <div className="bc-rbar-win">
      <div ref={winRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
        {shown.map((a) => (
          <div key={a.key} className="bc-rbar-alert" role="alert">
            <span className="bc-rbar-alert__ic">
              <AlertTriangle />
            </span>
            <span className="bc-rbar-alert__t">{a.text}</span>
            <ActionButton isQuiet size="XS" aria-label={RS.dismiss} onPress={() => setGone((g) => [...g, a.key])}>
              <Close />
            </ActionButton>
          </div>
        ))}
        {ask ? (
          <div className="bc-rbar-ask" role="alertdialog" aria-label={ask === 'restart' ? RS.restartTitle : RS.discardTitle}>
            <b>{ask === 'restart' ? RS.restartTitle : RS.discardTitle}</b>
            <span>{ask === 'restart' ? RS.restartBody : RS.discardBody}</span>
            <div className="bc-rbar-ask__row">
              <Button size="S" variant="secondary" onPress={() => setAsk(null)}>
                {RS.keep}
              </Button>
              <Button
                size="S"
                variant="negative"
                autoFocus
                onPress={() => {
                  setAsk(null);
                  send(ask);
                }}>
                {ask === 'restart' ? RS.restart : RS.discard}
              </Button>
            </div>
          </div>
        ) : null}
        <div className={`bc-rbar${paused ? ' is-paused' : ''}`} role="toolbar" aria-label={RS.bar}>
          <TooltipTrigger placement="top">
            <button type="button" className={`bc-rbar__stop bc-rbar__stop--${stopKind}`} disabled={!acts.stop} onClick={() => send('stop')} aria-label={stopLabel}>
              <span className="bc-rbar__sq" aria-hidden="true" />
              <span className="bc-rbar__time" role="status">
                {timeText}
              </span>
            </button>
            <Tooltip>{RS.stop}</Tooltip>
          </TooltipTrigger>
          {micOn ? (
            <span className="bc-rbar__mic" role="img" aria-label={RS.micLevel}>
              {[0.25, 0.5, 0.75, 1].map((t) => (
                <i key={t} className={level >= t * 0.9 ? 'is-lit' : undefined} style={{ height: `${Math.round(4 + t * 12)}px` }} />
              ))}
            </span>
          ) : (
            <span className="bc-rbar__mic is-off" role="img" aria-label={RS.micOff}>
              <Microphone />
            </span>
          )}
          <span className="bc-rbar__sep" aria-hidden="true" />
          <TooltipTrigger placement="top">
            <ActionButton
              isQuiet
              size="S"
              UNSAFE_className={`bc-rbar__btn${paused ? ' is-paused' : ''}`}
              isDisabled={!acts.pause}
              aria-label={paused ? RS.resume : RS.pause}
              onPress={() => send(paused ? 'resume' : 'pause')}>
              {paused ? <Play /> : <Pause />}
            </ActionButton>
            <Tooltip>{paused ? RS.resume : RS.pause}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger placement="top">
            <ActionButton isQuiet size="S" UNSAFE_className="bc-rbar__btn" isDisabled={!acts.restart} aria-label={RS.restart} onPress={() => setAsk('restart')}>
              <Refresh />
            </ActionButton>
            <Tooltip>{RS.restart}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger placement="top">
            <ActionButton isQuiet size="S" UNSAFE_className="bc-rbar__btn" isDisabled={!acts.discard} aria-label={RS.discard} onPress={() => setAsk('discard')}>
              <Delete />
            </ActionButton>
            <Tooltip>{RS.discard}</Tooltip>
          </TooltipTrigger>
          <span className="bc-rbar__grip" role="img" aria-label={RS.grip}>
            <DragDots />
          </span>
        </div>
      </div>
    </div>
  );
}
