import type { ForkMessages } from './fork-copy.ts';

export const de: ForkMessages = {
  button: 'Ab dieser Runde abzweigen',
  fork: 'In einer neuen Sitzung weitermachen',
  forkHint: 'Übernimmt das Gespräch bis zu dieser Runde',
  restore: 'Weitermachen und Videos auf damals zurücksetzen…',
  restoreOne: (name) => `„${name}“ geht auf das Ende dieser Runde zurück`,
  restoreMany: (n) => `${n} Videos gehen auf das Ende dieser Runde zurück`,
  restoreNone: 'Die Versionen von damals sind weg oder nicht lesbar',
  checking: 'Versionsverlauf wird geprüft …',
  dialogTitle: 'Abzweigen und Videos wiederherstellen',
  dialogLead:
    'Die neue Sitzung übernimmt das Gespräch bis zu dieser Runde. Die Videos unten gehen auf das Ende dieser Runde zurück. Jede Wiederherstellung wird als neue Version gespeichert; im Versionsverlauf kannst du zurückkehren.',
  listLabel: 'Wiederherzustellende Videos',
  cancel: 'Abbrechen',
  confirm: 'Abzweigen und wiederherstellen',
  ok: (version, undone) =>
    `Version ${version} wiederherstellen. Die ${undone} späteren Versionen (deine Änderungen und die anderer Sitzungen) werden rückgängig gemacht`,
  pruned: 'Die Version von damals ist weg (der Versionsverlauf behält nur aktuelle und gespeicherte Versionen)',
  createdAfter: 'Dieses Video entstand nach dieser Runde und bleibt, wie es ist',
  chainBroken: 'Der Versionsverlauf lässt sich nicht bis damals lesen',
  done: 'In eine neue Sitzung abgezweigt',
  doneRestored: (n) =>
    `In eine neue Sitzung abgezweigt und ${n} Videos auf damals zurückgesetzt. Im Versionsverlauf kannst du zurückkehren`,
  failed: (error) => `Abzweigen fehlgeschlagen: ${error}`,
  forkedFrom: (title, turn) => `Abgezweigt von „${title}“ · bis Runde ${turn}`,
  sourceDeleted: '(ursprüngliche Sitzung gelöscht)',
  history: (turns, omitted) => `Übernommener Verlauf · ${turns} Runden${omitted ? ` (${omitted} ältere ausgelassen)` : ''}`,
  hideHistory: 'Verlauf ausblenden',
};
