import type { ForkMessages } from './fork-copy.ts';

export const pl: ForkMessages = {
  button: 'Odgałęź od tej tury',
  fork: 'Kontynuuj w nowej sesji',
  forkHint: 'Przenosi rozmowę do tej tury',
  restore: 'Kontynuuj z filmami przywróconymi do tamtej chwili…',
  restoreOne: (name) => `„${name}” wróci do końca tej tury`,
  restoreMany: (n) => `Filmy wrócą do końca tej tury: ${n}`,
  restoreNone: 'Wersji z tamtej chwili już nie ma lub nie da się ich odczytać',
  checking: 'Sprawdzanie historii wersji…',
  dialogTitle: 'Odgałęź i przywróć filmy',
  dialogLead:
    'Nowa sesja przenosi rozmowę do tej tury. Filmy poniżej wrócą do końca tej tury. Każde przywrócenie zapisuje się jako nowa wersja, więc możesz wrócić z historii wersji.',
  listLabel: 'Filmy do przywrócenia',
  cancel: 'Anuluj',
  confirm: 'Odgałęź i przywróć',
  ok: (version, undone) =>
    `Przywróć wersję ${version}. Późniejsze wersje (${undone}) — Twoje zmiany i zmiany innych sesji — zostaną cofnięte`,
  pruned: 'Wersji z tamtej chwili już nie ma (historia wersji zachowuje tylko ostatnie i zapisane wersje)',
  createdAfter: 'Ten film powstał po tej turze, więc zostaje bez zmian',
  chainBroken: 'Historii wersji nie da się odczytać do tamtej chwili',
  done: 'Utworzono odgałęzienie w nowej sesji',
  doneRestored: (n) => `Utworzono odgałęzienie w nowej sesji, przywrócono filmy: ${n}. Możesz wrócić z historii wersji`,
  failed: (error) => `Nie udało się odgałęzić: ${error}`,
  forkedFrom: (title, turn) => `Odgałęzienie z „${title}” · do tury ${turn}`,
  sourceDeleted: '(pierwotna sesja usunięta)',
  history: (turns, omitted) => `Przeniesiona historia · tury: ${turns}${omitted ? ` (pominięto wcześniejsze: ${omitted})` : ''}`,
  hideHistory: 'Ukryj historię',
};
