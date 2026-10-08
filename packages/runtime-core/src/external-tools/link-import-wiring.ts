import path from 'node:path';
import { RpcError, type Id } from '@baocut/protocol';
import {
  LINK_IMPORT_PIPELINE,
  linkImportPipeline,
  type HostLookup,
  type JobManager,
  type LinkSources,
  type PipelineDefinition,
  type ProbeToolResolver,
} from '@baocut/jobs';
import { withPipelineGrants } from '../grants/pipeline-grants.ts';
import type { ExtraPipelineContext } from '../models/model-jobs.ts';
import type { ExternalToolService } from './external-tool-service.ts';
import { resolveDownloadsDirectory } from './downloads-directory.ts';
import { YT_DLP } from './tool-manifests.ts';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';

/**
 * 「下载视频」流程在 Runtime 里的接线（架构设计 §7.9）：工具由外部工具服务给出（已安装、同意有效），下载目录按设置或主机 Downloads 决定，转写复用 `models.transcribe` 的提交。流程在 JobManager 建好时登记，这里的依赖（外部工具服务、设置、
 * Harness）在 Runtime 启动的后面几步才有，调用时再取。
 */
export interface LinkImportWiring {
  tools: () => ExternalToolService;
  settings: () => { downloadsDirectory: string | null; offlineStrict: boolean };
  /** 项目目录；不存在时 `not-found`。 */
  projectRoot: (projectId: Id) => string;
  /** 会话的来源目录（属于项目时是项目目录）；不存在时 `not-found`。 */
  conversationRoot: (conversationId: Id) => string;
  /** 已打开视频的来源（项目或会话）。 */
  videoSource: (videoId: Id) => { projectId: Id | null; conversationId: Id | null } | null;
  /** 兼容旧接线的输出根；下载目录使用设置或主机 Downloads。 */
  outputsDir: string;
  sources: LinkSources;
  ffprobe: ProbeToolResolver;
  /** `BAOCUT_FFMPEG` 给了绝对路径时传给 yt-dlp；否则它自己在 PATH 里找。 */
  ffmpegLocation?: () => Promise<string | null>;
  /** 测试注入的主机名解析（不访问真实的 DNS）。 */
  lookup?: HostLookup;
}

/** `saveTo: 'project'` 时项目里放下载文件的目录（与 `exports/`、`imports/` 并列）。 */
export const PROJECT_DOWNLOADS_DIR = 'downloads';

export function linkImportDefinition(wiring: LinkImportWiring, context: ExtraPipelineContext): PipelineDefinition<any, any> {
  const { videos, transcriber, targets, enabledGlossaries } = context;
  return withPipelineGrants(linkImportPipeline({
    tool: () => wiring.tools().resolveForUse(YT_DLP),
    destination: async (target) => {
      // 项目与会话先查在不在（不存在的照样拒绝），再按 `saveTo` 决定：归属项目里的 `downloads/`，否则下载目录。
      let projectDir: string | null = null;
      if (target.projectId !== undefined) projectDir = wiring.projectRoot(target.projectId);
      else if (target.conversationId !== undefined) wiring.conversationRoot(target.conversationId);
      else if (target.videoId !== undefined) {
        const source = wiring.videoSource(target.videoId);
        if (!source) throw new RpcError('not-found', RcExternalTools.videoNotOpen());
        if (source.projectId) projectDir = wiring.projectRoot(source.projectId);
        else if (source.conversationId) wiring.conversationRoot(source.conversationId);
      }
      // 不属于项目的会话的工作目录用户看不到：文件仍进下载目录。
      if (target.saveTo === 'project' && projectDir !== null) return path.join(projectDir, PROJECT_DOWNLOADS_DIR);
      return resolveDownloadsDirectory(wiring.settings().downloadsDirectory);
    },
    sources: wiring.sources,
    videos,
    ...(targets ? { targets } : {}),
    ffprobe: wiring.ffprobe,
    ...(wiring.ffmpegLocation ? { ffmpegLocation: wiring.ffmpegLocation } : {}),
    offlineStrict: () => wiring.settings().offlineStrict,
    transcribe: transcriber,
    ...(enabledGlossaries ? { enabledGlossaries } : {}),
    ...(wiring.lookup ? { lookup: wiring.lookup } : {}),
  }), context.grants, ['audio'], (plan) => plan.params.transcription ? [{ capability: 'transcribe', ...plan.params.transcription, dataKinds: ['audio'] }] : []);
}

/** Runtime 启动时：原始链接只留下还能重试的从链接导入流程引用的。 */
export async function pruneLinkSources(jobs: JobManager, sources: LinkSources): Promise<void> {
  const keep = new Set<string>();
  for (const record of jobs.list()) {
    // 完成的已经删过；失败、取消、中断的还能重试。
    if (record.kind !== 'pipeline' || record.pipeline?.name !== LINK_IMPORT_PIPELINE || record.state === 'completed') continue;
    const ref = record.pipeline.params.sourceRef;
    if (typeof ref === 'string') keep.add(ref);
  }
  await sources.prune(keep);
}
