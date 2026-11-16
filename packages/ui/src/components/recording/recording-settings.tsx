import { useEffect, useState } from 'react';
import { ActionButton, Button, Picker, PickerItem, SegmentedControl, SegmentedControlItem, Switch } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { COUNTDOWNS, RECORDING_FPS } from '../../model/recording.ts';
import { acceleratorLabel, acceleratorOf } from '../../model/recording-shortcuts.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { DEFAULT_SHORTCUTS, useRecordingPrefs, type RecordingShortcuts } from '../../state/recordings-store.ts';
import { Group, Row } from '../settings/general-settings.tsx';
import { RC } from './recording-copy.ts';

/*
 * 设置 › 通用 › 屏幕录制（屏幕录制设计 §11「设置」）：开始、停止、暂停与继续三个全局快捷键，缺省帧率与倒计时，以及录制时
 * 收起 BaoCut。只有宿主管录制时（桌面端）才有这一组；记在本机（localStorage），快捷键与收起由 RecordingHost 交给主进程。
 * 缺省倒计时就是面板记住的那一项，两处改的是同一个值。
 */

const countdownPicker = style({ width: 160 });
const keyLabel = style({ minWidth: 72, textAlign: 'center', font: 'ui', fontWeight: 'medium', color: 'gray-900', fontVariantNumeric: 'tabular-nums' });

export function RecordingSettingsGroup() {
  const host = useRuntime().host;
  const hideWindow = useRecordingPrefs((s) => s.hideWindow);
  const setHideWindow = useRecordingPrefs((s) => s.setHideWindow);
  const fps = useRecordingPrefs((s) => s.fps);
  const setFps = useRecordingPrefs((s) => s.setFps);
  const countdown = useRecordingPrefs((s) => s.choice.countdown);
  const setCountdown = useRecordingPrefs((s) => s.setCountdown);
  if (!host.recording) return null;
  return (
    <Group title={RC.settingsGroup} lead={RC.shortcutHint}>
      <ShortcutRow which="start" label={RC.shortcutStart} desc={RC.shortcutStartHint} platform={host.platform} />
      <ShortcutRow which="stop" label={RC.shortcutStop} platform={host.platform} />
      <ShortcutRow which="pause" label={RC.shortcutPause} platform={host.platform} />
      <Row label={RC.defaultFps} desc={RC.defaultFpsHint}>
        <SegmentedControl aria-label={RC.defaultFps} selectedKey={String(fps)} onSelectionChange={(key) => setFps(Number(key))}>
          {RECORDING_FPS.map((n) => (
            <SegmentedControlItem key={n} id={String(n)}>
              {RC.fpsValue(n)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </Row>
      <Row label={RC.countdown} desc={RC.defaultCountdownHint}>
        <Picker
          size="S"
          aria-label={RC.countdown}
          selectedKey={String(countdown)}
          onSelectionChange={(key) => key !== null && setCountdown(Number(key))}
          styles={countdownPicker}>
          {COUNTDOWNS.map((n) => (
            <PickerItem key={n} id={String(n)}>
              {n ? RC.countdownSeconds(n) : RC.countdownNone}
            </PickerItem>
          ))}
        </Picker>
      </Row>
      <Row label={RC.hideWindow} desc={RC.hideWindowHint}>
        <Switch aria-label={RC.hideWindow} isSelected={hideWindow} onChange={setHideWindow} />
      </Row>
    </Group>
  );
}

function ShortcutRow({ which, label, desc, platform }: { which: keyof RecordingShortcuts; label: string; desc?: string; platform: string }) {
  const value = useRecordingPrefs((s) => s.shortcuts[which]);
  // 别的两个用着的组合：撞了的不收（两个都要同一组键时只有一个能注册上）。
  const others = useRecordingPrefs((s) =>
    (Object.keys(s.shortcuts) as Array<keyof RecordingShortcuts>)
      .filter((k) => k !== which)
      .map((k) => s.shortcuts[k])
      .join('\n'),
  );
  const setShortcut = useRecordingPrefs((s) => s.setShortcut);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setListening(false);
        return;
      }
      const accel = acceleratorOf(event, platform);
      if (!accel) return;
      if (others.split('\n').includes(accel)) return;
      setShortcut(which, accel);
      setListening(false);
    };
    const stop = () => setListening(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', stop);
    };
  }, [listening, others, platform, setShortcut, which]);

  const shown = listening ? RC.shortcutPress : value ? acceleratorLabel(value, platform) : RC.shortcutNone;
  return (
    <Row label={label} desc={desc}>
      <span className={keyLabel} aria-live="polite">
        {shown}
      </span>
      <Button variant="secondary" size="S" onPress={() => setListening((v) => !v)}>
        {listening ? RC.cancel : RC.shortcutChange}
      </Button>
      <ActionButton size="S" isQuiet isDisabled={!value} onPress={() => setShortcut(which, '')}>
        {RC.shortcutClear}
      </ActionButton>
      <ActionButton size="S" isQuiet isDisabled={value === DEFAULT_SHORTCUTS[which]} onPress={() => setShortcut(which, DEFAULT_SHORTCUTS[which])}>
        {RC.shortcutReset}
      </ActionButton>
    </Row>
  );
}
