import { useEffect, useState } from 'react';
import { ActionButton, Button, Switch } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { acceleratorLabel, acceleratorOf } from '../../model/recording-shortcuts.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { DEFAULT_SHORTCUTS, useRecordingPrefs } from '../../state/recordings-store.ts';
import { Group, Row } from '../settings/general-settings.tsx';
import { RC } from './recording-copy.ts';

/*
 * 设置 › 通用 › 屏幕录制（屏幕录制设计 §11「录制中」）：停止、暂停与继续两个全局快捷键，以及录制时收起 BaoCut。
 * 只有宿主管录制时（桌面端）才有这一组；记在本机（localStorage），由 RecordingHost 交给主进程。
 */

const keyLabel = style({ minWidth: 72, textAlign: 'center', font: 'ui', fontWeight: 'medium', color: 'gray-900', fontVariantNumeric: 'tabular-nums' });

export function RecordingSettingsGroup() {
  const host = useRuntime().host;
  const hideWindow = useRecordingPrefs((s) => s.hideWindow);
  const setHideWindow = useRecordingPrefs((s) => s.setHideWindow);
  if (!host.recording) return null;
  return (
    <Group title={RC.settingsGroup} lead={RC.shortcutHint}>
      <ShortcutRow which="stop" label={RC.shortcutStop} platform={host.platform} />
      <ShortcutRow which="pause" label={RC.shortcutPause} platform={host.platform} />
      <Row label={RC.hideWindow} desc={RC.hideWindowHint}>
        <Switch aria-label={RC.hideWindow} isSelected={hideWindow} onChange={setHideWindow} />
      </Row>
    </Group>
  );
}

function ShortcutRow({ which, label, platform }: { which: 'stop' | 'pause'; label: string; platform: string }) {
  const value = useRecordingPrefs((s) => s.shortcuts[which]);
  const other = useRecordingPrefs((s) => s.shortcuts[which === 'stop' ? 'pause' : 'stop']);
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
      // 与另一个撞了：两个都按这一组时只有一个能注册上，这里不收。
      if (accel === other) return;
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
  }, [listening, other, platform, setShortcut, which]);

  const shown = listening ? RC.shortcutPress : value ? acceleratorLabel(value, platform) : RC.shortcutNone;
  return (
    <Row label={label}>
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
