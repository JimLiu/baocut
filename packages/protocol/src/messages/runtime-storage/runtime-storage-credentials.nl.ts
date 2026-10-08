import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const nl: RuntimeStorageCredentialsMessages = {
  denied: "Toegang geweigerd",
  unavailable: "De opslag voor inloggegevens is niet beschikbaar",
  unsupported: "Dit platform ondersteunt de beveiligde systeemopslag niet",
  internal: "Fout bij het lezen of schrijven van inloggegevens",
  problem: (p: { reason: string; message: string }) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p: { code: string }) => `Kan het bestand met inloggegevens niet schrijven (${p.code})`,
  helperBadResponse: "Het hulpprogramma voor inloggegevens heeft een ongeldig antwoord geretourneerd",
  helperNotFound: "Het hulpprogramma voor inloggegevens is niet gevonden",
  helperTimedOut: (p: { seconds: number }) => `Het hulpprogramma voor inloggegevens heeft niet geantwoord binnen ${p.seconds} seconden`,
  helperMissing: "Het hulpprogramma voor inloggegevens ontbreekt",
  helperStartFailed: (p: { code: string }) => `Het hulpprogramma voor inloggegevens kan niet starten (${p.code})`,
  helperResponseTooLong: "Het antwoord van het hulpprogramma voor inloggegevens is te lang",
  helperExitedSilently: "Het hulpprogramma voor inloggegevens is afgesloten zonder antwoord",
  helperReportedError: "Het hulpprogramma voor inloggegevens heeft een fout gemeld",
  redacted: "[weggelaten]",
};
