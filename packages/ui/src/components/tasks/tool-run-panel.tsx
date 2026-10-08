import type { JobRecord } from '@baocut/protocol';
import { Button, Content, Heading, InlineAlert } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { jobRemedy } from '../../model/task-facts.ts';
import { videoTargetOf } from '../../model/space.ts';
import type { VideoToolId } from '../../model/tool-catalog.ts';
import { ambiguousAssets, opensMovie, phase, runInput, runOpts } from '../../model/tool-runs.ts';
import { useShell } from '../../state/shell-store.ts';
import { GrantCard, ToolSteps, useRunTitle, useRunView } from '../tools/tool-run-view.tsx';
import { RUN_COPY, TASK_RUN_COPY } from '../tools/tools-copy.ts';
import { useRunRetry, useVideoTools } from '../tools/use-video-tools.ts';

/*
 * 后台任务详情里的视频工具运行（设计稿 tool-run-view.jsx `ToolTaskPanel`、page-tasks.jsx）：按 Runtime 给的步骤显示进度；
 * 停住时说停在哪一步、可以从这一步重试（被当场授权拒绝时在这里确认）；完成后「打开编辑」；「查看结果 / 回到工具」打开
 * 工具页的这次运行。
 */

const panel = style({ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16, maxWidth: 560 });
const buttons = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });

export function ToolRunPanel({ job, tool }: { job: JobRecord; tool: VideoToolId }) {
  const go = useShell((s) => s.go);
  const openVideo = useShell((s) => s.openVideo);
  const setView = useVideoTools((s) => s.setView);
  const retry = useRunRetry(job.jobId);
  const { meta, entry } = useRunTitle(job);
  const run = useRunView(job);
  if (!run) return null;
  const done = run.status === 'done';
  const failed = run.status === 'failed';
  const stopped = failed || run.status === 'cancelled';
  // 转录停在「主轨上有几个素材」时要在工具页选素材重新开始，这里不给重试。
  const assets = ambiguousAssets(job);
  const remedy = failed ? jobRemedy(job) : null;
  const keepsVideo = run.steps.some((s) => s.name === 'create' && s.status === 'done');
  const input = meta?.input ?? runInput(job);
  const opts = meta?.target ? { target: meta.target, transcribe: meta.transcribe } : runOpts(job);
  const canOpen = done && !!entry && opensMovie(tool, input, opts);

  const toTool = () => {
    setView(tool, job.jobId);
    go({ tab: 'tools', tool });
  };
  const openEntry = () => entry && openVideo(videoTargetOf(entry), { conversationId: null, projectId: entry.source.projectId });

  return (
    <div className={panel}>
      {run.steps.length ? <ToolSteps list={run.steps} /> : null}
      {failed ? (
        <InlineAlert variant="negative">
          <Heading>{run.steps.length ? phase(run) : TASK_RUN_COPY.stopped}</Heading>
          <Content>
            {assets ? RUN_COPY.ambiguousBody : RUN_COPY.failedBody(run.error ?? RUN_COPY.unknown, keepsVideo)}
            {remedy ? ` ${remedy.hint}` : ''}
          </Content>
        </InlineAlert>
      ) : null}
      {stopped && !assets && retry.asking ? <GrantCard items={retry.asking} onAgree={retry.agree} busy={retry.busy} /> : null}
      <div className={buttons}>
        {stopped && !assets ? (
          <Button variant="accent" size="S" isPending={retry.busy && !retry.asking} isDisabled={!!retry.asking} onPress={retry.retry}>
            {RUN_COPY.retry}
          </Button>
        ) : null}
        {remedy ? (
          <Button variant="secondary" size="S" onPress={() => go(remedy.target)}>
            {remedy.label}
          </Button>
        ) : null}
        {canOpen ? (
          <Button variant="accent" size="S" onPress={openEntry}>
            {RUN_COPY.open}
          </Button>
        ) : null}
        <Button variant="secondary" size="S" onPress={toTool}>
          {done ? TASK_RUN_COPY.viewResult : TASK_RUN_COPY.backToTool}
        </Button>
      </div>
    </div>
  );
}
