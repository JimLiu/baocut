import type { GeneralSettingsMessages } from './general-settings-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: GeneralSettingsMessages = {
  interfaceGroup: 'Interfaccia', language: 'Lingua', languageDesc: 'Ha effetto subito, senza riavvio.', languageSystem: (current: string) => `Sistema (${current})`,
  appearance: 'Aspetto', appearanceDesc: 'Riguarda solo le finestre di BaoCut su questo computer.', schemeSystem: 'Sistema', schemeLight: 'Chiaro', schemeDark: 'Scuro', saveFailed: (message: string) => `Impossibile salvare: ${message}`,
  editingGroup: 'Modifica e trascrizione', autoOpen: 'Apri automaticamente il video dopo la trascrizione', autoOpenDesc: 'Per le importazioni locali. Quando un’importazione da link termina in background, ricevi solo una notifica e la pagina attuale rimane invariata.',
  autoOpenNote: 'Non ancora collegato: dopo la trascrizione rimani sempre sulla pagina attuale; il video non si apre automaticamente.',
  lineLength: 'Lunghezza della riga dei sottotitoli', lineLengthDesc: 'Imposta la lunghezza desiderata per le interruzioni di riga automatiche. Le righe modificate manualmente non cambiano.',
  lineLengthNote: (maxChars: number, custom: string | null) => `Non ancora collegato: le interruzioni di riga automatiche sono attualmente fissate a ${maxChars} caratteri a mezza larghezza per riga (ogni carattere CJK conta come due).${custom ? ` Il valore salvato è personalizzato (${custom}).` : ''}`,
  cueShading: 'Sfondo dei sottotitoli nella trascrizione', cueShadingDesc: 'Ombreggia leggermente l’intervallo di ogni sottotitolo per mostrare dove si interrompe.', cueShadingNote: 'Non ancora implementato: la trascrizione non ombreggia gli intervalli dei sottotitoli.',
  downloadsGroup: 'Download e aggiornamenti', autoUpdateOn: 'Verifica e download automatici degli aggiornamenti attivati', autoUpdateOff: 'Download automatico degli aggiornamenti disattivato', downloaderWeb: 'Il browser non verifica gli strumenti di download su questo computer; verifica nell’app desktop BaoCut.',
  sourcesGroup: 'Origini del download e offline',  
  strictOffline: 'Rigorosamente offline', strictOfflineDesc: 'Quando attivo, modelli e strumenti esterni non vengono scaricati e i video non vengono scaricati da link. Non cambia il collegamento online dei modelli cloud e dei motori degli agenti.', strictOfflineOn: 'Modalità rigorosamente offline attivata', strictOfflineOff: 'Modalità rigorosamente offline disattivata', 
  trashDays: 'Giorni di conservazione nel Cestino',
  trashDaysDesc: (fallback: number | null) => `Le voci rimaste nel Cestino più a lungo senza riferimenti e i video eliminati vengono eliminati definitivamente (verifica all’avvio e ogni 6 ore). Le voci ancora referenziate vengono conservate. Svuota il campo per ripristinare il valore predefinito${fallback ? ` di ${pluralForm('it', fallback, { one: `${fallback} giorno`, other: `${fallback} giorni` })}` : ''}.`,
  webNote: 'Un browser non può modificare questa impostazione. Modificala nell’app desktop di BaoCut.',
  webViewOnly: 'In un browser puoi solo visualizzarlo. Apporta le modifiche nell’app desktop di BaoCut.',
  webUnavailable: 'Non è disponibile in un browser. Usa l’app desktop di BaoCut.',
};
