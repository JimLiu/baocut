import type { ServicesApiMessages } from './services-api-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ServicesApiMessages = {
  capabilities: { transcribe: 'Trascrivi', synthesizeSpeech: 'Sintetizza voce', generateImage: 'Genera immagini', generateText: 'Genera testo' },
  endpoints: { models: 'Elenca modelli', model: 'Ottieni un modello', info: 'Informazioni sul servizio e versione dell’interfaccia', transcriptions: 'Trascrivi audio', speech: 'Sintetizza voce', images: 'Genera immagini', chat: 'Genera testo (chat)' },
  routing: {
    online: { label: 'Servizi online', desc: 'Inoltra richieste ai servizi cloud connessi (potrebbero esserci costi; i dati escono da questo computer)' },
    nodes: { label: 'Nodi LAN', desc: 'Inoltra richieste ad altri computer abbinati' },
    agent: { label: 'Agenti', desc: 'Inoltra richieste ai runtime degli agenti connessi su questo computer (come Codex)' },
  },
  modelsAvailable: (n) => pluralForm('it', n, { one: `${n} modello disponibile`, other: `${n} modelli disponibili` }),
  notRouted: 'Sono disponibili modelli, ma l’instradamento è disattivato per la loro categoria; per ora le richieste ricevono 503',
  noModels: 'Nessun modello ancora disponibile; per ora le richieste ricevono 503',
  defaultModel: 'Modello predefinito', target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: 'Impossibile trovare questo provider; le richieste ricevono 404',
  aliasNotRouted: 'L’instradamento è disattivato per questa categoria; le richieste ricevono 404',
  aliasProviderUnavailable: 'Questo provider non è disponibile al momento', aliasModelUnavailable: 'Questo modello non è disponibile al momento',
  targetNotRouted: 'Instradamento disattivato', targetUnavailable: 'Non disponibile al momento',
  aliasNameEmpty: 'Inserisci un nome, come whisper-1',
  aliasNameSlash: 'I nomi non possono contenere «/»: <provider>/<model> è la forma canonica e gli alias non possono coincidere con essa',
  aliasNameChars: 'Usa solo lettere, cifre e . _ : -, iniziando con una lettera o cifra',
  aliasNameTaken: (name) => `«${name}» esiste già; per cambiarne la destinazione, elimina prima quella riga`,
};
