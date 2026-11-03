import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, ProgressBar, Text, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { DOWNLOAD_SOURCE_COPY } from '../../model/download-source.ts';
import { formatClock } from '../../model/format.ts';
import { formatBytes } from '../../model/space.ts';
import { jobPercent } from '../../model/task-list.ts';
import type { FootageToolId } from '../../model/tool-catalog.ts';
import { failureText } from '../../model/tools-records.ts';
import { M } from '../../model/tools-footage-copy.ts';
import {
  countText,
  etaText,
  footageOp,
  fpsText,
  MANAGED_SIZE,
  MATTE,
  MATTE_ISNET,
  RIFE,
  sentences,
  stemFiles,
  workload,
  type FootageForm,
  type FootageSource,
  type ManagedFootageTool,
  type Stabilizer,
} from '../../model/tools-footage.ts';
import { rejectionText } from '../../model/tools-transcode.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { SourcePicker } from '../models/download-sources.tsx';
import { detail, Gate, hintText, Row, Section } from './tool-parts.tsx';
import { FRAME_COPY } from './tools-copy.ts';
import { useCancelJob } from './use-tool-records.ts';
import type { ManagedToolsState } from './use-managed-tools.ts';

/*
 * 第一次用的下载同意与「这一次要多久」（设计稿 tool-footage-form.jsx `FootageToolCard`、`FootageLoad`）。下载卡写明来源、版本、大小与许可，点了才下；
 * IS-Net 的权重只许可非商业用途，先勾确认才能下。工作量按 `tools.inspectInputs` 读到的帧数算，长到要提醒时给「先试 10 秒」。
 */

const mono = style({ font: 'code-xs', color: 'gray-700', margin: 0, overflowWrap: 'anywhere' });
const warn = style({ margin: 0, font: 'ui-sm', color: 'orange-1000' });
const progress = style({ width: 'full' });
const progressLine = style({ display: 'flex', flexDirection: 'column', gap: 4, width: 'full' });
const stats = style({ display: 'grid', gridTemplateColumns: { default: '1fr', sm: ['1fr', '1fr', '1fr'] }, gap: 12, margin: 0 });
const stat = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const statName = style({ font: 'ui-xs', color: 'gray-600' });
const statValue = style({ margin: 0, font: 'title', color: { default: 'gray-900', isLong: 'orange-1000' } });

/** 这一次要的受管工具没装好时的下载卡；都装好时不显示（设计稿 `FootageToolCard`）。 */
export function FootageToolGate({ form, setForm, managed }: { form: FootageForm; setForm: (p: Partial<FootageForm>) => void; managed: ManagedToolsState }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const offline = useSetting('offline.strict');
  const cancel = useCancelJob();
  const [agreed, setAgreed] = useState<string | null>(null);
  const name = managed.missing as ManagedFootageTool | null;
  const tool = managed.tool;
  const jobId = tool?.installJobId ?? null;
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.jobId === jobId) : undefined));
  // 记下最近一次安装任务：结束后 `installJobId` 就没了，没做成时要说原因。
  const lastJob = useRef<string | null>(null);
  useEffect(() => {
    if (jobId) lastJob.current = jobId;
  }, [jobId]);
  const previous = useJobs((s) => (!jobId && lastJob.current ? s.jobs.find((j) => j.jobId === lastJob.current) : undefined));
  // 换了下载来源：下载地址跟着变，重新问一次。
  const endpoint = useSetting('tools.downloadEndpoint');
  const lastEndpoint = useRef(endpoint);
  useEffect(() => {
    if (lastEndpoint.current === endpoint) return;
    lastEndpoint.current = endpoint;
    managed.recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  if (managed.state !== 'missing' || !name) return null;

  const label = M.toolName[name];
  const offer = tool?.offer ?? null;
  const size = MANAGED_SIZE[name];
  const nonCommercial = name === MATTE_ISNET;
  const installing = managed.installing || !!jobId;
  const percent = job ? jobPercent(job) : null;
  const pack = name === MATTE || name === MATTE_ISNET;
  const pickOwn = () => {
    const take = (path: string | null | undefined) => {
      if (!path) return;
      runtime.setExternalToolPath(name, path).then(
        () => managed.recheck(),
        (e: unknown) => ToastQueue.negative(M.pickFailed(rejectionText(e)), { timeout: 8000 }),
      );
    };
    if (pack) void runtime.host.pickDirectory({ title: M.pickFolderTitle }).then(take);
    else if (runtime.host.pickFiles) void runtime.host.pickFiles({ title: M.pickProgramTitle, multiple: false }).then((paths) => take(paths[0]));
  };
  const facts = [
    offer ? M.factVersion(offer.version) : null,
    name === RIFE ? M.factSizeRife(size) : M.factSize(size),
    offer && !nonCommercial ? M.factLicense(offer.license) : null,
  ].filter(Boolean);
  const failed = previous && previous.state === 'failed' ? failureText(previous) : null;
  const blocked = offer?.blockedReason ?? null;

  return (
    <Gate
      title={`${M.gateTitle(label)} · ${M.firstUse}`}
      body={
        <>
          <p className={hintText}>{sentences(M.toolBody[name], M.toolKeep)}</p>
          <p className={hintText}>{facts.join(' · ')}</p>
          {offer?.url ? <p className={mono}>{offer.url}</p> : null}
          <Row label={DOWNLOAD_SOURCE_COPY.source}>
            <SourcePicker kind="tools" isDisabled={installing} />
          </Row>
          {tool?.reason && tool.state !== 'missing' ? <p className={warn}>{tool.reason}</p> : null}
          {blocked ? <p className={warn}>{blocked}</p> : null}
          {failed ? <p className={warn}>{M.installFailed(failed)}</p> : null}
          {nonCommercial && !installing ? (
            <>
              <p className={warn}>{M.licenseNote}</p>
              <Checkbox size="S" isSelected={agreed === name} onChange={(v) => setAgreed(v ? name : null)}>
                {M.licenseAck}
              </Checkbox>
            </>
          ) : null}
          {offline ? <p className={warn}>{M.offlineNote}</p> : null}
        </>
      }
      actions={
        installing ? (
          <span className={progressLine} role="status">
            <ProgressBar
              size="S"
              styles={progress}
              label={percent === null ? M.downloadingNoPercent : M.downloading(percent)}
              isIndeterminate={percent === null}
              {...(percent === null ? {} : { value: percent })}
            />
            <span className={detail}>{M.leaveNote}</span>
            {jobId ? (
              <Button variant="secondary" size="S" onPress={() => cancel(jobId)}>
                {M.cancel}
              </Button>
            ) : null}
          </span>
        ) : (
          <>
            {offline ? (
              <Button variant="secondary" size="S" onPress={() => go({ tab: 'settings', section: 'general' })}>
                {FRAME_COPY.goSettings}
              </Button>
            ) : (
              <Button variant="accent" size="S" isDisabled={!offer || !!blocked || (nonCommercial && agreed !== name)} onPress={managed.install}>
                {M.install(size)}
              </Button>
            )}
            {nonCommercial ? (
              <Button variant="secondary" size="S" onPress={() => setForm({ matteModel: 'fast' })}>
                {M.backToFast}
              </Button>
            ) : null}
            <Button variant="secondary" size="S" fillStyle="outline" onPress={pickOwn}>
              <Text>{pack ? M.pickFolder : M.pickProgram}</Text>
            </Button>
            <Button variant="secondary" size="S" fillStyle="outline" onPress={managed.recheck}>
              {M.recheck}
            </Button>
          </>
        )
      }
    />
  );
}

/** 这一次多少帧、要多久、占多少磁盘；没选文件时不显示。 */
export function FootageLoad({
  id,
  form,
  setForm,
  srcs,
  stabilizer,
  sepModel,
}: {
  id: FootageToolId;
  form: FootageForm;
  setForm: (p: Partial<FootageForm>) => void;
  srcs: readonly FootageSource[];
  stabilizer: Stabilizer;
  sepModel: string | null;
}) {
  if (!srcs.length) return null;
  const op = footageOp(id);
  const w = workload(id, form, srcs, stabilizer, sepModel);
  const separate = op === 'separate';
  const long = w.level !== 'ok';
  const trying = form.ranged && form.start === 0 && form.end === 10;
  const canTry = long && w.hasVideo && !trying;
  const first = w.plans.find((p) => p.kind === 'video') ?? null;
  const showOutput = (op === 'interpolate' || op === 'upscale') && !!first;
  const rate = op === 'remove-background' ? M.rateMeasuredCpu : separate ? M.rateMeasuredSeparate : M.rateEstimated;
  return (
    <Section
      title={M.loadTitle}
      aside={
        canTry ? (
          <Button variant="secondary" size="S" onPress={() => setForm({ ranged: true, start: 0, end: 10 })}>
            {M.tryShort}
          </Button>
        ) : null
      }>
      <dl className={stats}>
        <div className={stat}>
          <dt className={statName}>{M.loadInput}</dt>
          <dd className={statValue({ isLong: false })}>{separate ? formatClock(w.audioSeconds) : w.hasVideo ? M.frames(countText(w.frames)) : M.images(srcs.length)}</dd>
          <span className={detail}>
            {separate
              ? `${M.filesCount(srcs.length)} · ${M.wavs(srcs.length * stemFiles(form.stems))}`
              : srcs.length > 1
                ? M.filesCount(srcs.length)
                : first
                  ? M.loadSource(formatClock(first.seconds ?? 0), fpsText(first.fps ?? 0))
                  : ''}
          </span>
        </div>
        {showOutput ? (
          <div className={stat}>
            <dt className={statName}>{M.loadOutput}</dt>
            <dd className={statValue({ isLong: false })}>{M.frames(countText(w.outFrames))}</dd>
            <span className={detail}>{M.loadOutputDetail(first!.outWidth, first!.outHeight, fpsText(first!.outFps ?? 0), formatClock(w.outSeconds))}</span>
          </div>
        ) : null}
        <div className={stat}>
          <dt className={statName}>{M.loadEta}</dt>
          <dd className={statValue({ isLong: long })}>{etaText(w.seconds)}</dd>
        </div>
      </dl>
      <span className={detail}>{M.diskLine(formatBytes(w.outBytes), formatBytes(w.scratch))}</span>
      {long ? <p className={warn}>{sentences(w.level === 'veryLong' ? M.veryLongNote : M.longNote, M.longAdvice)}</p> : null}
      <span className={detail}>{sentences(rate, separate ? M.queueNote : M.rateAfter)}</span>
    </Section>
  );
}
