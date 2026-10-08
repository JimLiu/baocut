import type { ProvidersAgentMessages } from './providers-agent.ts';

export const de: ProvidersAgentMessages = {
  codexUpgradeHint: "Codex CLI aktualisieren (zum Beispiel npm install -g @openai/codex@latest), dann erneut prüfen",
  codexImageModel: "Codex-Bilderzeugung (Modell von Codex und Ihrem Konto ausgewählt)",
  codexImageNotes:
    "Erzeugt mit dem auf diesem Computer angemeldeten Codex-Konto: ein PNG pro Aufruf, eine Aufgabe gleichzeitig, meist in ein bis zwei Minuten. Größe und Seed sind nicht einstellbar (entsprechende Anfragen werden abgelehnt); die Pixelgröße hängt vom Ergebnis ab. Verwendet Ihr Abonnementkontingent; das verbleibende Kontingent ist unbekannt. Aktivieren bedeutet Zustimmung zum Senden von Prompts an Ihr Codex-Konto.",
  imagesOnly: (p: { label: string }) => `${p.label} kann nur Bilder erzeugen`,
  onePngOnly: (p: { label: string }) => `${p.label} erzeugt jeweils ein PNG und unterstützt weder size noch seed`,
  unavailable: (p: { label: string; message: string }) => `${p.label} ist nicht verfügbar: ${p.message}`,
  sessionNotStarted: (p: { label: string; error: string }) => `${p.label}: Sitzung konnte nicht gestartet werden: ${p.error}`,
  timedOut: (p: { label: string; minutes: number }) => `${p.label} wurde nicht abgeschlossen innerhalb von ${p.minutes} Minuten und wurde unterbrochen`,
  exited: (p: { label: string; message: string }) => `${p.label} wurde unerwartet beendet: ${p.message}`,
  notCompleted: (p: { label: string; reason: string }) => `${p.label} hat diese Erzeugung nicht abgeschlossen: ${p.reason}`,
  turnInterrupted: "die Runde wurde unterbrochen",
  noImage: (p: { label: string }) => `${p.label} hat kein Bild erzeugt`,
  noImageReply: (p: { label: string; reply: string }) => `${p.label} hat kein Bild erzeugt: ${p.reply}`,
  unknownError: "Unbekannter Fehler",
  processExited: "Der Prozess wurde beendet",
  turnNotStarted: (p: { error: string }) => `Die Runde wurde nicht gestartet: ${p.error}`,
};
