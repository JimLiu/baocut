import type { DubFitStatus } from '@baocut/protocol';
type DubUnitKey = DubFitStatus | 'stale' | 'offTimeline' | 'voiceUnavailable';
import type { DubProgressMessages } from './dub-progress.ts';

export const de: DubProgressMessages = {
  unit: {
    fit: "Unverändert platziert",
    tempo: "Nach Beschleunigung platziert",
    extended: "Bis zum Limit beschleunigt; folgende Stille verwendet",
    overlong: "Zu lang; nicht platziert",
    stale: "Übersetzung veraltet; nicht synthetisiert",
    offTimeline: "Originalzeile nicht mehr in der Zeitleiste; nicht platziert",
    voiceUnavailable: "Sprecherstimme nicht verfügbar; nicht synthetisiert",
  } as Record<DubUnitKey, string>,
  reasonStale: "Klon abgelaufen; in der Stimmbibliothek erneut klonen",
  reasonMissing: "Bei diesem Anbieter noch nicht geklont",
  reasonNoConsent: "Keine Einwilligungserklärung des Sprechers; wird nicht an den Anbieter hochgeladen",
  reasonRemoved: "Diese Stimme ist nicht mehr in der Bibliothek",
  reasonServiceClient: "Externe Dienstaufrufer können keine Bibliotheksstimmen verwenden",
  codeCloneRequired: "Kein gültiger Klon bei diesem Anbieter",
  codeNotFound: "Stimme nicht gefunden",
  warning: {
    DUB_SEPARATION_NOT_CONFIGURED: "Hintergrund nicht getrennt",
    DUB_UNITS_STALE: "Veraltete Übersetzungen nicht synthetisiert",
    DUB_UNITS_OVERLONG: "Einige Zeilen sind zu lang",
    DUB_UNITS_OFF_TIMELINE: "Einige Originalzeilen sind nicht mehr in der Zeitleiste",
    DUB_MUTED_UNVOICED: "Originalton auch für nicht synthetisierte Zeilen stummgeschaltet",
    DUB_BACKGROUND_MUTED: "Auch Hintergrundaudio stummgeschaltet",
    DUB_VOICE_UNAVAILABLE: "Einige Sprecherstimmen sind nicht verfügbar",
  } as Record<string, string>,
  separated: "Hintergrund getrennt",
  separationNotConfigured: "Trennung angefordert, aber keine Trennfunktion eingerichtet; übersprungen, Originalton unverändert",
  notSeparated: "Hintergrund nicht getrennt",
  originalMuted: "Originalton stummgeschaltet",
  originalKept: "Originalton unverändert",
  originalDucked: (db: number | null) => (db ? `Originalton abgesenkt um ${db} dB während der Vertonung` : "Originalton während der Vertonung abgesenkt"),
};
