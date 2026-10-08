import type { HarnessRunsMessages } from './harness-runs.ts';

export const nl: HarnessRunsMessages = {
  retrying: (p: { message: string }) => `${p.message} (opnieuw proberen)`,
  modeChanged: (p: { to: string; from: string }) => `Toegangsmodus gewijzigd naar ‘${p.to}’ (was ‘${p.from}’). Geldt voor latere acties.`,
  jobsCancelled: (p: { count: number }) =>
    `Annulering aangevraagd van onvoltooide achtergrondtaken in deze sessie (${p.count}). Voltooide resultaten blijven behouden.`,
  jobsCancelledGenerated: (p: { count: number }) =>
    `Annulering aangevraagd van onvoltooide achtergrondtaken in deze sessie (${p.count}, generatie of transcriptie). Voltooide resultaten blijven behouden.`,
  goalChangedStopped: "Doel gewijzigd: de oude taak is gestopt. Er wordt een nieuwe taak gestart voor het nieuwe doel.",
  goalChangedKept:
    "Doel gewijzigd: de beurt van de oude taak is gestopt. Achtergrondtaken die al zijn ingediend worden gewoon voltooid en hun uitvoer blijft behouden als kandidaten. Er wordt een nieuwe taak gestart voor het nieuwe doel.",
  stopReplyUnconfirmed: (p: { agent: string }) => `Gevraagd om te stoppen met antwoorden, maar kan niet bevestigen dat ${p.agent} is gestopt.`,
  stopUnconfirmed: (p: { agent: string }) => `Gevraagd om te stoppen, maar kan niet bevestigen dat ${p.agent} is gestopt.`,
  stopTimedOut: (p: { agent: string }) =>
    `${p.agent} heeft het stoppen niet binnen 10 seconden bevestigd, dus het proces is beëindigd. Stappen waarvan annulering niet is bevestigd kunnen al effect hebben gehad.`,
  agentRemovedNotice: (p: { agent: string }) =>
    `Agent ${p.agent} is verwijderd, dus deze taak is niet voltooid. Wijzigingen die al zijn gemaakt worden niet automatisch ongedaan gemaakt.`,
  agentRemoved: (p: { agent: string }) => `Agent ${p.agent} is verwijderd`,
  runtimeStoppedNotice: "De taak liep nog toen de Runtime stopte, dus die is onderbroken.",
  runtimeExitedNotice: "De Runtime is afgesloten terwijl de taak liep, dus de taak is niet voltooid. Wijzigingen die al zijn gemaakt worden niet automatisch ongedaan gemaakt.",
  runtimeExited: "De Runtime is afgesloten terwijl de taak liep",
  turnFailed: "De beurt is mislukt",
  processExited: (p: { agent: string; error: string }) => `${p.agent}-proces onverwacht afgesloten: ${p.error}`,
  noErrorMessage: "geen foutmelding",

  fileChangeSummary: "Bestanden bewerken",
};
