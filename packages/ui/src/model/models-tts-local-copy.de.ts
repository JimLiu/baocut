const voices = (n: number) => pluralForm('de', n, { one: `${n} integrierte Stimme`, other: `${n} integrierte Stimmen` });
function languageName(code: string): string { try { return new Intl.DisplayNames(['de'], { type: 'language' }).of(code) ?? code; } catch { return code; } }
import { pluralForm } from '@baocut/protocol';
import type { TtsLocalMessages } from './models-tts-local-copy.ts';

export const de: TtsLocalMessages = {

  languageShort: languageName,
  languagesAny: "Beliebige Sprache",

  languagesMore: (shown: readonly string[], total: number) => `${shown.join(" / ")} und weitere (${total} Sprachen)`,

  summaryCloneDescribe: (builtins: number, byDuration: boolean) =>
    `${voices(builtins)}, eine Aufnahme klonen oder durch Auswahl von Geschlecht, Alter und Tonhöhe eine neue Stimme erstellen${
      byDuration ? "; kann auf eine Zieldauer vorlesen" : ""
    }`,

  summaryClone: (builtins: number, style: boolean) =>
    `${voices(builtins)} oder eine Stimme aus einer Aufnahme klonen${style ? "; Stil über einen einzeiligen Prompt einstellbar" : ""}`,

  summaryDescribe: (builtins: number) =>
    builtins
      ? `Stimme in einem Satz beschreiben, damit das Modell sie erstellt; auch direkt verwendbar: ${voices(builtins)}`
      : "Stimme in einem Satz beschreiben, damit das Modell sie erstellt",

  summaryPreset: (speakers: number, style: boolean) =>
    `${speakers} voreingestellte ${pluralForm('de', speakers, { one: "Stimme", other: "Stimmen" })}; auswählen und vorlesen lassen${style ? "; Ton über einen einzeiligen Prompt einstellbar" : ""}`,
  modeCloneDescribe: "Integrierte Stimmen / Klonen / Beschreiben",
  modeClone: "Integrierte Stimmen / Klonen",
  modeDescribe: "Stimme aus Beschreibung",
  modePreset: "Stimmvorlagen",
  factStyle: "Stilanweisung",
  factSlow: "Langsamer",

  nonCommercialChip: "Nur nichtkommerziell",
  licenseCommercial: (name: string) => `${name} · Kommerzielle Nutzung erlaubt`,
  licenseNonCommercial: (name: string, owner: string) =>
    `${name} · Nur nichtkommerziell · für kommerzielle Nutzung separat beantragen bei ${owner}`,

  familyDesc: {
    'qwen3-tts':
      "Qwen3-TTS: CustomVoice hat 9 voreingestellte Sprecher; Ton über einzeiligen Prompt einstellbar. Base klont Referenzaufnahmen; 1.7B VoiceDesign erzeugt Stimmen nur aus Beschreibungen. 1.7B klingt besser, ist aber langsamer.",
    indextts2:
      "IndexTTS: acht integrierte Stimmen oder eigene Aufnahme klonen. Übernimmt nur Stimmfarbe, liest das Transkript nicht. IndexTTS 2.5 erlaubt auch Sprechgeschwindigkeitseinstellung.",
    'gpt-sovits':
      "GPT-SoVITS: acht integrierte Stimmen oder eigene Aufnahme klonen. Ähnlichkeit steigt mit Referenztranskript; dann muss die Referenz 3–10 Sekunden lang sein.",
    voxcpm2:
      "VoxCPM2: acht integrierte Stimmen oder eigene Aufnahme klonen. Beste Ähnlichkeit mit Aufnahmetranskript; Stil über einzeiligen Prompt einstellbar. Ausgabe 48 kHz.",
    omnivoice:
      "OmniVoice: acht integrierte Stimmen, eigene Aufnahme klonen oder neue Stimme über Geschlecht, Alter und Tonhöhe aus einer Wortliste erstellen. Unterstützt die meisten Sprachen. Nur nichtkommerziell.",
  } as Record<string, string>,
  quickDescribe: "Stimme ausschließlich durch Beschreibung bestimmt; geänderte Beschreibung ergibt eine andere Person",
  quickVoxcpm: "Etwa Echtzeit: Erzeugung dauert so lange wie Vorlesen; erstes Laden etwa 5 Sekunden",
  quickNonCommercial: (license: string) => `Nur nichtkommerziell (${license}); für kommerzielle Inhalte anderes Modell wählen`,
  quickSlow: "Großes Modell: langsamere Synthese als ähnliche Modelle; erstes Laden dauert länger",
};
