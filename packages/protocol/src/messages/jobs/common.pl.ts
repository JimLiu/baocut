import type { JobsCommonMessages } from './common.ts';

export const pl: JobsCommonMessages = {
  listSeparator: ', ',
  withCause: (p: { message: string; cause: string }) => `${p.message}: ${p.cause}`,
};
