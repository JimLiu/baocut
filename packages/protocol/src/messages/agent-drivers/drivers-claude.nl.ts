import type { DriversClaudeMessages } from './drivers-claude.ts';

export const nl: DriversClaudeMessages = {
  plan: "Claude Pro- of Max-abonnement",
  installHint: "Installeer Claude Code",
  signedOut: "Claude Code is niet ingelogd. Voer claude uit in een terminal en volg de instructies om in te loggen.",
  subscriptionPro: "Claude Pro-abonnement",
  subscriptionMax: "Claude Max-abonnement",
  subscriptionTeam: "Claude Team-abonnement",
  subscriptionEnterprise: "Claude Enterprise-abonnement",
  providerAnthropicAws: "Anthropic (AWS)",
  providerAnthropicGoogleCloud: "Anthropic (Google Cloud)",
  enterpriseGateway: "Enterprisegateway",
  claudeAccount: "Claude-account",
  longLivedToken: "Claude-abonnement (langdurig token)",
  apiKey: "Anthropic-API-sleutel",
  thirdPartyCloud: "Cloud van derden",

  fromSettings: (p: { key: string }) => `Uit de instellingen van Claude Code (env.${p.key})`,
  imageUnsupported: (p: { mimeType: string }) =>
    `Claude ondersteunt dit afbeeldingsformaat niet: ${p.mimeType} (ondersteund: JPEG, PNG, GIF, WebP)`,
  defaultModel: "standaardmodel",
  switchModelFailed: (p: { model: string; error: string }) => `Claude kan niet van model wisselen (${p.model}): ${p.error}`,

  autoUnsupported: (p: { model: string; reason: string }) =>
    `${p.model ? `Model ${p.model}` : "Het huidige model"} ondersteunt de toestemmingsmodus ‘auto’ van Claude niet${p.reason ? ` (${p.reason})` : ""}. Deze beurt gebruikt ‘Elke keer vragen’ en vraagt toestemming voor acties.`,
  apiRetry: (p: { error: string; attempt: number; max: number }) => `Claude-API-fout (${p.error}); nieuwe poging ${p.attempt}/${p.max}`,
  turnFailed: (p: { subtype: string }) => `Claude Code-beurt mislukt (${p.subtype})`,

  exitedPlanMode: (p: { plan: string; edit: string }) =>
    `Claude Code heeft de planmodus verlaten met het goedgekeurde plan en begint wijzigingen te maken. Zolang de toegangsmodus ‘${p.plan}’ is, worden die wijzigingen geweigerd. Wijzig de toegangsmodus naar ‘${p.edit}’ of een ander niveau om door te gaan.`,
};
