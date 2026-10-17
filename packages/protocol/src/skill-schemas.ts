import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';
import { SKILL_ID_PATTERN, SKILL_LIMITS } from './skill.ts';

/** `skills.*` 与发送时点选的 skill：入站校验，由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);
const skillId = z.string().max(SKILL_LIMITS.id).regex(SKILL_ID_PATTERN, { error: () => V.skillIdChars().text });
/** skill 目录内的相对路径：`/` 分隔，不以 `/` 或盘符开头，不含 `..`、`.`、空段、反斜杠或控制字符。 */
const skillPath = z
  .string()
  .min(1)
  .max(SKILL_LIMITS.path)
  .refine((p) => !/[\\\u0000-\u001f]/.test(p), { error: () => V.pathBadChars().text })
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.startsWith('~'), { error: () => V.skillPathRelative().text })
  .refine((p) => !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..'), { error: () => V.pathBadSegments().text });
/** 本机的绝对路径：POSIX 的 `/…` 或 Windows 的 `C:\…`。不含 NUL。 */
const absolutePath = z
  .string()
  .max(4096)
  .regex(/^(?:\/|[A-Za-z]:[\\/])[^\0]*$/, { error: () => V.absolutePath().text });

/** `conversations.send` 的 `skill`（单个）与 `skills` 的每一项。 */
export const skillSendRefSchema = z.object({ id: skillId }).strict();
/** `conversations.send` 的 `skills`：按挂上的顺序，最多 `SKILL_LIMITS.perMessage` 个；重复的 id 由 Runtime 只算第一次。 */
export const skillSendListSchema = z.array(skillSendRefSchema).max(SKILL_LIMITS.perMessage);

const revision = z.number().int().min(1).max(1_000_000);
/** 改文件：写文本、从本机复制或删除。同一路径只能出现一次。 */
const fileChanges = z
  .array(
    z.union([
      z.object({ path: skillPath, text: z.string().max(SKILL_LIMITS.totalBytes) }).strict(),
      z.object({ path: skillPath, from: absolutePath }).strict(),
      z.object({ path: skillPath, remove: z.literal(true) }).strict(),
    ]),
  )
  .min(1)
  .max(SKILL_LIMITS.files * 2)
  .refine((list) => new Set(list.map((c) => c.path)).size === list.length, { error: () => V.duplicatePaths().text });
const title = z.string().trim().min(1).max(SKILL_LIMITS.name);

export const SKILL_PARAM_SCHEMAS = {
  'skills.list': z.object({}).strict(),
  'skills.get': z.object({ id: skillId, revision: revision.optional() }).strict(),
  'skills.readFile': z.object({ id: skillId, path: skillPath, revision: revision.optional() }).strict(),
  'skills.openHandle': z.object({ id: skillId, path: skillPath, revision: revision.optional() }).strict(),
  'skills.versions': z.object({ id: skillId }).strict(),
  'skills.setEnabled': z.object({ id: skillId, enabled: z.boolean() }).strict(),
  'skills.add': z.object({ path: absolutePath, id: skillId.optional(), commandId: id.optional() }).strict(),
  'skills.importGithub': z.object({ url: z.string().trim().min(1).max(2000), id: skillId.optional(), commandId: id.optional() }).strict(),
  'skills.remove': z.object({ id: skillId }).strict(),
  'skills.inspectPackage': z.object({ path: absolutePath }).strict(),
  'skills.installPackage': z
    .object({
      path: absolutePath,
      picks: z
        .array(
          z
            .object({
              prefix: z.string().max(SKILL_LIMITS.path),
              mode: z.enum(['new', 'update', 'copy']),
              title: title.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      commandId: id.optional(),
    })
    .strict(),
  'skills.create': z
    .object({
      name: z.string().trim().min(1).max(SKILL_LIMITS.name),
      title: title.optional(),
      description: z.string().trim().min(1).max(SKILL_LIMITS.description),
      body: z.string().max(SKILL_LIMITS.skillFileBytes),
      commandId: id.optional(),
    })
    .strict(),
  'skills.duplicate': z.object({ id: skillId, title: title.optional(), commandId: id.optional() }).strict(),
  'skills.write': z
    .object({ id: skillId, baseRevision: revision, changes: fileChanges, note: z.string().max(500).optional(), commandId: id.optional() })
    .strict(),
  'skills.restore': z.object({ id: skillId, revision, commandId: id.optional() }).strict(),
  'skills.export': z.object({ id: skillId, path: absolutePath }).strict(),
  'brands.list': z.object({}).strict(),
  'brands.get': z.object({ projectId: id }).strict(),
  'brands.readFile': z.object({ projectId: id, path: skillPath }).strict(),
  'brands.openHandle': z.object({ projectId: id, path: skillPath }).strict(),
  'brands.write': z.object({ projectId: id, changes: fileChanges, commandId: id.optional() }).strict(),
  'brands.createFromSkill': z.object({ projectId: id, skillId, commandId: id.optional() }).strict(),
} as const;
