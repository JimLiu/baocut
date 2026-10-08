import type { DriversClaudeMessages } from './drivers-claude.ts';

export const fr: DriversClaudeMessages = {
  plan: "Abonnement Claude Pro ou Max",
  installHint: "Installer Claude Code",
  signedOut: "Claude Code n’est pas connecté. Exécutez claude dans un terminal et suivez les instructions de connexion.",
  subscriptionPro: "Abonnement Claude Pro",
  subscriptionMax: "Abonnement Claude Max",
  subscriptionTeam: "Abonnement Claude Team",
  subscriptionEnterprise: "Abonnement Claude Enterprise",
  providerAnthropicAws: "Anthropic (AWS)",
  providerAnthropicGoogleCloud: "Anthropic (Google Cloud)",
  enterpriseGateway: "Passerelle d’entreprise",
  claudeAccount: "Compte Claude",
  longLivedToken: "Abonnement Claude (jeton à longue durée)",
  apiKey: "Clé API Anthropic",
  thirdPartyCloud: "Cloud tiers",

  fromSettings: (p: { key: string }) => `Depuis les réglages Claude Code (env.${p.key})`,
  imageUnsupported: (p: { mimeType: string }) =>
    `Claude ne prend pas en charge ce format d’image : ${p.mimeType} (formats acceptés : JPEG, PNG, GIF, WebP)`,
  defaultModel: "modèle par défaut",
  switchModelFailed: (p: { model: string; error: string }) => `Claude n’a pas pu changer de modèle (${p.model}) : ${p.error}`,

  autoUnsupported: (p: { model: string; reason: string }) =>
    `${p.model ? `Le modèle ${p.model}` : "Le modèle actuel"} ne prend pas en charge le mode d’autorisation « auto » de Claude${p.reason ? ` (${p.reason})` : ""}. Ce tour utilise « demander à chaque fois » et demandera avant d’agir.`,
  apiRetry: (p: { error: string; attempt: number; max: number }) => `Erreur API Claude (${p.error}) ; nouvelle tentative ${p.attempt}/${p.max}`,
  turnFailed: (p: { subtype: string }) => `Échec du tour Claude Code (${p.subtype})`,

  exitedPlanMode: (p: { plan: string; edit: string }) =>
    `Claude Code a quitté le mode plan avec le plan approuvé et va commencer les modifications. Tant que le mode d’accès reste « ${p.plan} », ces modifications seront refusées. Pour continuer, choisissez le mode « ${p.edit} » ou un autre niveau.`,
};
