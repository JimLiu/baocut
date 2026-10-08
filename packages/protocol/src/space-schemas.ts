import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';
import { SPACE_LIST_MAX_LIMIT, SPACE_SEARCH_MAX_LIMIT } from './space.ts';

/** `space.*` 的入站校验（架构设计 §5.7、§5.11），由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);
const filePath = z.string().min(1).max(4096);
const entry = z.object({ entryId: id }).strict();
const kind = z.enum(['video', 'export', 'video-file', 'image', 'audio', 'subtitle', 'document', 'package', 'template']);
const status = z.enum(['generating', 'candidate', 'applied', 'published', 'source-changed', 'missing', 'failed', 'none']);
const searchKind = z.enum(['speech', 'caption', 'translation', 'chapter']);
const oneOrMany = <T extends z.ZodType>(item: T) => z.union([item, z.array(item).min(1).max(20)]);

export const SPACE_PARAM_SCHEMAS = {
  'space.list': z
    .object({
      projectId: id.nullable().optional(),
      kind: oneOrMany(kind).optional(),
      status: oneOrMany(status).optional(),
      videoId: id.optional(),
      favorite: z.boolean().optional(),
      trash: z.enum(['exclude', 'only', 'include']).optional(),
      cursor: z
        .string()
        .regex(/^\d{1,9}$/)
        .optional(),
      limit: z.number().int().positive().max(SPACE_LIST_MAX_LIMIT).optional(),
    })
    .strict(),
  'space.get': entry,
  'space.search': z
    .object({
      query: z.string().max(500),
      projectId: id.nullable().optional(),
      videoIds: z.array(id).max(200).optional(),
      kinds: z.array(searchKind).min(1).max(4).optional(),
      speaker: z.string().trim().min(1).max(200).optional(),
      limit: z.number().int().positive().max(SPACE_SEARCH_MAX_LIMIT).optional(),
    })
    .strict()
    .refine((p) => p.query.trim().length > 0 || p.speaker !== undefined, { error: () => V.searchNeedsQuery().text }),
  'space.import': z.object({ projectId: id, path: filePath, name: z.string().trim().min(1).max(200).optional() }).strict(),
  'space.rename': z.object({ entryId: id, name: z.string().trim().max(200).nullable() }).strict(),
  'space.setFavorite': z.object({ entryId: id, favorite: z.boolean() }).strict(),
  'space.trash': entry,
  'space.restore': entry,
  'space.purge': entry,
  'space.openForEdit': entry,
  'space.thumbnail': entry,
  'space.rebuildIndex': z.object({}).strict(),
  'space.continueInConversation': z.object({ entryId: id, conversationId: id.optional(), commandId: id.optional() }).strict(),
} as const;
