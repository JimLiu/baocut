import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';

/** BCP 47 语言标签：交给 `Intl.getCanonicalLocales` 判断。单独成模块，免得 `ai-tool-schemas.ts` 与 `schemas.ts` 互相引用。 */
export const languageTag = z
  .string()
  .min(1)
  .max(35)
  .refine((tag) => {
    try {
      return Intl.getCanonicalLocales(tag).length === 1;
    } catch {
      return false;
    }
  }, { error: () => V.languageTagInvalid().text });
