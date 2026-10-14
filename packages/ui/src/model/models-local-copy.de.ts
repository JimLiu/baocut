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
    music: 'Musik',
    diarize: "Sprechertrennung",
    embed: "Semantischer Index",
  } as Record<ModelBundleStatus['capability'], string>,

  auto: "Automatisch",

  notInstalled: (name: string) => `${name} (nicht installiert)`,

  componentName: { 'litertlm-runtime': "LiteRT-LM-Laufzeit", 'audiocpp-engine': "audio.cpp-Engine", aligner: "Erzwungener Ausrichter", speaker: "Sprecher-Embedding", vad: "VAD (Sprachaktivitätserkennung)", tokenizer: "Tokenizer", segmentation: "Sprechersegmentierung", codec: "Sprach-Codec", aux: "Hilfsmodelle" } as Record<string, string>,
  componentDesc: { 'litertlm-runtime': "Führt die Modelle des semantischen Index aus · für Ihre Plattform heruntergeladen", 'audiocpp-engine': "Führt YuE2 aus · je nach Plattform heruntergeladen · Windows / Linux brauchen einen Vulkan-Grafiktreiber", vad: "Findet die Abschnitte, in denen jemand spricht", aligner: "Richtet den Text auf das Timing jedes Worts aus", tokenizer: "Wandelt zwischen Text und den Tokens des Modells um", speaker: "Unterscheidet die Sprecher", segmentation: "Findet, wo jede Person zu sprechen beginnt und aufhört", codec: "Wandelt akustische Tokens zurück in eine Wellenform", aux: "Zusätzliche Modelle, die das Hauptmodell braucht" },
  githubRelease: (repo, tag) => `GitHub-Release ${repo} ${tag}`,
  weights: "Modellgewichte",
};
