import { z } from 'zod';

/** `recordings.*` 的入站校验（屏幕录制设计 §7、§12），由 `schemas.ts` 并进方法表；`record` 工具也用这份选项的形状。 */

const id = z.string().min(1).max(200);
const deviceId = z.string().min(1).max(400);

export const recordingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('display'), displayId: deviceId.optional() }).strict(),
  z.object({ kind: z.literal('window'), windowId: deviceId }).strict(),
  z
    .object({
      kind: z.literal('area'),
      displayId: deviceId.optional(),
      rect: z
        .object({
          x: z.number().finite(),
          y: z.number().finite(),
          width: z.number().finite().positive().max(100_000),
          height: z.number().finite().positive().max(100_000),
        })
        .strict(),
    })
    .strict(),
]);

export const recordingOptionsSchema = z
  .object({
    source: recordingSourceSchema,
    camera: deviceId.nullable(),
    microphone: deviceId.nullable(),
    systemAudio: z.boolean(),
    cursor: z.enum(['separate', 'baked', 'none']),
    keys: z.enum(['off', 'shortcuts', 'all']),
    fps: z.number().int().min(1).max(120),
    countdown: z.number().int().min(0).max(10),
    duration: z.number().finite().positive().max(24 * 3600).nullable(),
    autoZoom: z.boolean(),
    open: z.boolean(),
    includeSelf: z.boolean().optional(),
  })
  .strict();

export const recordingTargetSchema = z.union([
  z.object({ videoId: id, at: z.number().finite().nonnegative().max(1_000_000).optional() }).strict(),
  z
    .object({
      create: z.object({ name: z.string().trim().min(1).max(200).optional(), projectId: id.optional(), conversationId: id.optional() }).strict(),
    })
    .strict(),
]);

const one = z.object({ recordingId: id }).strict();
const current = z.object({ recordingId: id.optional() }).strict();

export const RECORDING_PARAM_SCHEMAS = {
  'recordings.sources': z.object({}).strict(),
  'recordings.list': z.object({}).strict(),
  'recordings.status': current,
  'recordings.start': z
    .object({ recordingId: id.optional(), options: recordingOptionsSchema.partial().optional(), target: recordingTargetSchema.optional() })
    .strict(),
  'recordings.cancel': one,
  'recordings.pause': current,
  'recordings.resume': current,
  'recordings.stop': current,
  'recordings.discard': one,
  'recordings.recover': one,
};
