import type { DriversClaudeMessages } from './drivers-claude.ts';

export const de: DriversClaudeMessages = {
  plan: "Claude Pro- oder Max-Abonnement",
  installHint: "Claude Code installieren",
  signedOut: "Claude Code ist nicht angemeldet. Zum Anmelden claude im Terminal ausführen und den Anweisungen folgen.",
  subscriptionPro: "Claude Pro-Abonnement",
  subscriptionMax: "Claude Max-Abonnement",
  subscriptionTeam: "Claude Team-Abonnement",
  subscriptionEnterprise: "Claude Enterprise-Abonnement",
  providerAnthropicAws: "Anthropic (AWS)",
  providerAnthropicGoogleCloud: "Anthropic (Google Cloud)",
  enterpriseGateway: "Enterprise-Gateway",
  claudeAccount: "Claude-Konto",
  longLivedToken: "Claude-Abonnement (langlebiges Token)",
  apiKey: "Anthropic-API-Schlüssel",
  thirdPartyCloud: "Cloud eines Drittanbieters",

  fromSettings: (p: { key: string }) => `Aus den Claude Code-Einstellungen (env.${p.key})`,
  imageUnsupported: (p: { mimeType: string }) =>
    `Claude unterstützt dieses Bildformat nicht: ${p.mimeType} (unterstützt: JPEG, PNG, GIF, WebP)`,
  defaultModel: "Standardmodell",
  switchModelFailed: (p: { model: string; error: string }) => `Claude konnte das Modell nicht wechseln (${p.model}): ${p.error}`,

  autoUnsupported: (p: { model: string; reason: string }) =>
    `${p.model ? `Modell ${p.model}` : "Das aktuelle Modell"} unterstützt den Berechtigungsmodus „auto“ von Claude nicht${p.reason ? ` (${p.reason})` : ""}. Diese Runde läuft mit „Jedes Mal fragen“; vor Aktionen wird nachgefragt.`,
  apiRetry: (p: { error: string; attempt: number; max: number }) => `Claude-API-Fehler (${p.error}); erneuter Versuch ${p.attempt}/${p.max}`,
  turnFailed: (p: { subtype: string }) => `Claude Code-Runde fehlgeschlagen (${p.subtype})`,

  exitedPlanMode: (p: { plan: string; edit: string }) =>
    `Claude Code hat den Planungsmodus mit dem genehmigten Plan verlassen und beginnt mit Änderungen. Solange der Zugriffsmodus „${p.plan}“ ist, werden diese Änderungen abgelehnt. Zum Fortfahren den Zugriffsmodus ändern zu „${p.edit}“ oder einer anderen Stufe.`,
};
