import { z } from 'zod';
import { CODE_BUNDLE_CONTRACTS, COMPOSITION_INLINE_LIMITS, COMPOSITION_PREVIEW_MAX_FRAMES } from './code-bundle.ts';

/**
 * `compositions.*` 的入站校验（架构设计 §8），由 `schemas.ts` 并进方法表。形状与工具 compositions_preview / compositions_import
 * 的参数相同；「几种来源给且只给一个」「durationSeconds 要和 fps 一起给」由服务检查。
 */

const id = z.string().min(1).max(200);
const revision = z.string().regex(/^\d+$/);
const seconds = z.string().regex(/^\d+(\.\d+)?$/);
const bundlePath = z.string().min(1).max(4096);
const compositionId = z.string().min(1).max(200);

const inlineFiles = z
  .array(
    z
      .object({
        path: z.string().min(1).max(512),
        content: z.string().max(COMPOSITION_INLINE_LIMITS.maxFileBytes).optional(),
        contentBase64: z
          .string()
          .max(COMPOSITION_INLINE_LIMITS.maxFileBytes * 2)
          .optional(),
      })
      .strict(),
  )
  .min(1)
  .max(COMPOSITION_INLINE_LIMITS.maxFiles);

const manifest = z
  .object({
    width: z.number().int().min(16).max(8192).optional(),
    height: z.number().int().min(16).max(8192).optional(),
    fps: z.number().positive().max(240).optional(),
    durationSeconds: z.number().positive().max(3600).optional(),
    alpha: z.boolean().optional(),
    bundleId: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .optional(),
    revision: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,50}$/)
      .optional(),
    entry: z.string().min(1).max(512).optional(),
    contract: z.enum(CODE_BUNDLE_CONTRACTS).optional(),
  })
  .strict();

export const COMPOSITION_PARAM_SCHEMAS = {
  'compositions.preview': z
    .object({
      video: id,
      files: inlineFiles.optional(),
      path: bundlePath.optional(),
      assetId: id.optional(),
      at: z.array(seconds).min(1).max(COMPOSITION_PREVIEW_MAX_FRAMES),
      compositionId: compositionId.optional(),
      manifest: manifest.optional(),
    })
    .strict(),
  'compositions.import': z
    .object({
      video: id,
      files: inlineFiles.optional(),
      path: bundlePath.optional(),
      name: z.string().min(1).max(200).optional(),
      compositionId: compositionId.optional(),
      manifest: manifest.optional(),
      place: z.object({ track: id.optional(), at: seconds.optional() }).strict().optional(),
      replace: z.object({ itemId: id }).strict().optional(),
      register: z.boolean().optional(),
      revision: revision.optional(),
      commandId: id.optional(),
      conversationId: id.optional(),
    })
    .strict(),
};
