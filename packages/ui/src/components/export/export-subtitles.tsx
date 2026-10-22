import { useMemo, useState } from 'react';
import type { SubtitleExportFormat } from '@baocut/protocol';
import { SegmentedControl, SegmentedControlItem, Switch } from '@react-spectrum/s2';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { toggleId } from '../../model/export-range.ts';
import { defaultFileNames, initialSubtitlePick, SUBTITLE_FORMATS, subtitleLanes, subtitlePlan, subtitleSettings } from '../../model/export-settings.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { SubmitFoot } from './export-footer.tsx';
import { FileRows, Lane, Lanes, Note, PlaceRow, Quick, QuickField, Sec, SumRow, Summary } from './export-parts.tsx';
import type { ExportEnv, ExportSubmit } from './use-export-submit.ts';

/**
 * 「字幕」页（设计稿 export.jsx 的 `SubsPage`）：导哪几条、格式、多轨怎么出、摘要。
 *
 * 一行是一层字幕（与轨条的一组同一个分法）；纪录片一段素材一份文档，一层就是几份（`documentIds`），Runtime 按各段在
 * 时间线上的位置合成一份。一次导出只出一份字幕文件（两层时加 `bilingual` 合成双语，排在前面的是主文）。设计稿的
 * 「各出一份」与一次三条以上 Runtime 做不了，置灰并说明分几次导。导出整条序列（设计稿这一页没有范围）。
 */

const row = style({ marginTop: 12 });

export function ExportSubtitlesTab({ env, submitter, onClose }: { env: ExportEnv; submitter: ExportSubmit; onClose: () => void }) {
  const lanes = useMemo(() => subtitleLanes(env.sequence, env.documents), [env.sequence, env.documents]);
  const [picked, setPicked] = useState<string[]>(() => initialSubtitlePick(lanes));
  const [format, setFormat] = useState<SubtitleExportFormat>('srt');
  const live = picked.filter((key) => lanes.some((l) => l.key === key));
  const plan = subtitlePlan(lanes, live, true);
  const formatChoice = SUBTITLE_FORMATS.find((f) => f.key === format) ?? SUBTITLE_FORMATS[0]!;
  const settings = plan.options ? subtitleSettings(format, plan.options, {}) : null;
  const files = settings ? defaultFileNames(env.videoName, settings, env.documents) : [];
  const chosen = lanes.filter((l) => live.includes(l.key));
  const what = chosen.length ? `${EXPORT_COPY.subtitlesWhat(chosen.map((l) => l.label))} · ${formatChoice.label}` : '—';

  return (
    <>
      <Sec first>{EXPORT_COPY.subtitleLanes}</Sec>
      <Lanes label={EXPORT_COPY.subtitleLanes}>
        {lanes.length ? (
          lanes.map((lane) => {
            const on = live.includes(lane.key);
            const what = lane.documentIds.length > 1 ? EXPORT_COPY.segmentCount(lane.documentIds.length) : lane.name;
            return (
              <Lane
                key={lane.key}
                icon={<CloseCaptions />}
                name={lane.label}
                sub={lane.shown ? what : `${what} · ${EXPORT_COPY.hiddenOnTimeline}`}
                off={!on}
                end={<Switch size="S" aria-label={`${lane.label} · ${what}`} isSelected={on} onChange={() => setPicked(toggleId(live, lane.key))} />}
              />
            );
          })
        ) : (
          <Lane icon={<CloseCaptions />} name={EXPORT_COPY.noSubtitles} sub={EXPORT_COPY.noSubtitlesSub} off />
        )}
      </Lanes>
      {plan.block === 'none' && lanes.length ? <Note warn>{EXPORT_COPY.pickOne}</Note> : null}
      {plan.block === 'too-many' ? <Note warn>{EXPORT_COPY.tooMany}</Note> : null}

      <div className={row}>
        <Quick>
          <QuickField label={EXPORT_COPY.format}>
            <SegmentedControl aria-label={EXPORT_COPY.format} selectedKey={format} onSelectionChange={(key) => setFormat(key as SubtitleExportFormat)}>
              {SUBTITLE_FORMATS.map((f) => (
                <SegmentedControlItem key={f.key} id={f.key}>
                  {f.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </QuickField>
          {live.length === 2 ? (
            <QuickField label={EXPORT_COPY.multiTrack}>
              <SegmentedControl aria-label={EXPORT_COPY.multiTrack} selectedKey="one">
                <SegmentedControlItem id="one">{EXPORT_COPY.mergeOne}</SegmentedControlItem>
                <SegmentedControlItem id="each" isDisabled>
                  {EXPORT_COPY.eachOne}
                </SegmentedControlItem>
              </SegmentedControl>
            </QuickField>
          ) : null}
        </Quick>
      </div>
      <Note>{formatChoice.note}</Note>
      {chosen.some((l) => l.documentIds.length > 1) ? <Note>{EXPORT_COPY.layerNote}</Note> : null}
      {live.length === 2 ? (
        <Note>
          {EXPORT_COPY.bilingualNote} · {EXPORT_COPY.eachBlocked}
        </Note>
      ) : null}

      <Summary>
        <SumRow label={EXPORT_COPY.willExport}>{what}</SumRow>
        <FileRows names={files} />
        <PlaceRow videoId={env.videoId} />
      </Summary>

      <SubmitFoot env={env} submitter={submitter} settings={settings} label={EXPORT_COPY.exportSubtitles} onClose={onClose} />
    </>
  );
}
