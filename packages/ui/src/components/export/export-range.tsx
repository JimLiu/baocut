import { useEffect, useState } from 'react';
import { Checkbox, RangeSlider, SegmentedControl, SegmentedControlItem, TextField } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import {
  clampCustom,
  formatRangeTime,
  parseRangeTime,
  RANGE_MODES,
  toggleId,
  type RangeMode,
  type RangePiece,
  type RangePlan,
  type RangeState,
} from '../../model/export-range.ts';
import { formatClock } from '../../model/format.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { Lane, Lanes, Note, NoteRow, Quick, QuickField, Sec, TextLink } from './export-parts.tsx';

/**
 * 「范围」一节（设计稿 export-range.jsx）：整片 / 按章节 / 按片段 / 自定义。视频页与音频页共用一份状态。
 *
 * - 按章节、按片段多选：修剪条上每段一格（点格子就是勾 / 取消），下面是同一份勾选的列表；相邻的段拼成一段。
 * - 自定义是一对起止：修剪条换成 S2 的 RangeSlider，旁边可输入的时间码，「取此刻」取编辑器播放头。
 * - 勾了不相邻的几段：设计稿可以「合成一份」；Runtime 不能把不相邻的段接成一个文件（`ranges` 每段各出一个），
 *   这一档置灰并写明原因。
 */

const strip = style({ position: 'relative', height: 24, marginTop: 8, borderRadius: 'default', backgroundColor: 'gray-100', overflow: 'hidden' });
const cell = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  margin: 0,
  padding: 0,
  borderWidth: 0,
  borderStartWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-25',
  backgroundColor: { default: 'gray-200', isHovered: 'gray-300', isOn: { default: 'blue-400', isHovered: 'blue-500' } },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  cursor: 'default',
});
const playheadMark = style({ position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'red-900', pointerEvents: 'none' });
const sliderWrap = style({ marginTop: 8 });
const custom = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 8, marginTop: 8 });
const length = style({ font: 'code-xs', color: 'gray-600' });
const time = style({ font: 'code-xs', color: 'gray-600', whiteSpace: 'nowrap' });
const timeField = style({ width: 88 });
const fullWidth = style({ width: 'full' });
const list = style({ marginTop: 8, maxHeight: 200, overflowY: 'auto' });

/** 范围一节要的东西：视频页与音频页共用的那份状态，加上从序列读出的章节、片段与总长。 */
export interface RangeBundle {
  state: RangeState;
  onChange: (next: RangeState) => void;
  chapters: readonly RangePiece[];
  clips: readonly RangePiece[];
  duration: number;
  plan: RangePlan;
  playhead: number;
}

export function ExportRangeSection({ state, onChange, chapters, clips, duration, plan, playhead, first }: RangeBundle & { first?: boolean }) {
  const isChapters = state.mode === 'chapters';
  const pieces = isChapters ? chapters : state.mode === 'clips' ? clips : [];
  const ids = isChapters ? state.chapterIds : state.clipIds;
  const setIds = (next: string[]) => onChange(isChapters ? { ...state, chapterIds: next } : { ...state, clipIds: next });
  const toggle = (id: string) => setIds(toggleId(ids, id));
  const setCustom = (start: number, end: number) => onChange({ ...state, custom: clampCustom(start, end, duration) });
  const pct = (t: number) => `${duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0}%`;

  return (
    <>
      <Sec first={first}>{EXPORT_COPY.range}</Sec>
      <SegmentedControl aria-label={EXPORT_COPY.range} selectedKey={state.mode} onSelectionChange={(key) => onChange({ ...state, mode: key as RangeMode })}>
        {RANGE_MODES.map((m) => (
          <SegmentedControlItem key={m.key} id={m.key}>
            {m.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      {state.mode === 'chapters' || state.mode === 'clips' ? (
        <>
          {pieces.length ? (
            <div className={strip}>
              {pieces.map((p) => (
                <RACButton
                  key={p.id}
                  aria-label={p.label}
                  aria-pressed={ids.includes(p.id)}
                  className={(rp) => cell({ ...rp, isOn: ids.includes(p.id) })}
                  style={{ left: pct(p.start), width: `calc(${pct(p.end)} - ${pct(p.start)})` }}
                  onPress={() => toggle(p.id)}
                />
              ))}
              <i className={playheadMark} style={{ left: pct(playhead) }} aria-hidden />
            </div>
          ) : null}
          {pieces.length ? (
            <div className={list}>
              <Lanes label={isChapters ? EXPORT_COPY.rangeChapters : EXPORT_COPY.rangeClips}>
                {pieces.map((p) => (
                  <Lane
                    key={p.id}
                    off={!ids.includes(p.id)}
                    start={<Checkbox size="S" aria-label={p.label} isSelected={ids.includes(p.id)} onChange={() => toggle(p.id)} />}
                    name={p.label}
                    sub={p.name ?? undefined}
                    end={
                      <>
                        <span className={time}>
                          {formatClock(p.start)}–{formatClock(p.end)}
                        </span>
                        <span className={time}>{formatClock(p.end - p.start)}</span>
                      </>
                    }
                  />
                ))}
              </Lanes>
            </div>
          ) : (
            <Note>{isChapters ? EXPORT_COPY.noChapters : EXPORT_COPY.noClips}</Note>
          )}
          {pieces.length ? (
            <NoteRow
              links={
                <>
                  <TextLink onPress={() => setIds(pieces.map((p) => p.id))}>{EXPORT_COPY.selectAll}</TextLink>
                  <TextLink onPress={() => setIds([])}>{EXPORT_COPY.clear}</TextLink>
                </>
              }>
              {plan.empty ? (isChapters ? EXPORT_COPY.pickChapters : EXPORT_COPY.pickClips) : plan.label}
            </NoteRow>
          ) : null}
        </>
      ) : null}

      {state.mode === 'custom' ? (
        <>
          <div className={sliderWrap}>
            <RangeSlider
              aria-label={EXPORT_COPY.range}
              size="S"
              minValue={0}
              maxValue={Math.max(duration, 0.1)}
              step={0.1}
              value={state.custom}
              onChange={(v) => setCustom(v.start, v.end)}
              styles={fullWidth}
            />
          </div>
          <div className={custom}>
            <TimeInput label={EXPORT_COPY.start} ariaLabel={EXPORT_COPY.startLabel} value={state.custom.start} onCommit={(t) => setCustom(t, state.custom.end)} onNow={() => setCustom(playhead, state.custom.end)} />
            <TimeInput label={EXPORT_COPY.end} ariaLabel={EXPORT_COPY.endLabel} value={state.custom.end} onCommit={(t) => setCustom(state.custom.start, t)} onNow={() => setCustom(state.custom.start, playhead)} />
            <span className={length}>{EXPORT_COPY.length(formatClock(plan.seconds, { tenths: true }))}</span>
          </div>
        </>
      ) : null}

      {plan.segments.length > 1 ? (
        <>
          <div className={sliderWrap}>
            <Quick>
              <QuickField label={EXPORT_COPY.multi}>
                <SegmentedControl aria-label={EXPORT_COPY.multi} selectedKey="each">
                  <SegmentedControlItem id="one" isDisabled>
                    {EXPORT_COPY.mergeOne}
                  </SegmentedControlItem>
                  <SegmentedControlItem id="each">{EXPORT_COPY.eachOne}</SegmentedControlItem>
                </SegmentedControl>
              </QuickField>
            </Quick>
          </div>
          <Note>{EXPORT_COPY.mergeBlocked}</Note>
        </>
      ) : null}
    </>
  );
}

/** 时间码输入（设计稿 `TimeField`）：失焦或回车才提交，不合法就回到原值；旁边「取此刻」取编辑器播放头。 */
function TimeInput({ label, ariaLabel, value, onCommit, onNow }: { label: string; ariaLabel: string; value: number; onCommit: (t: number) => void; onNow: () => void }) {
  const [draft, setDraft] = useState(formatRangeTime(value));
  useEffect(() => setDraft(formatRangeTime(value)), [value]);
  const commit = () => {
    const t = parseRangeTime(draft);
    if (t === null) setDraft(formatRangeTime(value));
    else onCommit(t);
  };
  return (
    <QuickField label={label}>
      <TextField
        size="S"
        aria-label={ariaLabel}
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        styles={timeField}
      />
      <TextLink onPress={onNow}>{EXPORT_COPY.takeNow}</TextLink>
    </QuickField>
  );
}
