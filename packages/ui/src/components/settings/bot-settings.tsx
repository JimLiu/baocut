import { useEffect, useMemo, useState } from 'react';
import { BOT_LIMITS, type BotSettings as BotSettingsValue } from '@baocut/protocol';
import { NumberField, Picker, PickerItem, Switch, TextField, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../../runtime/context.tsx';
import { useChannels } from '../../state/channels-store.ts';
import { errorText } from '../bot/bot-actions.ts';
import { BOT_COPY } from '../bot/bot-copy.ts';
import { Group, Row } from './general-settings.tsx';

const C = BOT_COPY.settings;
const zonePicker = style({ width: 260 });
const hours = style({ display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap' });
const timeField = style({ width: 96 });
const numberField = style({ width: 120 });

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function timeZones(current: string | null): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones;
}

/** 「HH:MM」输入框：改完离开时才保存，写法不对就标红、不保存。 */
function ClockField({ label, value, isDisabled, onCommit }: { label: string; value: string; isDisabled: boolean; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const invalid = !CLOCK.test(text);
  return (
    <TextField
      label={label}
      size="S"
      styles={timeField}
      value={text}
      onChange={setText}
      isDisabled={isDisabled}
      isInvalid={invalid}
      errorMessage={C.timeInvalid}
      onBlur={() => {
        if (!invalid && text !== value) onCommit(text);
      }}
    />
  );
}

/**
 * 设置里的 Bot 一节（技术方案 §17、需求 §11.8）：时区、免打扰时段、后台运行与开机启动、卡住判定的分钟数、同时工作的任务数、
 * Make 的自动触发、补充提示，以及暂停全部自动化。值来自 `channels` 主题里的 Bot 设置，改动走 `bot.settings`（暂停走 `bot.pauseAutomation`），回来的事件刷新这里。
 */
export function BotSettings() {
  const runtime = useRuntime();
  const settings = useChannels((s) => s.settings);
  const ready = useChannels((s) => s.ready);
  const [saving, setSaving] = useState(false);
  const system = useMemo(systemZone, []);
  const zones = useMemo(() => timeZones(settings.timeZone), [settings.timeZone]);
  const disabled = !ready || saving;

  const save = async (patch: Partial<BotSettingsValue>) => {
    setSaving(true);
    try {
      const { settings: next } = await runtime.client.request('bot.settings', { patch });
      useChannels.getState().apply({ type: 'bot.settings', settings: next });
    } catch (error) {
      ToastQueue.negative(C.saveFailed(errorText(error)), { timeout: 5000 });
    } finally {
      setSaving(false);
    }
  };

  const pause = async (paused: boolean) => {
    setSaving(true);
    try {
      const result = await runtime.client.request('bot.pauseAutomation', { paused });
      useChannels.getState().apply({ type: 'bot.settings', settings: { ...useChannels.getState().settings, automationPaused: result.paused } });
    } catch (error) {
      ToastQueue.negative(C.saveFailed(errorText(error)), { timeout: 5000 });
    } finally {
      setSaving(false);
    }
  };

  const quiet = settings.quietHours;
  return (
    <Group title={C.group} lead={C.lead}>
      <Row label={C.timeZone} desc={C.timeZoneDesc}>
        <Picker
          size="S"
          aria-label={C.timeZone}
          styles={zonePicker}
          isDisabled={disabled}
          selectedKey={settings.timeZone ?? 'system'}
          onSelectionChange={(key) => void save({ timeZone: key === 'system' ? null : String(key) })}>
          <PickerItem id="system">{C.systemZone(system)}</PickerItem>
          {zones.map((zone) => (
            <PickerItem key={zone} id={zone}>
              {zone}
            </PickerItem>
          ))}
        </Picker>
      </Row>
      <Row
        label={C.quietHours}
        desc={C.quietHoursDesc}
        footer={
          quiet.enabled ? (
            <div className={hours}>
              <ClockField label={C.from} value={quiet.start} isDisabled={disabled} onCommit={(start) => void save({ quietHours: { ...quiet, start } })} />
              <ClockField label={C.to} value={quiet.end} isDisabled={disabled} onCommit={(end) => void save({ quietHours: { ...quiet, end } })} />
            </div>
          ) : undefined
        }>
        <Switch aria-label={C.quietHours} size="S" isSelected={quiet.enabled} isDisabled={disabled} onChange={(enabled) => void save({ quietHours: { ...quiet, enabled } })} />
      </Row>
      <Row label={C.background} desc={C.backgroundDesc}>
        <Switch aria-label={C.background} size="S" isSelected={settings.background} isDisabled={disabled} onChange={(background) => void save({ background })} />
      </Row>
      <Row label={C.openAtLogin} desc={C.openAtLoginDesc}>
        <Switch aria-label={C.openAtLogin} size="S" isSelected={settings.openAtLogin} isDisabled={disabled} onChange={(openAtLogin) => void save({ openAtLogin })} />
      </Row>
      <Row label={C.stall} desc={C.stallDesc}>
        <NumberField
          aria-label={`${C.stall} (${C.minutes})`}
          size="S"
          styles={numberField}
          minValue={1}
          maxValue={24 * 60}
          step={1}
          isDisabled={disabled}
          value={settings.stallMinutes}
          onChange={(stallMinutes) => Number.isFinite(stallMinutes) && stallMinutes !== settings.stallMinutes && void save({ stallMinutes })}
        />
      </Row>
      <Row label={C.maxThreads} desc={C.maxThreadsDesc}>
        <NumberField
          aria-label={C.maxThreads}
          size="S"
          styles={numberField}
          minValue={1}
          maxValue={BOT_LIMITS.maxConcurrentThreads}
          step={1}
          isDisabled={disabled}
          value={settings.maxConcurrentThreads}
          onChange={(maxConcurrentThreads) =>
            Number.isFinite(maxConcurrentThreads) && maxConcurrentThreads !== settings.maxConcurrentThreads && void save({ maxConcurrentThreads })
          }
        />
      </Row>
      <Row label={C.makeAuto} desc={C.makeAutoDesc}>
        <Switch aria-label={C.makeAuto} size="S" isSelected={settings.makeAutoTrigger} isDisabled={disabled} onChange={(makeAutoTrigger) => void save({ makeAutoTrigger })} />
      </Row>
      <Row label={C.supplementHints} desc={C.supplementHintsDesc}>
        <Switch
          aria-label={C.supplementHints}
          size="S"
          isSelected={settings.supplementHints}
          isDisabled={disabled}
          onChange={(supplementHints) => void save({ supplementHints })}
        />
      </Row>
      <Row label={C.pause} desc={C.pauseDesc}>
        <Switch aria-label={C.pause} size="S" isSelected={settings.automationPaused} isDisabled={disabled} onChange={(paused) => void pause(paused)} />
      </Row>
    </Group>
  );
}
