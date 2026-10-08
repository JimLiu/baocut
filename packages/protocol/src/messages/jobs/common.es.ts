import type { JobsCommonMessages } from './common.ts';
export const es: JobsCommonMessages = { listSeparator: ', ', withCause: (p) => `${p.message}: ${p.cause}` };
