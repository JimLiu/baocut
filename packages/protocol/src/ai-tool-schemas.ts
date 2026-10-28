import { z } from 'zod';
import { MAX_ATTACHMENTS_PER_MESSAGE } from './limits.ts';
import { AI_TOOL_APPLY_KINDS, AI_TOOL_KINDS, AI_TOOL_PROMPT_MAX, AI_TOOL_SERIES_MAX, AI_TOOL_TOPIC_MAX_CHUNKS } from './pipelines.ts';
import { languageTag } from './language-schemas.ts';
import { skillSendListSchema } from './skill-schemas.ts';

/**
 * `ai-tool` 流程的参数（`pipelines.start` 的 `params`，产品设计 §5.10）：流程的 `parse` 用它校验，界面与测试也用它。
 * `chapters` 总是整篇：给了范围时拒绝。选材（`selection`，不与范围同用）、系列文章（`videoIds`）与重写一段（`section`，不与前几项同用）只给写作类工具，边界（`boundaries`）只给 `chapters`。
 */
const WRITE_ONLY: ReadonlySet<string> = new Set(AI_TOOL_APPLY_KINDS);

export const aiToolParamsSchema = z
  .object({
    videoId: z.string().min(1).max(128),
    tool: z.enum(AI_TOOL_KINDS),
    prompt: z.string().max(AI_TOOL_PROMPT_MAX),
    range: z
      .object({ start: z.number().finite().min(0), end: z.number().finite().min(0) })
      .strict()
      .refine((r) => r.end > r.start)
      .optional(),
    documentId: z.string().min(1).max(128).optional(),
    attachments: z.array(z.string().min(1).max(200)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
    skills: skillSendListSchema.optional(),
    provider: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(256).optional(),
    effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    uiLanguage: languageTag.optional(),
    selection: z
      .object({
        mode: z.literal('topic'),
        intent: z.string().min(1).max(2000).optional(),
        limit: z.number().int().min(1).max(AI_TOOL_TOPIC_MAX_CHUNKS).optional(),
        exclude: z.array(z.string().min(1).max(500)).max(AI_TOOL_TOPIC_MAX_CHUNKS * 4).optional(),
      })
      .strict()
      .optional(),
    videoIds: z.array(z.string().min(1).max(128)).max(AI_TOOL_SERIES_MAX - 1).optional(),
    boundaries: z.enum(['topic', 'model']).optional(),
    section: z
      .object({
        citationsArtifactId: z.string().min(1).max(200),
        index: z.number().int().min(0).max(10_000),
        exclude: z.array(z.string().min(1).max(500)).max(AI_TOOL_TOPIC_MAX_CHUNKS * 4).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((p) => !(p.tool === 'chapters' && p.range), { path: ['range'] })
  .refine((p) => !(WRITE_ONLY.has(p.tool) && (p.selection || p.videoIds)), { path: ['selection'] })
  .refine((p) => !(p.selection && p.range), { path: ['selection'] })
  .refine((p) => !(p.section && (WRITE_ONLY.has(p.tool) || p.range || p.selection || p.videoIds)), { path: ['section'] })
  .refine((p) => !(p.boundaries && p.tool !== 'chapters'), { path: ['boundaries'] })
  .refine((p) => !p.videoIds?.includes(p.videoId) && new Set(p.videoIds ?? []).size === (p.videoIds?.length ?? 0), { path: ['videoIds'] });
