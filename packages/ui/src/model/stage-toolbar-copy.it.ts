import type { StageToolbarMessages } from './stage-toolbar-copy.ts';

export const it: StageToolbarMessages = {
  toolLabel: {
    color: 'Colore', font: 'Font', size: 'Dimensione', 'text-styles': 'Stili', animation: 'Animazione', transitions: 'Transizioni', volume: 'Volume', speed: 'Velocità', adjust: 'Regola', border: 'Contorno', 'fill-list': 'Colori di riempimento', 'progress-colors': 'Colore', 'progress-picker': 'Stili', 'wave-colors': 'Colore', 'wave-picker': 'Stili', 'counter-mode': 'Modalità', 'volume-levels': 'Livelli di volume', properties: 'Proprietà', copy: 'Duplica', arrange: 'Ordine', 'save-to-brand-kit': 'Salva nel kit del brand', 'adjust-timing': 'Regola tempi', delete: 'Elimina', bold: 'Grassetto', italic: 'Corsivo', 'align-left': 'Allinea a sinistra', 'align-center': 'Centra', 'align-right': 'Allinea a destra', 'line-height': 'Altezza della riga', 'letter-spacing': 'Spaziatura delle lettere', 'flip-vertical': 'Capovolgi verticalmente', 'flip-horizontal': 'Capovolgi orizzontalmente', 'fit-canvas': 'Adatta all’area di lavoro', 'fill-canvas': 'Riempi area di lavoro', opacity: 'Opacità', 'round-corners': 'Raggio degli angoli', filters: 'Filtri', effects: 'Effetti', 'crop-video': 'Ritaglio intelligente', 'replace-video': 'Sostituisci video', 'replace-image': 'Sostituisci immagine', 'detach-audio': 'Scollega audio',
    'sub-scope': 'Riga da modificare', 'sub-edit': 'Modifica', 'sub-style': 'Stili', 'sub-animation': 'Animazione', case: 'Maiuscole/minuscole', 'hide-subs': 'Nascondi sottotitoli',
  },
  offReason: {
    animation: 'Il formato video non ha ancora animazioni: non esiste un campo da scrivere né un’operazione di modifica.',
    brand: 'Il kit del brand non può ancora memorizzare clip.',
    roundCorners: 'Il raggio degli angoli per video e immagini non può ancora essere scritto (l’operazione di aspetto non accetta un raggio).',
    filters: 'I filtri (LUT) sono un nome riservato nel formato video e vengono rifiutati in scrittura.',
    crop: 'Il ritaglio intelligente richiede un modello e non ha ancora un punto di accesso. Prossimamente.',
    replace: 'Non esiste ancora un’operazione per sostituire il materiale di una clip.',
    detach: 'Scollega audio non è ancora collegato: richiede l’aggiunta di una clip audio e la disattivazione dell’audio video nella stessa modifica.',
    speed: 'Questa clip non viene riprodotta a velocità costante, quindi non puoi cambiarne la velocità qui.',
    sound: 'Questa clip non ha suono.',
    captionAnimation: 'Il formato video non ha ancora animazioni dei sottotitoli: uno stile dei sottotitoli non ha un campo per esse.',
    captionDefaultStyle: 'Questi sottotitoli usano ancora lo stile predefinito. Cambia prima un’impostazione, poi salvalo nel kit del brand.',
    brandText: 'Il kit del brand non ha ancora una sezione per gli stili di testo.',
  },
  arrange: { front: 'Porta in primo piano', forward: 'Porta avanti', backward: 'Porta indietro', back: 'Porta in secondo piano', label: 'Cambia ordine di sovrapposizione' },
  subtitleBar: 'Barra dei sottotitoli',
  textStyleLocked: (schema: string) => `Questo testo usa il formato di stile ${schema} e non può ancora essere modificato qui.`,
};
