import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

export const nl: LegacyImportRunMessages = {
  offlineTitle: (name) => `Schijf ‘${name}’ is niet aangesloten`,
  offlineWhy: (n, root) =>
    pluralForm('nl', n, {
      one: `De video’s die dit project gebruikt staan op deze schijf (${root}), die nu niet gelezen kan worden.`,
      other: `De video’s die deze ${n} projecten gebruiken staan op deze schijf (${root}), die nu niet gelezen kan worden.`,
    }),
  offlineFix:
    'Sluit de schijf aan en klik dan op ‘Opnieuw proberen’. Als je niets doet, probeert BaoCut het opnieuw bij de volgende start. Heb je de media niet meer nodig, klik dan op ‘Overslaan’; dan wordt er niets geïmporteerd.',
  offlineShort: (n, name) =>
    pluralForm('nl', n, {
      one: `${n} project heeft zijn media op ‘${name}’, die niet is aangesloten`,
      other: `${n} projecten hebben hun media op ‘${name}’, die niet is aangesloten`,
    }),
  missingTitle: 'Mediabestanden staan niet meer op hun plek',
  missingWhy:
    'Bestanden die het project gebruikt zijn verplaatst, hernoemd of verwijderd, waardoor de paden in het eerdere project ze niet meer vinden.',
  missingFix: 'Zet de bestanden terug op hun oude plek en klik dan op ‘Opnieuw proberen’. Lukt dat niet, klik dan op ‘Overslaan’.',
  missingShort: (n) =>
    pluralForm('nl', n, {
      one: `${n} project heeft mediabestanden die niet te vinden zijn`,
      other: `${n} projecten hebben mediabestanden die niet te vinden zijn`,
    }),
  unreadableTitle: 'Het eerdere projectbestand kan niet worden gelezen',
  unreadableWhy: 'Het eerdere projectbestand is mogelijk beschadigd, dus opnieuw proberen helpt waarschijnlijk niet.',
  unreadableFix:
    'Geef het weer in de map om te controleren of het origineel er nog is en in de eerdere versie opent. Heb je het niet nodig, klik dan op ‘Overslaan’.',
  unreadableShort: (n) =>
    pluralForm('nl', n, {
      one: `${n} projectbestand kan niet worden gelezen`,
      other: `${n} projectbestanden kunnen niet worden gelezen`,
    }),
  failedTitle: 'Importeren halverwege gestopt',
  failedWhy: 'Het project is gelezen, maar het importeren is halverwege gestopt. In het importrapport staat wat er gebeurde.',
  failedFix:
    'Klik op ‘Opnieuw proberen’ om het nog eens te proberen. Lukt het nog steeds niet, geef dan het rapport weer in de map. Heb je het project niet nodig, klik dan op ‘Overslaan’.',
  failedShort: (n) =>
    pluralForm('nl', n, {
      one: `${n} project is halverwege het importeren gestopt`,
      other: `${n} projecten zijn halverwege het importeren gestopt`,
    }),
  missingMany: (n, first) => `${n} bestanden ontbreken, bijvoorbeeld ${first}`,
  missingOne: (file) => `${file} ontbreekt`,
  missingNone: 'Mediabestanden niet gevonden',
  failedReport: (report) => `Importrapport: ${report}`,
  failedNoReport: 'Er is geen importrapport geschreven',
  note: (parts) => `${parts.join('; ')}.`,
  hintOffline: (name) =>
    `Sluit ‘${name}’ aan en klik dan op ‘Alles opnieuw proberen’. Als je niets doet, probeert BaoCut het opnieuw bij de volgende start. Open de details om ze één voor één af te handelen.`,
  hintOther: 'De oorzaak en wat je kunt doen staan per project in de details. Projecten die je niet nodig hebt, kun je overslaan.',
  subProgress: (done, total) => `Geïmporteerd ${done}/${total}`,
  subImported: (n) => `Geïmporteerd ${n}`,
  subPending: (n) => `Af te handelen ${n}`,
  subSkipped: (n) => `Overgeslagen ${n}`,
  subDest: (dest) => `Naar ${dest}`,
  attention: (n) => `${n} af te handelen`,
  phaseImporting: 'Importeren',
  phaseWaiting: 'Wacht op andere taken',
  detailImporting: (title) => `‘${title}’ wordt geïmporteerd`,
  detailWaiting: 'Er lopen andere taken, dus het importeren is gepauzeerd. Het gaat automatisch verder zodra ze klaar zijn.',
  bannerRunning: (done, total) => `Eerdere projecten importeren · ${done}/${total}`,
  bannerResult: (imported, pending) =>
    `Importeren van eerdere projecten klaar: ${imported} geïmporteerd, ${pending} niet geïmporteerd`,
  doneAll: (n) => pluralForm('nl', n, { one: `${n} eerder project geïmporteerd`, other: `${n} eerdere projecten geïmporteerd` }),
  doneSome: (imported, pending) => `Importeren klaar: ${imported} geïmporteerd, ${pending} niet geïmporteerd`,
  retriedAll: (n) =>
    pluralForm('nl', n, {
      one: 'Het opnieuw geprobeerde project is geïmporteerd',
      other: `Alle ${n} opnieuw geprobeerde projecten zijn geïmporteerd`,
    }),
  retriedSome: (n, ok) => `Van de ${n} opnieuw geprobeerde: ${ok} geïmporteerd, ${n - ok} nog steeds niet geïmporteerd`,
  retriedNone: (n) =>
    pluralForm('nl', n, {
      one: 'Het opnieuw geprobeerde project is nog steeds niet geïmporteerd',
      other: `De ${n} opnieuw geprobeerde projecten zijn nog steeds niet geïmporteerd`,
    }),
  retrying: (n) =>
    pluralForm('nl', n, { one: `${n} project wordt opnieuw geïmporteerd`, other: `${n} projecten worden opnieuw geïmporteerd` }),
  skipped: (n) =>
    pluralForm('nl', n, {
      one: `${n} project overgeslagen. Het wordt niet automatisch geïmporteerd.`,
      other: `${n} projecten overgeslagen. Ze worden niet automatisch geïmporteerd.`,
    }),
  actionFailed: (message) => `Dat is niet gelukt: ${message}`,
  undo: 'Ongedaan maken',
  viewReasons: 'Oorzaak bekijken',
  viewInSpace: 'In Space bekijken',
  viewProgress: 'Voortgang bekijken',
  close: 'Sluiten',
  retryAll: 'Alles opnieuw proberen',
  skipAll: 'Alles overslaan',
  retry: 'Opnieuw proberen',
  skip: 'Overslaan',
  reveal: 'Weergeven in map',
  importInstead: 'Importeren',
  statImported: 'Geïmporteerd',
  statPending: 'Niet geïmporteerd',
  statSkipped: 'Overgeslagen',
  statLive: 'Nog niet geïmporteerd',
  pendingSection: 'Niet geïmporteerde projecten',
  pendingHint: 'Als je niets doet, probeert BaoCut het opnieuw bij de volgende start. Overgeslagen projecten worden niet geïmporteerd.',
  howTo: 'Wat te doen: ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'Bezig met importeren',
  importingChip: 'Importeren',
  queuedChip: 'In wachtrij',
  importedSection: 'Geïmporteerd',
  skippedSection: 'Overgeslagen',
  skippedHint: 'Ze worden niet automatisch geïmporteerd. De originele bestanden blijven op hun plek.',
  expand: (n) => `Nog ${n} tonen`,
  collapse: 'Minder tonen',
};
