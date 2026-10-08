import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const it: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: 'Il calcolo locale non richiede un’autorizzazione',
  dataKindRequired: 'Indica almeno un tipo di dati',
  budgetCapRequired: 'Un’autorizzazione con un limite di spesa richiede budgetCap',
  unknownCostNoCap: 'Un’autorizzazione con costo sconosciuto non può avere un limite di spesa. Per impostare un limite, usa estimate-cap',
  expiryPassed: 'La scadenza è già trascorsa',
  grantNotFound: 'Nessuna autorizzazione corrispondente',
  grantRevoked: 'L’autorizzazione è stata revocata e non può essere modificata. Emettine una nuova',
  cannotRemoveCap: 'Un’autorizzazione con un limite di spesa non può perdere il limite. Revocala ed emetti una nuova autorizzazione con costo sconosciuto',
  unknownCostCannotCap: 'Un’autorizzazione con costo sconosciuto non può impostare un limite di spesa. Revocala ed emetti una nuova autorizzazione estimate-cap',
  cannotChangeCurrency: 'La valuta non può essere modificata',
  expiryPassedRevoke: 'La scadenza è già trascorsa. Per interromperla ora, revocala',
  revokeNote: 'Dopo la revoca, non vengono effettuate nuove chiamate e quelle in coda vengono rifiutate all’avvio. I dati già inviati al provider e i costi già sostenuti non possono essere annullati localmente; le chiamate in corso terminano normalmente e vengono conteggiate nell’utilizzo.',
  taskCallLimit: 'Il limite di chiamate del budget dell’attività deve essere un intero positivo',
  providerGrantPurpose: (p) => `Emessa per impostazione predefinita quando è stato attivato ${p.label}`,
  invalidCurrency: (p) => `La valuta deve contenere tre lettere maiuscole (ISO 4217): ${p.currency}`,
};
