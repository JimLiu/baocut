import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';
import { SPACE_HIT_MOMENTS_MAX, SPACE_LIST_MAX_LIMIT, SPACE_SEARCH_MAX_LIMIT } from './space.ts';
import { SEMANTIC_QUERY_MAX_CHARS, SPACE_RELATED_VIDEOS_MAX_LIMIT, SPACE_SEARCH_V2_MAX_LIMIT } from './semantic.ts';
import { AI_TOOL_SERIES_MAX, AI_TOOL_TOPIC_MAX_CHUNKS } from './pipelines.ts';

/** `space.*` 的入站校验（架构设计 §5.7、§5.11），由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);
const filePath = z.string().min(1).max(4096);
const entry = z.object({ entryId: id }).strict();
const kind = z.enum(['video', 'export', 'video-file', 'image', 'audio', 'subtitle', 'document', 'package', 'template', 'slides', 'design', 'design-system']);
const status = z.enum(['generating', 'candidate', 'applied', 'published', 'source-changed', 'missing', 'failed', 'none']);
const searchKind = z.enum(['speech', 'caption', 'translation', 'chapter']);
const semanticMode = z.enum(['lexical', 'semantic', 'hybrid']);
const semanticChannel = z.enum(['text', 'visual', 'audio']);
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
  // 查询文字的上限由服务按字符（码点）核对并报 `INPUT_TOO_LONG`；这里只挡明显过大的输入。
  'space.searchV2': z
    .object({
      query: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(SEMANTIC_QUERY_MAX_CHARS * 4) }).strict(),
        z.object({ kind: z.literal('image'), referenceId: id }).strict(),
        z.object({ kind: z.literal('audio'), referenceId: id }).strict(),
      ]),
      mode: semanticMode,
      channels: z.array(semanticChannel).min(1).max(3).optional(),
      projectId: id.nullable().optional(),
      videoIds: z.array(id).max(200).optional(),
      kinds: z.array(searchKind).min(1).max(4).optional(),
      view: z.enum(['source', 'sequence']).optional(),
      appearance: z.enum(['original', 'rendered']).optional(),
      limit: z.number().int().positive().max(SPACE_SEARCH_V2_MAX_LIMIT).optional(),
      cursor: z.string().min(1).max(2000).optional(),
    })
    .strict(),
  'space.indexStatus': z.object({ projectId: id.nullable().optional(), videoIds: z.array(id).max(200).optional() }).strict(),
  'space.indexBuild': z
    .object({
      projectId: id.nullable().optional(),
      videoIds: z.array(id).max(200).optional(),
      channels: z.array(semanticChannel).min(1).max(3).optional(),
      rebuild: z.boolean().optional(),
    })
    .strict(),
  'space.indexControl': z.object({ action: z.enum(['pause', 'resume', 'clear']) }).strict(),
  'space.resolveSearchHit': z.object({ hitId: z.string().min(1).max(8000) }).strict(),
  'space.citations': entry,
  'space.relevantChunks': z
    .object({
      intent: z.string().trim().min(1).max(SEMANTIC_QUERY_MAX_CHARS * 4),
      videoIds: z.array(id).min(1).max(AI_TOOL_SERIES_MAX),
      limit: z.number().int().positive().max(AI_TOOL_TOPIC_MAX_CHUNKS).optional(),
    })
    .strict(),
  'space.relatedVideos': z.object({ entryId: id, limit: z.number().int().positive().max(SPACE_RELATED_VIDEOS_MAX_LIMIT).optional() }).strict(),
  'space.import': z.object({ projectId: id, path: filePath, name: z.string().trim().min(1).max(200).optional() }).strict(),
  'space.rename': z.object({ entryId: id, name: z.string().trim().max(200).nullable() }).strict(),
  'space.setFavorite': z.object({ entryId: id, favorite: z.boolean() }).strict(),
  'space.trash': entry,
  'space.restore': entry,
  'space.purge': entry,
  'space.openForEdit': entry,
  'space.thumbnail': entry,
  'space.hitMoments': z
    .object({
      entryId: id,
      spans: z
        .array(
          z
            .object({
              clock: z.enum(['sequence', 'source']),
              startSec: z.number().finite().nonnegative().max(1_000_000),
              endSec: z.number().finite().nonnegative().max(1_000_000),
              documentId: id.nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(SPACE_HIT_MOMENTS_MAX),
    })
    .strict(),
  'space.rebuildIndex': z.object({}).strict(),
  'space.continueInConversation': z.object({ entryId: id, conversationId: id.optional(), commandId: id.optional() }).strict(),
} as const;
