import { useMemo, useState } from 'react';
import type { JobRecord, SpaceEntry } from '@baocut/protocol';
import { ActionButton, ProgressBar, Text } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RacButton } from 'react-aria-components';
import { rerunOf } from '../../model/tool-rerun.ts';
import { M } from '../../model/tools-footage-copy.ts';
import { footageJobs, footageToolOfJob, recordMeta, recordProgress, recordSummary, recordTitle } from '../../model/tools-footage.ts';
import { saveDirLabel } from '../../model/tool-frame.ts';
import { didNotFinish, failureText, liveCount, stateLabel } from '../../model/tools-records.ts';
import { toolById } from '../../model/tool-catalog.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { EmptyCard } from '../models/model-parts.tsx';
import { useNow } from '../use-now.ts';
import { detail, RecordCard, recordHead, recordIcon, recordRow, recordText, recordTitle as recordTitleStyle, SectionLink, SideFoot, SideHead } from './tool-parts.tsx';
import { TOOL_ICON } from './tool-icon.tsx';
import { ToolOutputRow, useJobOutputs } from './tool-outputs.tsx';
import { RECORD_COPY } from './tools-copy.ts';
import { useCancelJob } from './use-tool-records.ts';
import { goRerun } from './video-tool-parts.tsx';

/*
 * 素材处理的任务队列（设计稿 tool-footage-jobs.jsx）：六个工具共用，新的在前。进行中按帧说做到哪、按实际速度说还要多久；做完写实际用的引擎、流程的提醒
 * （退回 deshake、插帧重影、慢动作没声音、没认出主体）与产物。一次可能写出好几个文件（多个输入、分轨的每一轨）：一行一个，点开才是完整的产物行。
 */

const progress = style({ width: 'full' });
const warn = style({ margin: 0, font: 'ui-sm', color: 'orange-1000', overflowWrap: 'anywhere' });
const errorTitle = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'orange-1000', overflowWrap: 'anywhere' });
const executor = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere' });
const outputs = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const outputRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  minHeight: 32,
  paddingX: 8,
  paddingY: 4,
  borderWidth: 0,
  borderRadius: 'default',
  font: 'ui-sm',
  textAlign: 'start',
  color: 'gray-800',
  backgroundColor: { default: 'gray-75', isHovered: 'gray-100' },
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const outputName = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

function useFootageRecords(): { list: JobRecord[]; all: readonly JobRecord[] } {
  const all = useJobs((s) => s.jobs);
  const hidden = useTools((s) => s.hidden);
  const list = useMemo(() => footageJobs(all, hidden), [all, hidden]);
  return { list, all };
}

export function FootageSide() {
  const { list, all } = useFootageRecords();
  const now = useNow(5_000);
  const live = liveCount(list);
  return (
    <>
      <SideHead title={M.side} live={live ? RECORD_COPY.live(live) : null} count={RECORD_COPY.count(list.length)} />
      {list.length ? list.map((job) => <FootageRecord key={job.jobId} job={job} all={all} now={now} />) : <EmptyCard icon={<Filmstrip />} title={M.empty} body={M.emptyBody} />}
      <SideFoot>{M.sideFoot}</SideFoot>
    </>
  );
}

/** 多个产物：一行一个，点开才是完整的产物行；只有一个时直接是产物行。 */
function Outputs({ entries, tool }: { entries: readonly SpaceEntry[]; tool: ReturnType<typeof footageToolOfJob> }) {
  const [open, setOpen] = useState<string | null>(null);
  if (entries.length === 1) return <ToolOutputRow entry={entries[0]!} fromTool={tool} compact />;
  const dir = entries[0]?.file?.path?.replace(/[\\/][^\\/]*$/, '');
  return (
    <div className={outputs}>
      {dir ? <span className={detail}>{M.outputsSaved(entries.length, saveDirLabel(dir))}</span> : null}
      {entries.map((entry) =>
        open === entry.id ? (
          <ToolOutputRow key={entry.id} entry={entry} fromTool={tool} compact />
        ) : (
          <RacButton key={entry.id} className={(rp) => outputRow(rp)} onPress={() => setOpen(entry.id)}>
            {entry.kind === 'audio' ? <AudioWave /> : entry.kind === 'image' ? <ImageIcon /> : <Filmstrip />}
            <span className={outputName}>{entry.name}</span>
            <ChevronRight />
          </RacButton>
        ),
      )}
    </div>
  );
}

function FootageRecord({ job, all, now }: { job: JobRecord; all: readonly JobRecord[]; now: number }) {
  const tool = footageToolOfJob(job);
  const info = toolById(tool);
  const entries = useJobOutputs([job.jobId]);
  const cancel = useCancelJob();
  const hide = useTools((s) => s.hide);
  const Icon = info ? TOOL_ICON[info.icon] : Filmstrip;
  const name = recordTitle(job, info?.name ?? '');
  const running = job.endedAt === null;
  const failed = didNotFinish(job);
  const line = running ? recordProgress(job, all, now) : null;
  const summary = recordSummary(job);
  const rerun = !running ? rerunOf(job) : null;
  return (
    <RecordCard running={running} failed={failed} label={name}>
      <div className={recordHead}>
        <span className={recordIcon}>
          <Icon />
        </span>
        <span className={recordTitleStyle}>{name}</span>
        <span className={detail}>{stateLabel(job, now)}</span>
      </div>
      <span className={recordText({ isOff: true })}>{[info?.name, recordMeta(job)].filter(Boolean).join(' · ')}</span>
      {line ? (
        <>
          <span className={detail}>{line.text}</span>
          <div className={recordRow}>
            <ProgressBar aria-label={M.progress} styles={progress} size="S" isIndeterminate={line.percent === null} {...(line.percent === null ? {} : { value: line.percent })} />
            <ActionButton isQuiet size="S" onPress={() => cancel(job.jobId)}>
              <Text>{RECORD_COPY.cancel}</Text>
            </ActionButton>
          </div>
        </>
      ) : null}
      {failed ? <p className={errorTitle}>{failureText(job)}</p> : null}
      {!running && !failed && summary.executor ? <p className={executor}>{summary.executor}</p> : null}
      {!running && !failed ? summary.warnings.map((w, i) => <p key={i} className={warn}>{w}</p>) : null}
      {!running && !failed && summary.nonCommercial ? <p className={warn}>{M.licenseResult}</p> : null}
      {entries.length ? <Outputs entries={entries} tool={tool} /> : null}
      {!running ? (
        <div className={recordRow}>
          {rerun ? <SectionLink onPress={() => goRerun(rerun, job.jobId)}>{rerun.label}</SectionLink> : null}
          <SectionLink onPress={() => hide(job.jobId)}>{RECORD_COPY.remove}</SectionLink>
        </div>
      ) : null}
    </RecordCard>
  );
}
