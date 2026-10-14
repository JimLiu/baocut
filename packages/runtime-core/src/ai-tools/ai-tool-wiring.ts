import { framesToSeconds, sequenceDurationFrames } from '@baocut/protocol';
import type { PipelineDefinition } from '@baocut/jobs';
import type { ExtraPipelineContext } from '../models/model-jobs.ts';
import { withPipelineGrants } from '../grants/pipeline-grants.ts';
import { grantedTextGenerator } from '../grants/pipeline-grants.ts';
import type { ExportService } from '../exports/export-service.ts';
import type { AttachmentStore } from '../attachments.ts';
import type { SkillCatalog } from '../skills/skill-catalog.ts';
import { skillSystemPrompt } from '../skills/skill-brief.ts';
import type { VideoService } from '../videos/video-service.ts';
import { AI_TOOL_DATA_KINDS, aiToolPipeline } from './ai-tool-pipeline.ts';
import { chapterMarksOf, sentenceMapOf, timelineWords } from './timeline-sentences.ts';
import type { SemanticServices } from '../space/semantic/services.ts';
import { USER_VIEWER } from '../space/space-queries.ts';
import { semanticError } from '../space/semantic/errors.ts';

/**
 * AI 工具「直接调模型」在 Runtime 里的接线（产品设计 §5.10）：流程在 JobManager 建好时登记，skill 目录、附件与导出服务在
 * Runtime 启动的后面几步才有，调用时再取。文稿用导出文稿同一份写法（`exports.renderText`），润色的词取引擎的文字计划
 * （时间线投影，剪掉的词不在里面），与导出、配音一致。
 */
export interface AiToolWiring {
  videos: VideoService;
  skills: () => SkillCatalog;
  attachments: () => AttachmentStore;
  exports: () => ExportService;
  /**
   * 本机语义检索（按主题选材）：在 Runtime 启动的后面才建好，调用时再取；没有时按主题退回整篇。范围用用户本人的：只有用户本人
   * 能选另几部视频（`prepare` 核对发起方），别的发起方只在它打开的这一部里挑。
   */
  semantic?: () => SemanticServices | null;
}

export function aiToolDefinition(wiring: AiToolWiring, context: ExtraPipelineContext): PipelineDefinition<any, any> {
  const { videos } = wiring;
  const dataKinds = [...AI_TOOL_DATA_KINDS];
  return withPipelineGrants(
    aiToolPipeline({
      videos: {
        state: (videoId) => context.videos.state(videoId),
        document: (videoId, documentId, revision) => context.videos.document(videoId, documentId, revision),
        apply: (videoId, request) => context.videos.apply(videoId, request),
        sequence(videoId) {
          const video = videos.mirror(videoId)?.video;
          const sequence = video?.sequences[video.rootSequenceId];
          if (!sequence) return null;
          const chapterMarks = chapterMarksOf(videos, videoId);
          return { duration: framesToSeconds(sequenceDurationFrames(sequence), sequence.fps), chapters: chapterMarks.length, chapterMarks };
        },
      },
      text: grantedTextGenerator(context.services.textGenerator(), context.grants, context.services, dataKinds),
      selectText: (target) => context.services.selectText(target),
      async transcript(videoId, { documentId, range }) {
        const rendered = await wiring.exports().renderText({
          videoId,
          settings: {
            kind: 'transcript',
            format: 'md',
            documentId,
            timestamps: true,
            speakers: true,
            chapters: true,
            ...(range ? { range } : {}),
          },
        });
        const output = rendered.outputs[0]!;
        return { content: output.content, paragraphs: output.entries, characters: output.words + output.cjkCharacters };
      },
      words: (videoId, { documentId, range }) => timelineWords(videos, videoId, documentId, range),
      async sentenceOf(videoId, documentId, revision) {
        return sentenceMapOf(await context.videos.document(videoId, documentId, revision));
      },
      skills: (refs) => skillSystemPrompt(wiring.skills(), refs),
      attachments: (ids) => wiring.attachments().resolve(ids),
      artifacts: context.jobs.artifacts,
      ...(wiring.semantic
        ? {
            async relevant({ videoIds, intent, limit, signal }) {
              const semantic = wiring.semantic!();
              if (!semantic) {
                return { chunks: [], coverage: { chapters: [], indexed: false, stale: false }, effectiveMode: 'none' as const, reason: 'MODEL_NOT_INSTALLED' as const };
              }
              return semantic.context(USER_VIEWER).findRelevantChunks({
                intent,
                scope: { videoIds, view: 'sequence' },
                channel: 'text',
                limit,
                order: 'time',
                neighbors: 1,
                kinds: ['speech'],
                signal,
              });
            },
            async embed(texts, signal) {
              const semantic = wiring.semantic!();
              if (!semantic) throw semanticError('MODEL_NOT_INSTALLED');
              return semantic.context(USER_VIEWER).embedTexts(texts, { role: 'document', signal });
            },
            async topicUnits(videoId, documentId) {
              return wiring.semantic!()?.context(USER_VIEWER).topicUnits({ videoId, documentId }) ?? null;
            },
          }
        : {}),
    }),
    context.grants,
    dataKinds,
  );
}
