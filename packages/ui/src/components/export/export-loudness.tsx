import { Picker, PickerItem, Switch, Text } from '@react-spectrum/s2';
import { DEFAULT_LOUDNESS_TARGET } from '@baocut/protocol';
import { dbChoices, formatDb, LUFS_CHOICES, loudnessNote, TRUE_PEAK_CHOICES, type LoudnessForm } from '../../model/export-settings.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { Note, Quick, QuickField, Sec } from './export-parts.tsx';

/**
 * 「响度」一节（设计稿 export-loudness.jsx，剧情短片 §5.3）：视频页与音频页各放一份、共用一份状态，缺省关。
 * 打开后整片混音统一到目标响度，真峰值不超过上限（`LoudnessTarget`，渲染 worker 的 R128 母带链）。
 * 设计稿缺省峰值 −1.2 dBTP；这里用 Runtime 的缺省 −1.5 dBTP（`DEFAULT_LOUDNESS_TARGET`），两档都能选。
 */
export function ExportLoudness({ value, onChange }: { value: LoudnessForm; onChange: (next: LoudnessForm) => void }) {
  const set = (patch: Partial<LoudnessForm>) => onChange({ ...value, ...patch });
  return (
    <>
      <Sec>{EXPORT_COPY.loudness}</Sec>
      <Quick>
        <QuickField label={EXPORT_COPY.loudnessSwitch}>
          <Switch size="S" aria-label={EXPORT_COPY.loudnessSwitch} isSelected={value.on} onChange={(on) => set({ on })} />
        </QuickField>
        {value.on ? (
          <>
            <QuickField label={EXPORT_COPY.loudnessTarget}>
              <Picker
                size="S"
                aria-label={EXPORT_COPY.loudnessTarget}
                selectedKey={String(value.lufs)}
                onSelectionChange={(key) => key !== null && set({ lufs: Number(key) })}>
                {dbChoices(LUFS_CHOICES, value.lufs).map((x) => (
                  <PickerItem key={x} id={String(x)} textValue={`${formatDb(x)} LUFS`}>
                    <Text slot="label">{formatDb(x)} LUFS</Text>
                    {x === DEFAULT_LOUDNESS_TARGET.integratedLufs ? <Text slot="description">{EXPORT_COPY.defaultMark}</Text> : null}
                  </PickerItem>
                ))}
              </Picker>
            </QuickField>
            <QuickField label={EXPORT_COPY.truePeak}>
              <Picker
                size="S"
                aria-label={EXPORT_COPY.truePeak}
                selectedKey={String(value.truePeak)}
                onSelectionChange={(key) => key !== null && set({ truePeak: Number(key) })}>
                {dbChoices(TRUE_PEAK_CHOICES, value.truePeak).map((x) => (
                  <PickerItem key={x} id={String(x)} textValue={`${formatDb(x)} dBTP`}>
                    <Text slot="label">{formatDb(x)} dBTP</Text>
                    {x === DEFAULT_LOUDNESS_TARGET.truePeakDb ? <Text slot="description">{EXPORT_COPY.defaultMark}</Text> : null}
                  </PickerItem>
                ))}
              </Picker>
            </QuickField>
          </>
        ) : null}
      </Quick>
      <Note>{loudnessNote(value)}</Note>
    </>
  );
}
