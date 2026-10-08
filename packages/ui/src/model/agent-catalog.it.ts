import type { AgentCatalogMessages } from './agent-catalog.ts';
import { pluralForm } from '@baocut/protocol';

export const it: AgentCatalogMessages = {
  idEmpty: "Inserisci un id, ad esempio my-agent",
  idPattern: "L’id deve iniziare con una lettera minuscola e usare solo lettere minuscole, cifre e trattini",
  idTooLong: "L’id può contenere al massimo 63 caratteri",
  idBuiltin: (id: string, who: string | null) => `«${id}» è l’id di un agente integrato in BaoCut${who ? ` (${who})` : ""}. Scegli un altro id`,
  idTaken: (id: string, who: string | null) => `Un agente usa già «${id}»${who ? ` (${who})` : ""}. Scegli un altro id`,
  nameEmpty: "Inserisci un nome da mostrare nell’elenco",
  nameTooLong: (max: number) => pluralForm('it', max, { one: `Il nome può contenere al massimo ${max} carattere`, other: `Il nome può contenere al massimo ${max} caratteri` }),
  commandEmpty: "Inserisci il comando che lo avvia, ad esempio my-agent --acp",
  commandShell: "Inserisci un solo comando: BaoCut lo avvia direttamente, senza shell, quindi pipe, reindirizzamenti e && non funzionano",
  tooManyArgs: (max: number) => `Troppi argomenti: fino a ${max}`,
  envLine: (line: number) => `Riga ${line} deve essere KEY=VALUE, con KEY che inizia con una lettera o un trattino basso`,
};
