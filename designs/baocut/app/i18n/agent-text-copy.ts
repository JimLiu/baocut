import { intlLocale, defineMessages, LOCALE_NATIVE_NAMES, isLanguagePreference, resolveLanguage, setLocale, type LanguagePreference } from '../../../../packages/protocol/src/i18n.ts';
import { zhHans } from './agent-text-copy.zh-Hans.ts';
import { zhHant } from './agent-text-copy.zh-Hant.ts';
import { ja } from './agent-text-copy.ja.ts';
import { ko } from './agent-text-copy.ko.ts';
import { es } from './agent-text-copy.es.ts';
import { fr } from './agent-text-copy.fr.ts';
import { de } from './agent-text-copy.de.ts';
import { nl } from './agent-text-copy.nl.ts';
import { ptBR } from './agent-text-copy.pt-BR.ts';
import { it } from './agent-text-copy.it.ts';
import { ru } from './agent-text-copy.ru.ts';
import { pl } from './agent-text-copy.pl.ts';
import { tr } from './agent-text-copy.tr.ts';
import { vi } from './agent-text-copy.vi.ts';

const en = {
  method: "Generation method",
  api: "Model API",
  agent: "Signed-in Agent",
  pending: "Pending prototype: Agent text generation is not connected. This only simulates interaction and results; no Agent or API is called.",
  agentLabel: "Which Agent",
  manageAgent: "Manage Agents…",
  defaultModel: "Agent default model",
  connectedDefault: "Connected · Agent default model",
  accountNote: "Uses this Agent’s signed-in account and default model, with no additional API key. Allowances and charges depend on the account; this is not guaranteed to be free.",
  dataNote: "The request and material go to the selected Agent account’s service. The proposed call only generates text, without reading project files, using editing tools or changing the source material.",
  candidates: "Initial prototype candidates: Codex CLI and Claude Code. Real integration and platform support require separate validation.",
  outputNote: "Prototype example · no Agent or API was called",
  chooseAgent: "Choose Codex CLI or Claude Code",
  missing: "Not installed",
  disabled: "Disabled",
  signedOut: "Signed out",
  unknownLogin: "Sign-in status unknown",
  needsAttention: "Needs attention",
  lede: "Describe the text to generate and optionally attach a Space document or subtitles. The result is a document in the save location and a Space item.",
  requestMaterial: "the request and material",
  request: "the request",
  attached: (name: string) => ` · Attached: ${name}`,
  tooLong: (total: number, max: number) => `Request and material total ${total.toLocaleString(intlLocale())} characters, above the ${max.toLocaleString(intlLocale())} character limit.`,
  agentModel: (name: string) => `${name} · Agent default model`,
  unavailable: (name: string, reason: string) => `${name} · ${reason}`,
};
export type AgentTextMessages = typeof en;
export const translations = {"zh-Hans": zhHans, "zh-Hant": zhHant, "ja": ja, "ko": ko, "es": es, "fr": fr, "de": de, "nl": nl, "pt-BR": ptBR, "it": it, "ru": ru, "pl": pl, "tr": tr, "vi": vi};
export const messages = defineMessages(en, translations);

/** The existing prototype preference uses native language names; the shared resolver supplies the English fallback. */
export function messagesFor(preference: string, systemTags: readonly string[] = []): AgentTextMessages {
  const named = Object.entries(LOCALE_NATIVE_NAMES).find(([, label]) => label === preference)?.[0];
  const value = isLanguagePreference(preference) ? preference : (named ?? 'system') as LanguagePreference;
  setLocale(resolveLanguage(value, systemTags));
  return messages;
}
