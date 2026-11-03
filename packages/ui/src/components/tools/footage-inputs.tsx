import { useState } from 'react';
import { ActionButton, Button, DropZone, NumberField, SegmentedControl, SegmentedControlItem, Text, TextField, ToastQueue } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Close from '@react-spectrum/s2/icons/Close';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Upload from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { DropItem } from 'react-aria-components';
import { formatClock } from '../../model/format.ts';
import type { FootageToolId } from '../../model/tool-catalog.ts';
import { M } from '../../model/tools-footage-copy.ts';
import { countText, extensionsFor, MAX_INPUTS, planOf, sentences, sourceLine, type FootageForm, type FootageSource } from '../../model/tools-footage.ts';
import { parsePathInput, spaceInput } from '../../model/tools-transcode.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { detail, detailGrow, hintText, Row, Section, SectionLink } from './tool-parts.tsx';
import { SpacePicker } from './tool-video-picker.tsx';
import { TRANSCODE_COPY } from './tools-copy.ts';

/*
 * 素材处理的输入（设计稿 tool-footage-form.jsx `FootageSources`、`FootageRange`）：拖进来、选文件、粘贴路径或从 Space 里选，1–20 个，按同样的
 * 设置逐个处理；「处理哪一段」是流程的 `start`、`end`，每个文件取同一段，图片不收，分轨没有。
 */

const dropZone = style({ width: 'full' });
const dropBody = style({
  display: 'flex',
  flexDirection: { default: 'column', isCompact: 'row' },
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: { default: 12, isCompact: 8 },
  paddingY: { default: 32, isCompact: 12 },
  paddingX: 16,
  textAlign: 'center',
});
const dropIcon = style({ display: 'flex', color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const dropTitle = style({ font: 'title-sm', color: 'gray-900' });
const dropSub = style({ font: 'ui-xs', color: 'gray-600', maxWidth: 360 });
const pathRow = style({ display: 'flex', alignItems: 'end', gap: 8, minWidth: 0 });
const pathField = style({ flexGrow: 1, minWidth: 0 });
const sources = style({ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflow: 'auto' });
const source = style({ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 'default', backgroundColor: 'gray-25', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', minWidth: 0 });
const sourceIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const sourceText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const sourceName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const numberField = style({ width: 120 });
const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });

export function FootageSources({
  id,
  form,
  srcs,
  reading,
  allInputs,
  onAdd,
  onChange,
}: {
  id: FootageToolId;
  form: FootageForm;
  srcs: readonly FootageSource[];
  /** 正在读刚选的文件。 */
  reading: boolean;
  allInputs: readonly string[];
  onAdd: (inputs: readonly string[]) => void;
  onChange: (inputs: string[]) => void;
}) {
  const runtime = useRuntime();
  const [typed, setTyped] = useState('');
  const [fromSpace, setFromSpace] = useState(false);
  const pick = () => {
    const take = (paths: string[]) => {
      if (paths.length) onAdd(paths);
    };
    if (runtime.host.pickFiles) void runtime.host.pickFiles({ title: M.pickTitle, multiple: true, filters: [{ name: M.mediaFilter, extensions: extensionsFor(id) }] }).then(take);
    else void runtime.host.pickMediaFiles().then(take);
  };
  const drop = async (items: readonly DropItem[]) => {
    const paths: string[] = [];
    let lost = 0;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const path = runtime.host.pathForFile(await item.getFile());
      if (path) paths.push(path);
      else lost += 1;
    }
    if (lost) ToastQueue.negative(M.noPath, { timeout: 6000 });
    if (paths.length) onAdd(paths);
  };
  const addTyped = () => {
    const path = parsePathInput(typed);
    if (!path) return;
    onAdd([path]);
    setTyped('');
  };
  const mine = new Set(srcs.map((s) => s.input));
  const compact = srcs.length > 0;
  return (
    <Section title={M.filesTitle} aside={compact ? <SectionLink onPress={() => onChange(allInputs.filter((input) => !mine.has(input)))}>{M.clear}</SectionLink> : null}>
      {compact ? (
        <div className={sources}>
          {srcs.map((s) => (
            <div key={s.input} className={source}>
              <span className={sourceIcon} aria-hidden>
                {s.facts.kind === 'image' ? <ImageIcon /> : s.facts.kind === 'audio' ? <AudioWave /> : <Filmstrip />}
              </span>
              <span className={sourceText}>
                <span className={sourceName} title={s.facts.name}>
                  {s.facts.name}
                </span>
                <span className={detail}>{sourceLine(id, form, s)}</span>
              </span>
              <ActionButton isQuiet size="S" aria-label={M.remove} onPress={() => onChange(allInputs.filter((input) => input !== s.input))}>
                <Close />
              </ActionButton>
            </div>
          ))}
        </div>
      ) : null}
      {srcs.length > 1 ? <span className={detail}>{M.sameSettings(srcs.length)}</span> : null}
      {reading ? <span className={detail}>{M.reading}</span> : null}
      <DropZone styles={dropZone} onDrop={(e) => void drop(e.items)}>
        <div className={dropBody({ isCompact: compact })}>
          <span className={dropIcon} aria-hidden>
            <Upload />
          </span>
          {compact ? (
            <span className={dropSub}>{TRANSCODE_COPY.dropMore}</span>
          ) : (
            <>
              <span className={dropTitle}>{M.dropTitle[id]}</span>
              <span className={dropSub}>{M.dropSub(MAX_INPUTS)}</span>
            </>
          )}
          <Button variant="secondary" size={compact ? 'S' : 'M'} onPress={pick}>
            {compact ? M.addMore : M.pick}
          </Button>
        </div>
      </DropZone>
      <div className={pathRow}>
        <TextField
          styles={pathField}
          size="S"
          label={TRANSCODE_COPY.pathLabel}
          placeholder={TRANSCODE_COPY.pathPlaceholder}
          value={typed}
          onChange={setTyped}
          onKeyDown={(e) => {
            // React Aria 默认拦住键盘事件冒泡；⌘↵ 要放行给 Workbench 提交。
            if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return e.continuePropagation();
            e.preventDefault();
            addTyped();
          }}
        />
        <Button variant="secondary" size="S" isDisabled={!typed.trim()} onPress={addTyped}>
          {TRANSCODE_COPY.pathAdd}
        </Button>
      </div>
      <SectionLink onPress={() => setFromSpace((v) => !v)}>{fromSpace ? M.spaceDone : M.spaceAdd}</SectionLink>
      {fromSpace ? <SpacePicker tool={id} data={null} value={null} onChange={(entryId) => onAdd([spaceInput(entryId)])} /> : null}
    </Section>
  );
}

const QUICK = [10, 60, 300] as const;

/** 处理哪一段：只有视频才有；多个文件时每个取同一段。 */
export function FootageRange({ form, setForm, srcs }: { form: FootageForm; setForm: (p: Partial<FootageForm>) => void; srcs: readonly FootageSource[] }) {
  const videos = srcs.filter((s) => s.facts.kind === 'video');
  if (!videos.length) return null;
  const one = videos.length === 1 ? planOf('stabilize-video', form, videos[0]!.facts) : null;
  const quickLabel = (seconds: number) => M.rangeFirst(seconds < 60 ? M.rangeSeconds(seconds) : M.rangeMinutes(seconds / 60));
  return (
    <Section
      title={M.rangeTitle}
      aside={
        <SegmentedControl aria-label={M.rangeTitle} selectedKey={form.ranged ? 'part' : 'all'} onSelectionChange={(k) => setForm({ ranged: k === 'part' })}>
          <SegmentedControlItem id="all">{M.rangeAll}</SegmentedControlItem>
          <SegmentedControlItem id="part">{M.rangePart}</SegmentedControlItem>
        </SegmentedControl>
      }>
      {form.ranged ? (
        <>
          <Row>
            <NumberField
              size="S"
              styles={numberField}
              label={M.rangeFrom}
              minValue={0}
              step={1}
              value={form.start}
              formatOptions={{ style: 'unit', unit: 'second', maximumFractionDigits: 1 }}
              onChange={(start) => Number.isFinite(start) && setForm({ start })}
            />
            <NumberField
              size="S"
              styles={numberField}
              label={M.rangeTo}
              minValue={0}
              step={1}
              value={form.end}
              formatOptions={{ style: 'unit', unit: 'second', maximumFractionDigits: 1 }}
              onChange={(end) => Number.isFinite(end) && setForm({ end })}
            />
          </Row>
          <div className={chips}>
            {QUICK.map((seconds) => (
              <ActionButton key={seconds} size="S" onPress={() => setForm({ start: 0, end: seconds })}>
                <Text>{quickLabel(seconds)}</Text>
              </ActionButton>
            ))}
          </div>
          <span className={detailGrow}>{sentences(one ? M.rangeOne(formatClock(one.seconds ?? 0), countText(one.frames)) : M.rangeMany, M.rangeRule)}</span>
        </>
      ) : (
        <p className={hintText}>{M.rangeAllNote}</p>
      )}
    </Section>
  );
}
