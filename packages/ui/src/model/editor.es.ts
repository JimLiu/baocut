import type { EditorMessages } from './editor.ts';
export const es: EditorMessages = {
 trackKind: { visual: 'Visual', audio: 'Audio', subtitle: 'Subtítulos' }, counter: 'Contador', text: 'Texto', shape: 'Forma', composition: 'Composición', caption: 'Subtítulos', asset: 'Material',
 elements: { sticker: 'Pegatina', placeholder: 'Marcador de posición', whiteboard: 'Pizarra', progress: 'Barra de progreso', visualizer: 'Forma de onda', confetti: 'Confeti', draw: 'Dibujo' },
 seconds: (value: string) => `${value} s`,
};
