import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';
import { TOOL_CANDIDATES_MAX_LIMIT, TOOL_INSPECT_MAX_INPUTS } from './tool-catalogue.ts';

/** `tools.*`（工具目录，架构设计 §7.9）的入站校验，由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);

export const TOOL_CATALOGUE_PARAM_SCHEMAS = {
  'tools.list': z.object({}).strict(),
  'tools.candidates': z
    .object({
      toolId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, { error: () => V.toolIdChars().text }),
      projectId: id.nullable().optional(),
      cursor: z
        .string()
        .regex(/^\d{1,9}$/)
        .optional(),
      limit: z.number().int().positive().max(TOOL_CANDIDATES_MAX_LIMIT).optional(),
    })
    .strict(),
  'tools.inspectInputs': z
    .object({
      inputs: z.array(z.union([z.string().min(1).max(4096), z.object({ entryId: id }).strict()])).max(TOOL_INSPECT_MAX_INPUTS),
      stabilizer: z.boolean().optional(),
    })
    .strict(),
};
