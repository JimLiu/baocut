import { useState } from 'react';
import type { ModelCapabilitiesView } from '@baocut/protocol';
import { NumberField, SegmentedControl, SegmentedControlItem, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  EFFORT_CHOICES,
  effortKey,
  effortModelCount,
  textParameters,
  type EffortKey,
} from '../../model/models-text.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { setTextConcurrency, setTextEffort } from './model-actions.ts';
import { SettingRow } from './model-parts.tsx';
import { TEXT_PARAMS_COPY } from './models-copy.ts';

const concurrencyField = style({ width: 112 });

/**
 * 文本生成的两行参数（设计稿 settings-cloud.jsx:262-269）：「推理强度」分段与「并发请求数」。
 * 存在 Runtime 的能力参数里（`models.setCapabilityParameters`，架构设计 §6.8），新值经 `models` 主题送回；
 * 提交到主题送回之间先显示刚选的值，失败时退回并写原因。
 */
export function TextParamRows({ view, connected }: { view: ModelCapabilitiesView; connected: boolean }) {
  const runtime = useRuntime();
  const parameters = textParameters(view);
  const count = effortModelCount(view);
  const [effort, setEffort] = useState<EffortKey | null>(null);
  const [concurrency, setConcurrency] = useState<number | null>(null);

  const saved = () => ToastQueue.neutral(TEXT_PARAMS_COPY.saved, { timeout: 2000 });
  const failed = (err: Error) => ToastQueue.negative(TEXT_PARAMS_COPY.failed(err.message), { timeout: 5000 });

  const chooseEffort = (key: EffortKey) => {
    if (key === effortKey(parameters.effort)) return;
    setEffort(key);
    setTextEffort(runtime, key)
      .then(saved, failed)
      .finally(() => setEffort(null));
  };

  const changeConcurrency = (value: number) => {
    if (!Number.isFinite(value) || value === parameters.concurrency) return;
    setConcurrency(value);
    setTextConcurrency(runtime, value)
      .then((sent) => sent && saved(), failed)
      .finally(() => setConcurrency(null));
  };

  return (
    <>
      <SettingRow label={TEXT_PARAMS_COPY.effort} desc={`${TEXT_PARAMS_COPY.effortDesc}${TEXT_PARAMS_COPY.effortCount(count.tunable, count.total)}`}>
        <SegmentedControl
          aria-label={TEXT_PARAMS_COPY.effort}
          selectedKey={effort ?? effortKey(parameters.effort)}
          isDisabled={!connected}
          onSelectionChange={(key) => chooseEffort(String(key) as EffortKey)}>
          {EFFORT_CHOICES.map((choice) => (
            <SegmentedControlItem key={choice.key} id={choice.key}>
              {choice.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </SettingRow>
      <SettingRow label={TEXT_PARAMS_COPY.concurrency} desc={TEXT_PARAMS_COPY.concurrencyDesc(CONCURRENCY_MIN, CONCURRENCY_MAX)}>
        <NumberField
          aria-label={TEXT_PARAMS_COPY.concurrency}
          size="S"
          styles={concurrencyField}
          minValue={CONCURRENCY_MIN}
          maxValue={CONCURRENCY_MAX}
          step={1}
          isDisabled={!connected}
          value={concurrency ?? parameters.concurrency}
          onChange={changeConcurrency}
        />
      </SettingRow>
    </>
  );
}
