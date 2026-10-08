import type { ProvidersAgentMessages } from './providers-agent.ts';

export const nl: ProvidersAgentMessages = {
  codexUpgradeHint: "Werk de Codex CLI bij (bijvoorbeeld npm install -g @openai/codex@latest) en controleer opnieuw",
  codexImageModel: "Codex-afbeeldingsgeneratie (model gekozen door Codex en je account)",
  codexImageNotes:
    "Genereert met het Codex-account dat op deze computer is ingelogd: één PNG per keer, één taak tegelijk, meestal in één of twee minuten. Grootte en seed kunnen niet worden ingesteld (verzoeken met die parameters worden geweigerd) en de pixelgrootte hangt af van het resultaat. Gebruikt je abonnementsquota; de resterende quota zijn onbekend. Inschakelen betekent toestemming om prompts naar je Codex-account te sturen.",
  imagesOnly: (p: { label: string }) => `${p.label} kan alleen afbeeldingen genereren`,
  onePngOnly: (p: { label: string }) => `${p.label} genereert één PNG tegelijk en accepteert geen size of seed`,
  unavailable: (p: { label: string; message: string }) => `${p.label} is niet beschikbaar: ${p.message}`,
  sessionNotStarted: (p: { label: string; error: string }) => `${p.label}: de sessie is niet gestart: ${p.error}`,
  timedOut: (p: { label: string; minutes: number }) => `${p.label} is niet voltooid binnen ${p.minutes} minuten en is onderbroken`,
  exited: (p: { label: string; message: string }) => `${p.label} is onverwacht afgesloten: ${p.message}`,
  notCompleted: (p: { label: string; reason: string }) => `${p.label} heeft deze generatie niet voltooid: ${p.reason}`,
  turnInterrupted: "de beurt is onderbroken",
  noImage: (p: { label: string }) => `${p.label} heeft geen afbeelding gegenereerd`,
  noImageReply: (p: { label: string; reply: string }) => `${p.label} heeft geen afbeelding gegenereerd: ${p.reply}`,
  unknownError: "Onbekende fout",
  processExited: "Het proces is afgesloten",
  turnNotStarted: (p: { error: string }) => `De beurt is niet gestart: ${p.error}`,
};
