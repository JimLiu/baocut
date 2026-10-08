import type { ModelBundleReason } from "@baocut/protocol";
import type { ModelBundleStatus } from "@baocut/protocol";
import type { ModelsLocalMessages } from './models-local-copy.ts';

export const de: ModelsLocalMessages = {

  reason: {
    unsupported: "Auf diesem Computer nicht unterstützt",
    resource: "Deaktiviert",
    'worker-missing': "Model Worker fehlt",
    'missing-manifest': "Manifest fehlt",
    'missing-file': "Dateien fehlen",
    'size-mismatch': "Dateigröße stimmt nicht überein",
    'hash-mismatch': "Prüfsumme stimmt nicht überein",
    incomplete: "Komponenten fehlen",
    'load-failed': "Laden fehlgeschlagen",
    relocating: "Wird verschoben",
  } as Record<ModelBundleReason, string>,
  chipDefault: "Standard",
  chipLoading: "Wird geladen",
  chipReady: "Geladen",
  chipBusy: "Läuft",
  chipUnloading: "Wird entladen",
  chipUnavailable: "Nicht verfügbar",
  chipMissing: (names) => `Fehlt: ${names.join(', ')}`,

  capability: {
    transcribe: "Transkribieren",
    align: "Ausrichten",
    synthesize: "Synthetisieren",
    image: "Bild",
    separate: "Trennung",
    diarize: "Sprechertrennung",
  } as Record<ModelBundleStatus['capability'], string>,

  auto: "Automatisch",

  notInstalled: (name: string) => `${name} (nicht installiert)`,

  componentName: { aligner: "Erzwungener Ausrichter", speaker: "Sprecher-Embedding", vad: "VAD (Sprachaktivitätserkennung)", tokenizer: "Tokenizer", segmentation: "Sprechersegmentierung", codec: "Sprach-Codec", aux: "Hilfsmodelle" } as Record<string, string>,
  componentDesc: { vad: "Findet die Abschnitte, in denen jemand spricht", aligner: "Richtet den Text auf das Timing jedes Worts aus", tokenizer: "Wandelt zwischen Text und den Tokens des Modells um", speaker: "Unterscheidet die Sprecher", segmentation: "Findet, wo jede Person zu sprechen beginnt und aufhört", codec: "Wandelt akustische Tokens zurück in eine Wellenform", aux: "Zusätzliche Modelle, die das Hauptmodell braucht" },
  weights: "Modellgewichte",
};
