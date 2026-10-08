import type { RcTemplatesMessages } from './rc-templates.ts';
import { pluralForm } from '../../i18n.ts';

export const it: RcTemplatesMessages = {
  builtinConflict: (p) => `Esiste già un template integrato con id «${p.id}», quindi questa copia non è stata caricata. Cambia l’id (nome della cartella) e aggiungilo di nuovo`,
  templateNotFound: (p) => `Template non trovato: ${p.id}`,
  fileNotRegistered: (p) => `Il template «${p.id}» non elenca questo file: ${p.file}`,
  dirIsSymlink: 'La cartella del template è un collegamento simbolico e non viene seguito. Aggiungi la cartella del template stessa',
  duplicateId: (p) => `Più di un template nella stessa cartella ha id «${p.id}»; nessuno è stato caricato`,
  templateInvalid: 'Il template non è valido e non è stato caricato',
  unsupportedSchema: 'Questa versione non riconosce schema del manifesto, quindi il template non è stato caricato',
  missingFile: (p) => `${p.file} manca`,
  fileOverBytes: (p) => `${p.file} supera ${p.limit} B`,
  fileOverBytesActual: (p) => `${p.file} supera ${p.limit} B (${p.size})`,
  fileNotUtf8: (p) => `${p.file} non è UTF-8 valido`, fileNotJson: (p) => `${p.file} non è JSON valido`, fileEmpty: (p) => `${p.file} è vuoto`,
  registeredFileMissing: (p) => `Un file elencato non esiste: ${p.file}`,
  pathOutsideTemplate: (p) => `Il percorso esce dalla cartella del template: ${p.file}`,
  unregisteredFile: (p) => `La cartella contiene un file non elencato: ${p.file}`,
  tooManyEntries: (p) => pluralForm('it', p.limit, { one: `La cartella ha più di ${p.limit} voce`, other: `La cartella ha più di ${p.limit} voci` }),
  noSymlinks: (p) => `I collegamenti simbolici non sono consentiti: ${p.path}`,
  notRegularFile: (p) => `Non è un file normale: ${p.path}`,
  cannotReadDir: (p) => `Impossibile leggere la cartella del template (${p.code})`,
  notScene: (p) => `«${p.title}» è un esempio dimostrativo: inserisci il prompt nella casella del messaggio e invialo, senza allegare un template`,
  assetNotRegistered: (p) => `Il template «${p.id}» non elenca questo materiale: ${p.asset}`,
};
