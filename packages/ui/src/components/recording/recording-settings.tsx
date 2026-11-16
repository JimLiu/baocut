import { useEffect, useState } from 'react';
import { ActionButton, Button, SegmentedControl, SegmentedControlItem, Switch } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { RecordingShortcutKey } from '../../host.ts';
import { COUNTDOWNS, RECORDING_FPS } from '../../model/recording.ts';
import { acceleratorLabel, acceleratorOf, lacksModifier } from '../../model/recording-shortcuts.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { AFTER_DISCARD, MAIN_WINDOW, SHORTCUT_KEYS, useRecordingPrefs } from '../../state/recordings-store.ts';
import { Group, Row } from '../settings/general-settings.tsx';
import { RC } from './recording-copy.ts';

/*
 * 设置 › 通用 › 屏幕录制（屏幕录制设计 §11「设置」）：倒计时、没有麦克风时先确认、开始录制时主窗口、丢弃之后、缺省帧率、菜单栏图标，
 * 与七个全局快捷键（缺省都不设，每个都要带 ⌘、⌥ 或 ⌃）。只有宿主管录制时（桌面端）才有这一组；记在本机（localStorage），
 * 交给主进程的那几项由 RecordingHost 交。倒计时与录制卡齿轮菜单改的是同一项。
 */

const keyLabel = style({ minWidth: 72, textAlign: 'center', font: 'code-sm', color: 'gray-900' });
const keyEmpty = style({ minWidth: 72, textAlign: 'center', font: 'ui', color: 'gray-600' });
const keyError = style({ font: 'ui-sm', color: 'red-900' });

const SHORTCUT_ROWS: Record<RecordingShortcutKey, { label: () => string; desc?: () => string }> = {
  launcher: { label: () => RC.shortcutLauncher },
  display: { label: () => RC.shortcutDisplay, desc: () => RC.shortcutDisplayHint },
  window: { label: () => RC.shortcutWindow },
  area: { label: () => RC.shortcutArea },
  stop: { label: () => RC.shortcutStop },
  pause: { label: () => RC.shortcutPause },
  restart: { label: () => RC.shortcutRestart },
};

export function RecordingSettingsGroup() {
  const host = useRuntime().host;
  const p = useRecordingPrefs();
  if (!host.recording) return null;
  return (
    <>
      <Group title={RC.settingsGroup}>
        <Row label={RC.countdown} desc={RC.countdownHint}>
          <SegmentedControl aria-label={RC.countdown} selectedKey={String(p.choice.countdown)} onSelectionChange={(key) => p.setCountdown(Number(key))}>
            {COUNTDOWNS.map((n) => (
              <SegmentedControlItem key={n} id={String(n)}>
                {n ? RC.countdownSeconds(n) : RC.countdownOff}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Row>
        <Row label={RC.confirmNoMic} desc={RC.confirmNoMicHint}>
          <Switch aria-label={RC.confirmNoMic} isSelected={p.confirmNoMic} onChange={p.setConfirmNoMic} />
        </Row>
        <Row label={RC.mainWindow} desc={RC.mainWindowHint}>
          <SegmentedControl aria-label={RC.mainWindow} selectedKey={p.mainWindow} onSelectionChange={(key) => p.setMainWindow(key as (typeof MAIN_WINDOW)[number])}>
            {MAIN_WINDOW.map((k) => (
              <SegmentedControlItem key={k} id={k}>
                {k === 'background' ? RC.mainWindowBackground : RC.mainWindowMinimize}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Row>
        <Row label={RC.afterDiscard}>
          <SegmentedControl aria-label={RC.afterDiscard} selectedKey={p.afterDiscard} onSelectionChange={(key) => p.setAfterDiscard(key as (typeof AFTER_DISCARD)[number])}>
            {AFTER_DISCARD.map((k) => (
              <SegmentedControlItem key={k} id={k}>
                {k === 'none' ? RC.afterDiscardNone : RC.afterDiscardLauncher}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Row>
        <Row label={RC.defaultFps} desc={RC.defaultFpsHint}>
          <SegmentedControl aria-label={RC.defaultFps} selectedKey={String(p.fps)} onSelectionChange={(key) => p.setFps(Number(key))}>
            {RECORDING_FPS.map((n) => (
              <SegmentedControlItem key={n} id={String(n)}>
                {RC.fpsValue(n)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Row>
        <Row label={RC.trayIcon} desc={RC.trayIconHint}>
          <Switch aria-label={RC.trayIcon} isSelected={p.trayIcon} onChange={p.setTrayIcon} />
        </Row>
      </Group>
      <Group title={RC.shortcutsGroup} lead={RC.shortcutHint}>
        {SHORTCUT_KEYS.map((k) => (
          <ShortcutRow key={k} which={k} label={SHORTCUT_ROWS[k].label()} desc={SHORTCUT_ROWS[k].desc?.()} platform={host.platform} />
        ))}
      </Group>
    </>
  );
}

function ShortcutRow({ which, label, desc, platform }: { which: RecordingShortcutKey; label: string; desc?: string; platform: string }) {
  const value = useRecordingPrefs((s) => s.shortcuts[which]);
  // 别的几个用着的组合：撞了的不收（两个都要同一组键时只有一个能注册上）。
  const others = useRecordingPrefs((s) =>
    SHORTCUT_KEYS.filter((k) => k !== which)
      .map((k) => s.shortcuts[k])
      .join('\n'),
  );
  const setShortcut = useRecordingPrefs((s) => s.setShortcut);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setListening(false);
        setError(null);
        return;
      }
      if (lacksModifier(event)) return void setError(platform === 'darwin' ? RC.shortcutNeedsModifierMac : RC.shortcutNeedsModifierPc);
      const accel = acceleratorOf(event, platform);
      if (!accel) return;
      if (others.split('\n').includes(accel)) return void setError(RC.shortcutTaken);
      setShortcut(which, accel);
      setListening(false);
      setError(null);
    };
    const stop = () => setListening(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', stop);
    };
  }, [listening, others, platform, setShortcut, which]);

  return (
    <Row label={label} desc={desc}>
      {error && listening ? (
        <span className={keyError} role="alert">
          {error}
        </span>
      ) : null}
      <Button
        variant="secondary"
        size="S"
        aria-label={RC.shortcutFor(label)}
        onPress={() => {
          setListening((v) => !v);
          setError(null);
        }}>
        <span className={value || listening ? keyLabel : keyEmpty} aria-live="polite">
          {listening ? RC.shortcutPress : value ? acceleratorLabel(value, platform) : RC.shortcutNone}
        </span>
      </Button>
      {value && !listening ? (
        <ActionButton size="S" isQuiet aria-label={RC.shortcutClearFor(label)} onPress={() => setShortcut(which, '')}>
          <Close />
        </ActionButton>
      ) : null}
    </Row>
  );
}
