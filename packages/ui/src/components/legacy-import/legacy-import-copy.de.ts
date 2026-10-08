import { pluralForm } from '@baocut/protocol';
import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const de: LegacyImportMessages = {
  title: 'Projekte aus einer früheren Version importieren?',
  lead: (n) =>
    pluralForm('de', n, {
      one: `Auf diesem Computer gibt es ${n} Projekt aus einer früheren Version von BaoCut. Importieren Sie es, um es in dieser Version weiter zu bearbeiten. Die Originaldateien bleiben unverändert an ihrem Ort.`,
      other: `Auf diesem Computer gibt es ${n} Projekte aus einer früheren Version von BaoCut. Importieren Sie sie, um sie in dieser Version weiter zu bearbeiten. Die Originaldateien bleiben unverändert an ihrem Ort.`,
    }),
  found: 'Gefundene Projekte',
  destination: 'Importieren nach',
  resetDefault: 'Standardort verwenden',
  change: 'Ändern…',
  pickTitle: 'Importziel auswählen',
  destinationNote: 'Dieser Ordner erscheint als Projekt in Home, jedes frühere Projekt wird darin zu einem Video.',
  hint: 'Wenn Sie überspringen, werden Sie beim nächsten Start von BaoCut erneut gefragt. Aktivieren Sie „Nicht mehr erinnern“, um sie nie zu importieren.',
  never: 'Nicht mehr erinnern',
  skip: 'Überspringen',
  import: 'Importieren',
  importing: (n) =>
    pluralForm('de', n, {
      one: `${n} früheres Projekt wird im Hintergrund importiert`,
      other: `${n} frühere Projekte werden im Hintergrund importiert`,
    }),
  neverDone: 'Sie werden nicht mehr an den Import früherer Projekte erinnert. Die Originaldateien bleiben unverändert.',
  skipped: 'Übersprungen. Sie werden beim nächsten Start von BaoCut erneut gefragt.',
  failed: (message) => `Import fehlgeschlagen: ${message}`,
};
