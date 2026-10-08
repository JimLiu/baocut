import { useMemo, useState } from 'react';
import { Picker, PickerItem, SegmentedControl, SegmentedControlItem, Switch, ToggleButton, ToggleButtonGroup } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { exportLanes, soundLanes } from '../../model/export-lanes.ts';
import { rangeScope } from '../../model/export-range.ts';
import {
  AUDIO_FORMATS,
  audioQualityLine,
  audioSettings,
  audioSourceChoices,
  BITRATES,
  DEFAULT_AUDIO_FORM,
  DEFAULT_BITRATE,
  defaultFileNames,
  dubGroups,
  dubParts,
  formatDb,
  type AudioForm,
  type AudioSourceKey,
  type LoudnessForm,
  type VoiceSplit,
} from '../../model/export-settings.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { SubmitFoot } from './export-footer.tsx';
import { ExportLoudness } from './export-loudness.tsx';
import { FileRows, Lane, Lanes, Note, PlaceRow, Quick, QuickField, Sec, SumRow, Summary } from './export-parts.tsx';
import { ExportRangeSection, type RangeBundle } from './export-range.tsx';
import type { ExportEnv, ExportSubmit } from './use-export-submit.ts';

/**
 * 「音频」页（设计稿 export-audio.jsx、model-audio-export.js）：声音里有什么、范围、格式与音质、响度、人声分几份、摘要。
 *
 * - 快速选择落成 Runtime 的声音来源（`source`）：成片混音 / 只要原声 / 只要某组配音。「只要音乐」没有对应的来源，置灰。
 * - 轨道清单只读，跟着时间轴的静音 / 独听（没有逐轨覆盖）。
 * - 人声分几份：混成一份（按快速选择）/ 每种一份（每组配音各提交一次导出，来源 `{ dubGroupId }`）。设计稿里原声也算一份、
 *   每份还带背景声与音乐，Runtime 的声音来源表达不了：这里只按配音组分，每份只有这一组配音，界面上写明。没有配音时置灰。
 */

const row = style({ marginTop: 8 });

export function ExportAudioTab({
  env,
  submitter,
  range,
  loudness,
  onLoudness,
  onClose,
}: {
  env: ExportEnv;
  submitter: ExportSubmit;
  range: RangeBundle;
  loudness: LoudnessForm;
  onLoudness: (next: LoudnessForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AudioForm>(DEFAULT_AUDIO_FORM);
  const [split, setSplit] = useState<VoiceSplit>('one');
  const set = (patch: Partial<AudioForm>) => setForm((f) => ({ ...f, ...patch }));
  const groups = useMemo(() => dubGroups(env.sequence), [env.sequence]);
  const choices = useMemo(() => audioSourceChoices(groups), [groups]);
  const lanes = useMemo(() => soundLanes(exportLanes(env.sequence, env.documents)), [env.sequence, env.documents]);
  const source = choices.find((c) => c.key === form.source) ?? choices[0]!;
  const format = AUDIO_FORMATS.find((f) => f.key === form.format) ?? AUDIO_FORMATS[1]!;

  const scope = rangeScope(range.plan);
  const mixed = range.plan.empty || !lanes.length ? null : audioSettings({ ...form, source: source.key }, scope, loudness);
  // 每种一份：每组配音一份；有配音、范围不空时才有。
  const each = split === 'each' && groups.length > 0;
  const parts = each && mixed ? dubParts(groups, form, scope, loudness, env.videoName) : [];
  const settings = each ? (parts[0]?.settings ?? null) : mixed;
  const named = parts.every((p) => p.fileName !== null);
  const files = each ? (named ? parts.map((p) => p.fileName!) : []) : settings ? defaultFileNames(env.videoName, settings, env.documents) : [];
  const what = [
    range.plan.label,
    each ? EXPORT_COPY.eachWhat(parts.map((p) => p.label)) : source.label,
    audioQualityLine(form),
    loudness.on ? `${formatDb(loudness.lufs)} LUFS` : null,
  ].filter(Boolean);
  const channelNote = form.channels === 2 ? EXPORT_COPY.stereoNote : format.lossless ? EXPORT_COPY.monoNoteLossless : EXPORT_COPY.monoNoteLossy;

  return (
    <>
      <Sec first>{EXPORT_COPY.soundLanes}</Sec>
      <ToggleButtonGroup
        aria-label={EXPORT_COPY.quick}
        size="S"
        selectionMode="single"
        disallowEmptySelection
        isDisabled={each}
        selectedKeys={[source.key]}
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (key !== undefined && key !== 'music') set({ source: String(key) as AudioSourceKey });
        }}>
        {choices.map((c) => (
          <ToggleButton key={c.key} id={c.key}>
            {c.label}
          </ToggleButton>
        ))}
        <ToggleButton id="music" isDisabled>
          {EXPORT_COPY.musicOnly}
        </ToggleButton>
      </ToggleButtonGroup>
      <Note>{each ? EXPORT_COPY.splitQuickOff : `${source.note} · ${EXPORT_COPY.musicOnlyBlocked}`}</Note>
      <div className={row}>
        {lanes.length ? (
          <Lanes label={EXPORT_COPY.soundLanes}>
            {lanes.map((lane) => (
              <Lane
                key={lane.trackId}
                icon={lane.kind === 'audio' ? <AudioWave /> : <Video />}
                name={lane.label}
                sub={lane.reason ?? lane.sub}
                off={lane.sound !== true}
                end={<Switch size="S" aria-label={lane.label} isSelected={lane.sound === true} isDisabled />}
              />
            ))}
          </Lanes>
        ) : (
          <Lanes label={EXPORT_COPY.soundLanes}>
            <Lane icon={<AudioWave />} name={EXPORT_COPY.noSound} sub={EXPORT_COPY.noSoundSub} off />
          </Lanes>
        )}
      </div>
      <Note>{groups.length ? `${EXPORT_COPY.soundNote} · ${EXPORT_COPY.sourceNote}` : EXPORT_COPY.soundNote}</Note>

      <ExportRangeSection {...range} />

      <Sec>{EXPORT_COPY.formatQuality}</Sec>
      <Quick>
        <QuickField label={EXPORT_COPY.format}>
          <SegmentedControl aria-label={EXPORT_COPY.format} selectedKey={form.format} onSelectionChange={(key) => set({ format: key as AudioForm['format'] })}>
            {AUDIO_FORMATS.map((f) => (
              <SegmentedControlItem key={f.key} id={f.key}>
                {f.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </QuickField>
        {format.lossless ? null : (
          <QuickField label={EXPORT_COPY.bitrate}>
            <Picker size="S" aria-label={EXPORT_COPY.bitrate} selectedKey={String(form.bitrate)} onSelectionChange={(key) => key !== null && set({ bitrate: Number(key) || DEFAULT_BITRATE })}>
              {BITRATES.map((b) => (
                <PickerItem key={b} id={String(b)}>
                  {`${b} kbps`}
                </PickerItem>
              ))}
            </Picker>
          </QuickField>
        )}
        <QuickField label={EXPORT_COPY.channels}>
          <SegmentedControl aria-label={EXPORT_COPY.channels} selectedKey={String(form.channels)} onSelectionChange={(key) => set({ channels: key === '1' ? 1 : 2 })}>
            <SegmentedControlItem id="2">{EXPORT_COPY.stereo}</SegmentedControlItem>
            <SegmentedControlItem id="1">{EXPORT_COPY.mono}</SegmentedControlItem>
          </SegmentedControl>
        </QuickField>
      </Quick>
      <Note>{format.note}</Note>
      <Note>{channelNote}</Note>

      <ExportLoudness value={loudness} onChange={onLoudness} />

      <Sec>{EXPORT_COPY.voiceSplit}</Sec>
      <SegmentedControl
        aria-label={EXPORT_COPY.voiceSplit}
        selectedKey={each ? 'each' : 'one'}
        onSelectionChange={(key) => setSplit(key === 'each' ? 'each' : 'one')}>
        <SegmentedControlItem id="one">{EXPORT_COPY.splitOne}</SegmentedControlItem>
        <SegmentedControlItem id="each" isDisabled={!groups.length}>
          {EXPORT_COPY.splitEach}
        </SegmentedControlItem>
      </SegmentedControl>
      {each ? (
        <div className={row}>
          <Lanes label={EXPORT_COPY.voiceSplit}>
            {groups.map((g) => (
              <Lane key={g.groupId} icon={<AudioWave />} name={g.label} sub={EXPORT_COPY.dubPartSub(g.items)} />
            ))}
          </Lanes>
        </div>
      ) : null}
      <Note>{!groups.length ? EXPORT_COPY.splitNoDub : each ? EXPORT_COPY.splitEachNote : EXPORT_COPY.splitOneNote}</Note>
      {each && parts.length && !named ? <Note>{EXPORT_COPY.splitEachRanges}</Note> : null}

      <Summary>
        <SumRow label={EXPORT_COPY.willExport}>{what.join(' · ')}</SumRow>
        {each && parts.length && !named ? (
          <SumRow label={EXPORT_COPY.file}>{EXPORT_COPY.eachFiles(parts.length * (scope.ranges?.length ?? 1))}</SumRow>
        ) : (
          <FileRows names={files} />
        )}
        <SumRow label={EXPORT_COPY.estimate}>{EXPORT_COPY.noEstimate}</SumRow>
        <PlaceRow videoId={env.videoId} sourceDir={env.sourceDir} />
      </Summary>

      <SubmitFoot
        env={env}
        submitter={submitter}
        settings={settings}
        label={each ? EXPORT_COPY.exportAudioEach(parts.length || groups.length, format.label) : EXPORT_COPY.exportAudio(format.label)}
        onClose={onClose}
        {...(each ? { onSubmit: () => void submitter.submitEach(parts.map((p) => ({ settings: p.settings, fileName: p.fileName }))) } : {})}
      />
    </>
  );
}
