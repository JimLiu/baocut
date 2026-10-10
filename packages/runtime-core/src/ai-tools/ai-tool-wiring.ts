import { framesToSeconds, sequenceDurationFrames, type Id } from '@baocut/protocol';
import type { PipelineDefinition } from '@baocut/jobs';
import type { ExtraPipelineContext } from '../models/model-jobs.ts';
import { withPipelineGrants } from '../grants/pipeline-grants.ts';
import { grantedTextGenerator } from '../grants/pipeline-grants.ts';
import type { ExportService } from '../exports/export-service.ts';
import type { TextPlanResult } from '../exports/export-plan.ts';
import type { AttachmentStore } from '../attachments.ts';
import type { SkillCatalog } from '../skills/skill-catalog.ts';
import { skillSystemPrompt } from '../skills/skill-brief.ts';
import type { VideoService } from '../videos/video-service.ts';
import { AI_TOOL_DATA_KINDS, aiToolPipeline } from './ai-tool-pipeline.ts';
import type { ContextWord } from './ai-tool-prompt.ts';

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
          return {
            duration: framesToSeconds(sequenceDurationFrames(sequence), sequence.fps),
            chapters: sequence.markers.filter((m) => m.kind === 'chapter').length,
          };
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
      async words(videoId, { documentId, range }) {
        const video = videos.mirror(videoId)?.video;
        if (!video) return [];
        const plan = await videos.exportPlan<TextPlanResult>(videoId, {
          kind: 'text',
          sequenceId: video.rootSequenceId,
          ranges: range ? [range] : [],
          documentIds: [documentId],
          scopeItemIds: [],
        });
        const part = plan.parts[0]?.plans[0];
        if (!part) return [];
        const offset = part.range.startSeconds;
        const seen = new Set<Id>();
        const words: ContextWord[] = [];
        for (const entry of part.entries) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          words.push({ id: entry.id, text: entry.text, paragraphStart: entry.paragraphStart === true, start: offset + entry.start });
        }
        return words;
      },
      skills: (refs) => skillSystemPrompt(wiring.skills(), refs),
      attachments: (ids) => wiring.attachments().resolve(ids),
      artifacts: context.jobs.artifacts,
    }),
    context.grants,
    dataKinds,
  );
}
