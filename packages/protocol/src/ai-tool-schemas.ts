import { z } from 'zod';
import { MAX_ATTACHMENTS_PER_MESSAGE } from './limits.ts';
import { AI_TOOL_KINDS, AI_TOOL_PROMPT_MAX } from './pipelines.ts';
import { languageTag } from './language-schemas.ts';
import { skillSendListSchema } from './skill-schemas.ts';

/**
 * `ai-tool` 流程的参数（`pipelines.start` 的 `params`，产品设计 §5.10）：流程的 `parse` 用它校验，界面与测试也用它。
 * `chapters` 总是整篇：给了范围时拒绝。
 */
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
    uiLanguage: languageTag.optional(),
  })
  .strict()
  .refine((p) => !(p.tool === 'chapters' && p.range), { path: ['range'] });
