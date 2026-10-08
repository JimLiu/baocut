import type { ToolUpdateMessages } from './tool-update.ts';

export const nl: ToolUpdateMessages = {
  standalone: "Officieel zelfstandig uitvoerbaar bestand",
  updateInTerminal: "Bijwerken in Terminal",
  unknownInstall: "Kan niet bepalen hoe deze yt-dlp is geïnstalleerd. Voer de opdracht uit die past bij je installatie en klik daarna op ‘Opnieuw controleren’.",
  cannotRun: "BaoCut kan deze opdracht niet voor je uitvoeren.",
  thenRecheck: "Klik daarna op ‘Opnieuw controleren’.",
  runThenRecheck: "Voer deze opdracht uit in Terminal en klik daarna op ‘Opnieuw controleren’.",
  updateWith: (method: string) => `Bijwerken met ${method}`,
  stoppedTitle: "Bijwerken gestopt",
  stoppedBody: "De opdracht is mogelijk maar gedeeltelijk uitgevoerd. Controleer de uitvoer hieronder en klik daarna op ‘Opnieuw controleren’ om de huidige versie van yt-dlp te bevestigen.",
  failedTitle: (exitCode: string | null) => (exitCode === null ? "Bijwerken niet voltooid" : `Bijwerken niet voltooid (afsluitcode ${exitCode})`),
  failedBody: (error: string | null) =>
    `${error ? `${error.replace(/[。.]$/, "")}. ` : ""}Je bestaande yt-dlp blijft ongewijzigd. De uitvoer staat hieronder; je kunt ook de opdracht kopiëren, in Terminal uitvoeren en daarna op ‘Opnieuw controleren’ klikken.`,
  updatedTo: (version: string) => `Bijgewerkt naar ${version}`,
  upToDate: (version: string | null) => (version ? `Al bijgewerkt (${version})` : "Al bijgewerkt"),
  logTruncated: "… (eerdere uitvoer weggelaten; de volledige uitvoer staat in het taaklogboek)\\n",
  logStopped: "(Gestopt)",
  logExitCode: (exitCode: string) => `(Afsluitcode ${exitCode})`,
};
