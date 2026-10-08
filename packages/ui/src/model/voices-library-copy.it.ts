import type { VoicesLibraryMessages } from './voices-library-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: VoicesLibraryMessages = {
  consentStatement: 'Questa è la mia voce o ho il permesso del parlante',
  uploading: (label) => `Caricamento su ${label}…`,
  noConsent: 'Non è stata indicata come la tua voce o come usata con permesso, quindi non verrà caricata su terze parti. Seleziona prima la dichiarazione in «Modifica».',
  cannotClone: (label) => `Questo Runtime non può clonare su ${label}`,
  providerOff: (label, detail) => `${label} non è disponibile ora${detail ? ` (${detail})` : ''}: prima attiva il provider e imposta la chiave in «Modelli cloud»`,
  consentUnstated: 'Consenso non dichiarato', cloned: (label) => `Clonata su ${label}`, cloneStale: (label) => `Clone di ${label} non aggiornato`,
  languageUnknown: 'Lingua non specificata', recorded: 'Registrata nell’app', imported: 'Importata da un file', edited: (ago) => `Modificata ${ago}`,
  nameRequired: 'Dai un nome alla voce', nameTooLong: (max) => pluralForm('it', max, { one: `I nomi possono contenere fino a ${max} carattere`, other: `I nomi possono contenere fino a ${max} caratteri` }), transcriptTooLong: (max) => pluralForm('it', max, { one: `Le trascrizioni possono contenere fino a ${max} carattere`, other: `Le trascrizioni possono contenere fino a ${max} caratteri` }), dontKnow: 'Non sono sicuro',
  deleteClones: (labels) => `I cloni su ${labels.join(', ')} vengono eliminati prima; se non riesce, la voce viene conservata.`,
  deleteBody: (clones) => `I video che la usano torneranno alla voce predefinita alla prossima generazione; i doppiaggi già generati non cambiano. ${clones}`.trim(),
  uploadNotice: (name, size, label) => `La registrazione di riferimento di «${name}»${size ? ` (${size})` : ''} verrà caricata su ${label} per creare un clone. Poi usare questa voce su ${label} utilizzerà direttamente il loro ID voce; eliminando la voce viene prima eliminato questo clone.`,
  withRemedy: (message, remedy) => `${message.replace(/[。.]$/, '')}. ${remedy}`,
  remedyConsent: 'Le voci senza dichiarazione di consenso non vengono caricate su terze parti: seleziona prima la dichiarazione in «Modifica».',
  remedyConfigure: 'Attiva questo provider e imposta la sua chiave in «Modelli cloud».',
  remedyConflict: 'Questa voce è appena stata modificata altrove. La versione più recente è mostrata sotto; controllala prima di salvare.',
  remedyGrant: 'Inviare la registrazione di riferimento a un provider richiede un’autorizzazione all’invio dei dati: concedine una nelle Impostazioni, poi riprova.',
};
