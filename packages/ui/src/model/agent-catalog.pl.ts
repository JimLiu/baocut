import { pluralForm } from '@baocut/protocol';
import type { AgentCatalogMessages } from './agent-catalog.ts';

export const pl: AgentCatalogMessages = {
  idEmpty: "Wpisz id, na przykład my-agent",
  idPattern: "id musi zaczynać się małą literą i zawierać tylko małe litery, cyfry i łączniki",
  idTooLong: "id może mieć najwyżej 63 znaki",
  idBuiltin: (id: string, who: string | null) => `„${id}” to id wbudowanego agenta BaoCut${who ? ` (${who})` : ""}. Wybierz inne id`,
  idTaken: (id: string, who: string | null) => `Agent${who ? ` (${who})` : ""} już używa id „${id}”. Wybierz inne id`,
  nameEmpty: "Wpisz nazwę do wyświetlenia na liście",
  nameTooLong: (max: number) => pluralForm('pl', max, { one: `Nazwa może mieć najwyżej ${max} znak`, few: `Nazwa może mieć najwyżej ${max} znaki`, many: `Nazwa może mieć najwyżej ${max} znaków`, other: `Nazwa może mieć najwyżej ${max} znaku` }),
  commandEmpty: "Wpisz polecenie uruchamiające, na przykład my-agent --acp",
  commandShell: "Wpisz jedno polecenie: BaoCut uruchamia je bezpośrednio, bez powłoki, więc potoki, przekierowania i && nie działają",
  tooManyArgs: (max: number) => `Zbyt wiele argumentów: najwyżej ${max}`,
  envLine: (line: number) => `Wiersz ${line} musi mieć postać KEY=VALUE, gdzie KEY zaczyna się literą lub podkreśleniem`,
};
