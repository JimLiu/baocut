import { z } from 'zod';
import { FONT_CATEGORIES, FONT_SCRIPTS, type FontCategory, type FontScript } from './fonts.ts';

/** `fonts.*` 的入站校验（架构设计 §9.1），由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);
const family = z.string().trim().min(1).max(200);
const weight = z.number().int().min(1).max(1000);
const face = z.object({ family, weight, italic: z.boolean() }).strict();
const style = z.object({ weight, italic: z.boolean() }).strict();
const empty = z.object({}).strict();

export const FONT_PARAM_SCHEMAS = {
  'fonts.resolve': z.object({ faces: z.array(face).min(1).max(32), download: z.boolean().optional() }).strict(),
  'fonts.catalogue': z
    .object({
      query: z.string().max(200).optional(),
      category: z.enum(FONT_CATEGORIES as [FontCategory, ...FontCategory[]]).optional(),
      script: z.enum(FONT_SCRIPTS as [FontScript, ...FontScript[]]).optional(),
      families: z.array(family).max(200).optional(),
      states: z
        .array(z.enum(['built-in', 'installed', 'downloaded', 'downloadable', 'downloading', 'failed', 'unavailable']))
        .max(7)
        .optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    })
    .strict(),
  'fonts.download': z.object({ family, faces: z.array(style).min(1).max(40).optional(), commandId: id.optional() }).strict(),
  'fonts.downloaded': empty,
  'fonts.remove': z.object({ family, faces: z.array(style).min(1).max(40).optional() }).strict(),
  'fonts.clear': empty,
  'fonts.sample': z.object({ family }).strict(),
  'fonts.usage': z
    .object({ videoId: id, sequenceId: id.optional(), burnCaptions: z.boolean().optional(), download: z.boolean().optional() })
    .strict(),
};
