import type { JobsCommonMessages } from './common.ts';

export const nl: JobsCommonMessages = {

  listSeparator: ", ",

  withCause: (p: { message: string; cause: string }) => `${p.message}: ${p.cause}`,
};
