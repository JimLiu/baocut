import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: FontSettingsMessages = {
  lead: (total: number | null) => `I font provengono da tre fonti: quelli inclusi nell’app, quelli installati su questo computer e la directory Google Fonts (${total === null ? 'circa duemila famiglie' : pluralForm('it', total, { one: `circa ${total.toLocaleString(intlLocale())} famiglia`, other: `circa ${total.toLocaleString(intlLocale())} famiglie` })}, licenze open source, scaricati su richiesta). I download inviano solo il nome della famiglia e il peso e non richiedono un account; i font vengono memorizzati nei dati dell’app, non nella cartella del video.`,
  download: 'Scarica', autoDownload: 'Scarica automaticamente i font',
  autoDownloadDesc: 'Scarica da Google Fonts quando l’anteprima, l’apertura di un video o l’esportazione richiede un font non presente su questo computer. Quando disattivato, vengono usati prima font alternativi per visualizzazione ed esportazione e puoi ancora scaricare manualmente quando scegli un font. Non viene scaricato nulla in modalità rigorosamente offline.',
  cssEndpoint: 'URL del foglio di stile', cssEndpointDesc: 'URL di base di un mirror. Lascia vuoto per usare https://fonts.googleapis.com.',
  fileEndpoint: 'URL dei file dei font', fileEndpointDesc: 'I file dei font vengono recuperati solo da questo URL. Lascia vuoto per usare https://fonts.gstatic.com.',
  downloaded: 'Font scaricati', summary: (families: number, size: string) => `${pluralForm('it', families, { one: `${families} famiglia`, other: `${families} famiglie` })} · ${size}`,
  none: 'Nessuno ancora', clearAll: 'Cancella tutto',
  empty: 'Qui sono elencati i font scaricati durante la scelta di un font o automaticamente all’apertura di un video o durante l’esportazione.',
  clearTitle: 'Cancellare i font scaricati?', clear: 'Cancella', cancel: 'Annulla',
  removed: (family: string, size: string) => `Eliminato: «${family}» · Liberati ${size}`,
  inUseTip: 'Un’esportazione non completata lo sta usando; eliminalo dopo il completamento', removeTip: 'Elimina i file scaricati di questo font',
  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) => `Pesi ${weights} · ${size} · ${licence}${ago ? ` · Scaricato ${ago}` : ''}`,
  inUse: 'Usato dall’esportazione',
};
