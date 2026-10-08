import type { SpaceEntryKind } from '@baocut/protocol';
import type { ToolOutputsMessages } from './tool-outputs.ts';

export const de: ToolOutputsMessages = {
  actionLabel: { 'open-movie': "Im Editor öffnen", 'new-movie': "Neues Video daraus erstellen" },
  blockTextOnly: "Transkripte und Untertitel benötigen eine Video- oder Audiodatei, um ein neues Video zu erstellen; das ist von hier aus noch nicht möglich",
  blockTrashed: "Diesen Eintrag zuerst aus dem Papierkorb wiederherstellen",
  blockGenerating: "Wird noch erzeugt; nach Abschluss verfügbar",
  blockMissing: "Die Datei dieses Ergebnisses wurde auf diesem Computer nicht gefunden",

  handover: {
    subtitle: "Diese Untertitel in eine andere Sprache übersetzen und die Zeitcodes beibehalten.",
    document: "Eine Zusammenfassung dieses Transkripts schreiben.",
    audio: "Ein Video mit diesem Audio erstellen.",
    image: "Ein Video mit diesem Bild als Titelbild erstellen.",
    'video-file': "Diesem Video Untertitel hinzufügen.",
    export: "Diesem Video Untertitel hinzufügen.",
    video: "Dieses Video weiter bearbeiten.",
  } as Partial<Record<SpaceEntryKind, string>>,
  handoverDefault: "Dieses Ergebnis weiter bearbeiten.",
};
