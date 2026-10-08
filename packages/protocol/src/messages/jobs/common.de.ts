import type { JobsCommonMessages } from './common.ts';

export const de: JobsCommonMessages = {

  listSeparator: ", ",

  withCause: (p: { message: string; cause: string }) => `${p.message}: ${p.cause}`,
};
