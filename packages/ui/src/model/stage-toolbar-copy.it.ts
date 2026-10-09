import type { StageToolbarMessages } from './stage-toolbar-copy.ts';

export const it: StageToolbarMessages = {
  toolLabel: {
    color: 'Colore', font: 'Font', size: 'Dimensione', 'text-styles': 'Stili', animation: 'Animazione', transitions: 'Transizioni', volume: 'Volume', speed: 'Velocità', adjust: 'Regola', border: 'Contorno', 'fill-list': 'Colori di riempimento', 'progress-colors': 'Colore', 'progress-picker': 'Stili', 'wave-colors': 'Colore', 'wave-picker': 'Stili', 'counter-mode': 'Modalità', 'volume-levels': 'Livelli di volume', properties: 'Proprietà', copy: 'Duplica', arrange: 'Ordine', 'save-to-brand-kit': 'Salva nel kit del brand', 'adjust-timing': 'Regola tempi', disable: 'Disattiva clip', delete: 'Elimina', bold: 'Grassetto', italic: 'Corsivo', 'align-left': 'Allinea a sinistra', 'align-center': 'Centra', 'align-right': 'Allinea a destra', 'line-height': 'Altezza della riga', 'letter-spacing': 'Spaziatura delle lettere', 'flip-vertical': 'Capovolgi verticalmente', 'flip-horizontal': 'Capovolgi orizzontalmente', 'fit-canvas': 'Adatta all’area di lavoro', 'fill-canvas': 'Riempi area di lavoro', opacity: 'Opacità', 'round-corners': 'Raggio degli angoli', filters: 'Filtri', effects: 'Effetti', 'crop-video': 'Ritaglio intelligente', 'replace-video': 'Sostituisci video', 'replace-image': 'Sostituisci immagine', 'detach-audio': 'Scollega audio',
    'sub-scope': 'Riga da modificare', 'sub-edit': 'Modifica', 'sub-style': 'Stili', 'sub-animation': 'Animazione', case: 'Maiuscole/minuscole', 'hide-subs': 'Nascondi sottotitoli',
  },
  offReason: {
    animation: 'Le animazioni non si possono ancora scegliere nell’editor.',
    brand: 'Il media di questa clip non può essere memorizzato nel kit del brand.',
    roundCorners: 'L’anteprima non disegna ancora gli angoli arrotondati, quindi non si possono impostare qui.',
    filters: 'I filtri (LUT) sono un nome riservato nel formato video e vengono rifiutati in scrittura.',
    crop: 'Il ritaglio intelligente richiede un modello e non ha ancora un punto di accesso. Prossimamente.',
    speed: 'Questa clip non viene riprodotta a velocità costante, quindi non puoi cambiarne la velocità qui.',
    sound: 'Questa clip non ha suono.',
    captionAnimation: 'Le animazioni dei sottotitoli non si possono ancora scegliere nell’editor.',
    captionDefaultStyle: 'Questi sottotitoli usano ancora lo stile predefinito. Cambia prima un’impostazione, poi salvalo nel kit del brand.',
    brandText: 'Il kit del brand non ha ancora una sezione per gli stili di testo.',
    brandWeb: 'Il kit del brand è disponibile solo nell’app desktop e nella CLI.',
  },
  arrange: { front: 'Porta in primo piano', forward: 'Porta avanti', backward: 'Porta indietro', back: 'Porta in secondo piano', label: 'Cambia ordine di sovrapposizione' },
  subtitleBar: 'Barra dei sottotitoli',
  disabledNotice: 'Clip disattivata. Fai clic destro sulla clip nella timeline per riattivarla.',
  detachedNotice: 'Il suono è stato separato su una nuova traccia audio. La clip video è disattivata.',
  textStyleLocked: (schema: string) => `Questo testo usa il formato di stile ${schema} e non può ancora essere modificato qui.`,
};
