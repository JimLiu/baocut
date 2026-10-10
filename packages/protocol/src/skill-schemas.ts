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

export const SKILL_PARAM_SCHEMAS = {
  'skills.list': z.object({}).strict(),
  'skills.get': z.object({ id: skillId }).strict(),
  'skills.readFile': z.object({ id: skillId, path: skillPath }).strict(),
  'skills.setEnabled': z.object({ id: skillId, enabled: z.boolean() }).strict(),
  'skills.add': z.object({ path: absolutePath, id: skillId.optional(), commandId: id.optional() }).strict(),
  'skills.importGithub': z.object({ url: z.string().trim().min(1).max(2000), id: skillId.optional(), commandId: id.optional() }).strict(),
  'skills.remove': z.object({ id: skillId }).strict(),
} as const;
