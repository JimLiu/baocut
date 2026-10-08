import { useMemo, useState } from 'react';
import { Badge, Picker, PickerItem, SegmentedControl, SegmentedControlItem, Switch, Text } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { exportLanes, laneOn, type ExportLane } from '../../model/export-lanes.ts';
import { rangeScope } from '../../model/export-range.ts';
import {
  audioSourceChoices,
  DEFAULT_VIDEO_FORM,
  defaultFileNames,
  dubGroups,
  formatDb,
  QUALITY_CHOICES,
  ratioChoices,
  resolutionChoices,
  videoRatio,
  videoSettings,
  type AudioSourceKey,
  type LoudnessForm,
  type QualityKey,
  type VideoForm,
} from '../../model/export-settings.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { ExportFontNote } from './export-fonts.tsx';
import { SubmitFoot } from './export-footer.tsx';
import { ExportLoudness } from './export-loudness.tsx';
import { FileRows, Lane, Lanes, Note, PlaceRow, Quick, QuickField, Sec, SumRow, Summary } from './export-parts.tsx';
import { ExportRangeSection, type RangeBundle } from './export-range.tsx';
import type { ExportEnv, ExportSubmit } from './use-export-submit.ts';

/**
 * 「视频」页（设计稿 export.jsx 的 `VideoPage`）：左边范围、画质与体积、响度、摘要；右边「画面里有什么」。
 *
 * 与设计稿的出入（Runtime 做不到的照实置灰）：
 * - 右栏的轨道开关只读，跟着时间轴的显示 / 静音 / 独显；唯一能单独定的是字幕烧不烧进画面（`burnCaptions`）。
 *   设计稿的逐轨覆盖与「同步到时间轴」没有接上。
 * - 画幅：缺省跟随画布；换成 16:9、9:16、1:1、4:5 时加黑边（画面居中、不裁切、不重排），设计稿是按新画幅裁切。
 * - 体积三档落成恒定质量（crf），没有码率与体积、耗时预估。
 * - 设计稿左上的小预览（export-preview.jsx）没有做：弹层下面就是编辑器的预览，导出画的就是它。
 * - 「配音声道」只有「一条声道」：落成与音频导出相同的声音来源（`source`），默认是成片混音；
 *   「每种一条」（MP4 多音轨）Runtime 还没有实现，置灰。
 */

const cols = style({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) 260px]', gap: 20, alignItems: 'start' });
const row = style({ marginTop: 8 });
const left = style({ minWidth: 0 });
const right = style({ minWidth: 0 });

const LANE_ICON = { visual: <Video />, subtitle: <CloseCaptions />, audio: <AudioWave /> } as const;

export function ExportVideoTab({
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
  const [form, setForm] = useState<VideoForm>(DEFAULT_VIDEO_FORM);
  const set = (patch: Partial<VideoForm>) => setForm((f) => ({ ...f, ...patch }));
  const { width, height } = env.sequence.canvas;
  const canvas = useMemo(() => ({ width, height }), [width, height]);
  const ratios = useMemo(() => ratioChoices(canvas), [canvas]);
  const ratio = videoRatio(form, canvas);
  const resolutions = useMemo(() => resolutionChoices(canvas, ratio), [canvas, ratio]);
  const lanes = useMemo(() => exportLanes(env.sequence, env.documents), [env.sequence, env.documents]);
  const resolution = resolutions.find((r) => r.short === form.short) ?? resolutions[0] ?? null;
  const quality = QUALITY_CHOICES.find((q) => q.key === form.quality) ?? QUALITY_CHOICES[1]!;
  const captions = lanes.filter((l) => l.kind === 'subtitle');
  const burned = form.burnCaptions && captions.some((l) => l.picture);
  const groups = useMemo(() => dubGroups(env.sequence), [env.sequence]);
  const sources = useMemo(() => audioSourceChoices(groups), [groups]);
  const source = sources.find((c) => c.key === form.source) ?? sources[0]!;

  const settings = range.plan.empty ? null : videoSettings({ ...form, source: source.key }, canvas, rangeScope(range.plan), loudness);
  const files = settings ? defaultFileNames(env.videoName, settings, env.documents) : [];
  const what = [
    range.plan.label,
    ratio ? EXPORT_COPY.letterboxedTo(ratio.key) : null,
    resolution ? `${resolution.label}${resolution.source && !ratio ? '' : ` · ${resolution.width}×${resolution.height}`}` : null,
    quality.label,
    captions.length ? (burned ? EXPORT_COPY.captionsBurned : EXPORT_COPY.captionsNotBurned) : null,
    source.key !== 'mix' ? source.label : null,
    loudness.on ? `${formatDb(loudness.lufs)} LUFS` : null,
  ].filter(Boolean);

  return (
    <>
      <ExportFontNote videoId={env.videoId} burnCaptions={form.burnCaptions} />
      <div className={cols}>
        <div className={left}>
          <ExportRangeSection {...range} first />

          <Sec>{EXPORT_COPY.quality}</Sec>
          <Quick>
            <QuickField label={EXPORT_COPY.resolution}>
              <Picker
                size="S"
                aria-label={EXPORT_COPY.resolution}
                isDisabled={!resolutions.length}
                selectedKey={resolution ? String(resolution.short) : null}
                onSelectionChange={(key) => {
                  if (key === null) return;
                  const pick = resolutions.find((r) => String(r.short) === String(key));
                  set({ short: pick && !pick.source ? pick.short : null });
                }}>
                {resolutions.map((r) => (
                  <PickerItem key={r.short} id={String(r.short)} textValue={r.label}>
                    <Text slot="label">{r.label}</Text>
                    <Text slot="description">{r.source ? `${EXPORT_COPY.sourceResolution} · ${r.width}×${r.height}` : `${r.width}×${r.height}`}</Text>
                  </PickerItem>
                ))}
              </Picker>
            </QuickField>
            <QuickField label={EXPORT_COPY.ratio}>
              <Picker
                size="S"
                aria-label={EXPORT_COPY.ratio}
                selectedKey={ratio?.key ?? 'canvas'}
                onSelectionChange={(key) => {
                  if (key !== null) set({ ratio: ratios.find((r) => r.key === key)?.key ?? null });
                }}>
                {[
                  <PickerItem key="canvas" id="canvas" textValue={EXPORT_COPY.followCanvas}>
                    <Text slot="label">{EXPORT_COPY.followCanvas}</Text>
                    <Text slot="description">{ratioLabel(width, height)}</Text>
                  </PickerItem>,
                  ...ratios.map((r) => (
                    <PickerItem key={r.key} id={r.key} textValue={r.key}>
                      {r.key}
                    </PickerItem>
                  )),
                ]}
              </Picker>
            </QuickField>
          </Quick>
          <div className={row}>
            <Quick>
              <QuickField label={EXPORT_COPY.size}>
                <SegmentedControl aria-label={EXPORT_COPY.size} selectedKey={form.quality} onSelectionChange={(key) => set({ quality: key as QualityKey })}>
                  {QUALITY_CHOICES.map((q) => (
                    <SegmentedControlItem key={q.key} id={q.key}>
                      {q.label}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </QuickField>
            </Quick>
          </div>
          <Note>
            {quality.note}
            {resolution ? ` · ${EXPORT_COPY.upscaleNote(resolutions[0]!.label)}` : ''}
          </Note>
          {ratio ? <Note>{EXPORT_COPY.letterboxNote}</Note> : null}

          <ExportLoudness value={loudness} onChange={onLoudness} />

          <Summary>
            <SumRow label={EXPORT_COPY.willExport}>{what.join(' · ')}</SumRow>
            <FileRows names={files} />
            <SumRow label={EXPORT_COPY.estimate}>{EXPORT_COPY.noEstimate}</SumRow>
            <PlaceRow videoId={env.videoId} />
          </Summary>
        </div>

        <div className={right}>
          <Sec first>{EXPORT_COPY.pictureLanes}</Sec>
          {lanes.length ? (
            <Lanes label={EXPORT_COPY.pictureLanes}>
              {lanes.map((lane) => (
                <PictureLane key={lane.trackId} lane={lane} burn={form.burnCaptions} onBurn={(burnCaptions) => set({ burnCaptions })} />
              ))}
            </Lanes>
          ) : (
            <Note>{EXPORT_COPY.noLanes}</Note>
          )}
          <Note>{EXPORT_COPY.lanesNote}</Note>
          {groups.length ? (
            <>
              <Sec>{EXPORT_COPY.dubChannels}</Sec>
              <SegmentedControl aria-label={EXPORT_COPY.dubChannels} selectedKey="one">
                <SegmentedControlItem id="one">{EXPORT_COPY.dubOne}</SegmentedControlItem>
                <SegmentedControlItem id="multi" isDisabled>
                  {EXPORT_COPY.dubMulti}
                </SegmentedControlItem>
              </SegmentedControl>
              <div className={row}>
                <Picker
                  size="S"
                  label={EXPORT_COPY.dubPick}
                  selectedKey={source.key}
                  onSelectionChange={(key) => {
                    if (key !== null) set({ source: String(key) as AudioSourceKey });
                  }}>
                  {sources.map((c) => (
                    <PickerItem key={c.key} id={c.key} textValue={c.label}>
                      <Text slot="label">{c.label}</Text>
                      <Text slot="description">{c.note}</Text>
                    </PickerItem>
                  ))}
                </Picker>
              </div>
              <div className={row}>
                <Lanes label={EXPORT_COPY.dubChannels}>
                  <Lane
                    icon={<AudioWave />}
                    name={source.label}
                    sub={source.note}
                    end={
                      <Badge variant="neutral" size="S" fillStyle="subtle">
                        {EXPORT_COPY.dubTrackDefault}
                      </Badge>
                    }
                  />
                </Lanes>
              </div>
              <Note>{EXPORT_COPY.dubMultiBlocked}</Note>
            </>
          ) : null}
        </div>
      </div>

      <SubmitFoot env={env} submitter={submitter} settings={settings} label={EXPORT_COPY.exportMp4} onClose={onClose} />
    </>
  );
}

/** 一条轨道这次进不进成片。字幕轨的开关就是 `burnCaptions`（几条字幕轨共用一个）；别的轨只读，跟着时间轴。 */
function PictureLane({ lane, burn, onBurn }: { lane: ExportLane; burn: boolean; onBurn: (on: boolean) => void }) {
  if (lane.kind === 'subtitle') {
    const on = lane.picture === true && burn;
    return (
      <Lane
        icon={LANE_ICON.subtitle}
        name={lane.label}
        sub={lane.reason ?? (burn ? lane.sub : EXPORT_COPY.burnOff)}
        off={!on}
        end={<Switch size="S" aria-label={EXPORT_COPY.burnCaptionsFor(lane.label)} isSelected={on} isDisabled={lane.picture !== true} onChange={onBurn} />}
      />
    );
  }
  const on = laneOn(lane);
  return (
    <Lane
      icon={LANE_ICON[lane.kind]}
      name={lane.label}
      sub={lane.reason ?? lane.sub}
      off={!on}
      end={<Switch size="S" aria-label={lane.label} isSelected={on} isDisabled />}
    />
  );
}

/** 画布的画幅：「16:9」「9:16」「1:1」，约不尽时写宽高。 */
function ratioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(width, height) || 1;
  const w = width / g;
  const h = height / g;
  return w <= 32 && h <= 32 ? `${w}:${h}` : `${width}×${height}`;
}
