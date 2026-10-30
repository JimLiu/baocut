import type { ForkMessages } from './fork-copy.ts';

export const nl: ForkMessages = {
  button: 'Afsplitsen vanaf deze beurt',
  fork: 'Verdergaan in een nieuwe sessie',
  forkHint: 'Neemt het gesprek tot deze beurt mee',
  restore: 'Verdergaan met video’s teruggezet naar toen…',
  restoreOne: (name) => `‘${name}’ gaat terug naar het einde van deze beurt`,
  restoreMany: (n) => `${n} video’s gaan terug naar het einde van deze beurt`,
  restoreNone: 'De versies van toen zijn weg of onleesbaar',
  checking: 'Versiegeschiedenis controleren…',
  dialogTitle: 'Afsplitsen en video’s herstellen',
  dialogLead:
    'De nieuwe sessie neemt het gesprek tot deze beurt mee. De video’s hieronder gaan terug naar het einde van deze beurt. Elk herstel wordt als nieuwe versie bewaard, dus je kunt terug via de versiegeschiedenis.',
  listLabel: 'Te herstellen video’s',
  cancel: 'Annuleren',
  confirm: 'Afsplitsen en herstellen',
  ok: (version, undone) =>
    `Versie ${version} herstellen. De ${undone} latere versies (jouw wijzigingen en die van andere sessies) worden ongedaan gemaakt`,
  pruned: 'De versie van toen is weg (de versiegeschiedenis bewaart alleen recente en bewaarde versies)',
  createdAfter: 'Deze video is na deze beurt gemaakt en blijft zoals hij is',
  chainBroken: 'De versiegeschiedenis is niet tot toen leesbaar',
  done: 'Afgesplitst naar een nieuwe sessie',
  doneRestored: (n) => `Afgesplitst naar een nieuwe sessie en ${n} video’s teruggezet naar toen. Je kunt terug via de versiegeschiedenis`,
  failed: (error) => `Afsplitsen mislukt: ${error}`,
  forkedFrom: (title, turn) => `Afgesplitst van ‘${title}’ · t/m beurt ${turn}`,
  sourceDeleted: '(oorspronkelijke sessie verwijderd)',
  history: (turns, omitted) => `Meegenomen geschiedenis · ${turns} beurten${omitted ? ` (${omitted} eerdere weggelaten)` : ''}`,
  hideHistory: 'Geschiedenis verbergen',
};
