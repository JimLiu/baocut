import { z } from 'zod';

/** `projects.git.*` 的入站校验（版本记录设计 §5），由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);

export const PROJECT_GIT_PARAM_SCHEMAS = {
  'projects.git.status': z.object({ projectId: id }).strict(),
  'projects.git.commit': z.object({ projectId: id, message: z.string().trim().min(1).max(10_000).optional() }).strict(),
  'projects.git.init': z.object({ projectId: id }).strict(),
  'projects.git.allowLocalConfig': z.object({ projectId: id, digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
};
