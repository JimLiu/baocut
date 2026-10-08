import type { AgentSkillsMessages } from './agent-skills.ts';
import { pluralForm } from '@baocut/protocol';

export const it: AgentSkillsMessages = {
  origin: { builtin: 'Integrata', personal: 'Mia', 'third-party': 'Di terze parti' }, all: 'Tutte', commit: (sha: string) => ` (${sha})`,
  bytes: (n: number) => `${n} byte`,
  action: { load: 'caricare le skill', toggle: 'cambiare l’interruttore', add: 'aggiungerla', import: 'importarla', remove: 'rimuoverla', read: 'aprire il file', send: 'inviare' },
  exists: (id: string | null) => `Esiste già una skill chiamata «${id ?? 'questa'}» e non verrà sovrascritta. Rimuovi prima quella vecchia o rinomina la cartella e aggiungila di nuovo.`,
  invalid: (issue: string) => `Questa skill non è utilizzabile: ${issue}. La cartella radice richiede un SKILL.md che inizi con name e description.`,
  tooLarge: (files: number, total: string, skillFile: string) => `Questa skill è troppo grande: una skill può avere al massimo ${files} file per un totale di ${total} e SKILL.md stesso può essere al massimo ${skillFile}.`,
  githubNotFound: 'Impossibile trovare questo repository, branch o cartella su GitHub (potrebbe essere privato). Controlla l’indirizzo.',
  folderNotFound: 'Impossibile trovare questa cartella. Potrebbe essere stata spostata o eliminata.',
  urlInvalid: 'L’indirizzo non è stato riconosciuto. Usa owner/repo o https://github.com/owner/repo/tree/branch/folder.',
  network: 'Impossibile raggiungere GitHub. Controlla la rete e riprova.',
  rateLimited: 'Per ora è stato raggiunto il limite di accesso anonimo di GitHub. Prova a importare di nuovo più tardi.',
  offline: 'La modalità rigorosamente offline è attiva, quindi non puoi importare da GitHub.',
  builtinNotRemovable: 'Le skill integrate non possono essere rimosse, ma puoi disattivarle.',
  notFound: 'Questa skill non esiste più; potrebbe essere stata appena rimossa.', fileNotFound: 'Questo file non esiste più.',
  fileTooLarge: 'Questo file è troppo grande per essere mostrato qui. Puoi aprirlo nella sua cartella.', fileNotText: 'Questo non è un file di testo, quindi non viene mostrato qui.',
  webNotAllowed: 'Non è possibile farlo nel browser. Usa invece l’app desktop BaoCut.', webReadOnly: 'Questa sessione del browser è di sola lettura, quindi non puoi modificare nulla.',
  failed: (action: string, raw: string) => `Impossibile ${action}: ${raw}`, sendFailed: (raw: string) => `Impossibile inviare: ${raw}`,
};
