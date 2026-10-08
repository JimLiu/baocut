import { SPEAKERS_PIPELINE, readSpeakerProposal, speakerApplyOperations, type JobManager } from '@baocut/jobs';
import { RpcError, type ApplySpeakersParams, type EditResult, type Id, type SpeakersSummary } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { EngineProtection, VideoService } from '../videos/video-service.ts';
import { RcCommon, RcModels } from '@baocut/protocol/messages/runtime-core';

/**
 * `edits.applySpeakers`（命令与协议规范 §4.1）：把一次识别说话人（`speakers` 流程）的提案应用到视频，一笔以调用者为
 * 行为者的编辑事务（与 `edits.apply` 相同，`edits.undo` 撤销与重做）。
 *
 * 任务要是这个视频的、已完成的 `speakers` 流程；转写或它的译文在识别之后改过时 `conflict`（`STALE_JOB_INPUT`）。
 */
export async function applySpeakerProposal(
  deps: { videos: VideoService; jobs: Pick<JobManager, 'inspect' | 'artifacts'> },
  params: ApplySpeakersParams,
  principal: TrustedPrincipal,
  provenance: { taskId?: Id; protections?: EngineProtection[] } = {},
): Promise<EditResult> {
  const job = deps.jobs.inspect(params.jobId);
  if (job.pipeline?.name !== SPEAKERS_PIPELINE) {
    throw new RpcError('invalid-request', RcModels.notSpeakersJob(), { jobId: params.jobId });
  }
  if (job.videoId !== params.videoId) {
    throw new RpcError('invalid-request', RcModels.jobNotForVideo(), { jobId: params.jobId, videoId: job.videoId });
  }
  const summary = job.pipeline.summary as SpeakersSummary | null;
  if (job.state !== 'completed' || !summary) {
    throw new RpcError('conflict', RcModels.speakersNotDone(), { jobId: params.jobId, state: job.state });
  }
  const proposal = await readSpeakerProposal(deps.jobs.artifacts, summary.proposalArtifactId).catch((error: unknown) => {
    throw new RpcError('conflict', RcModels.speakersCleaned(), {
      code: 'STALE_JOB_INPUT',
      jobId: params.jobId,
      cause: error instanceof Error ? error.message : String(error),
    });
  });
  const state = deps.videos.mirror(params.videoId)?.video;
  if (!state) throw new RpcError('not-found', RcCommon.videoNotOpen());
  const reader = {
    state: () => ({ revision: state.revision, rootSequenceId: state.rootSequenceId, documents: state.documents }),
    document: async (videoId: Id, documentId: Id, revision?: string) => {
      const content = await deps.videos.document(videoId, documentId, revision);
      return { revision: content.revision, body: content.body };
    },
  };
  const plan = await speakerApplyOperations(reader, proposal, params.names);
  return deps.videos.apply(
    {
      videoId: params.videoId,
      commandId: params.commandId,
      expectedRevision: state.revision,
      operations: plan.operations,
      label: plan.label,
    },
    principal,
    provenance,
  );
}
