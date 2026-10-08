import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';

/** `externalTools.*` 的入站校验（架构设计 §12.9），由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);
const name = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, { error: () => V.toolNameChars().text });
/** 本机的绝对路径：POSIX 的 `/…` 或 Windows 的 `C:\…`。不含 NUL。 */
const absolutePath = z
  .string()
  .max(4096)
  .regex(/^(?:\/|[A-Za-z]:[\\/])[^\0]*$/, { error: () => V.absolutePath().text });
/** 经网关表达的同意方式：界面或 CLI。会话里的批准（`agent-approval`）只由 Runtime 自己记。 */
const via = z.enum(['app', 'cli']);

export const EXTERNAL_TOOL_PARAM_SCHEMAS = {
  'externalTools.list': z.object({}).strict(),
  'externalTools.detect': z.object({ name: name.optional() }).strict(),
  'externalTools.install': z.object({ name, consent: z.boolean().optional(), via: via.optional(), commandId: id.optional() }).strict(),
  'externalTools.update': z.object({ name, command: z.string().min(1).max(8192).optional(), commandId: id.optional() }).strict(),
  'externalTools.setPath': z.object({ name, path: absolutePath.nullable() }).strict(),
  'externalTools.remove': z.object({ name }).strict(),
  'externalTools.consent': z.object({ name, grant: z.boolean(), via: via.optional() }).strict(),
  'externalTools.cookieBrowsers': z.object({}).strict(),
};
