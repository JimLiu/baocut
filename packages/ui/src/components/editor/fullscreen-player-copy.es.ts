import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const es: FullscreenPlayerMessages = {
  region: 'Reproductor a pantalla completa',
  enter: 'Reproducir a pantalla completa',
  enterTip: 'Reproducir a pantalla completa (F)',
  captions: 'Subtítulos',
  captionsTip: (mode: string) => `Subtítulos: ${mode} (C)`,
  captionMode: { off: 'Sin subtítulos', source: 'Original', trans: 'Traducción', both: 'Bilingüe' },
  keysTip: 'Atajos de teclado (?)',
  keysTitle: 'Atajos de teclado',
  keysFooter: 'Pulsa Esc para cerrar esta hoja y de nuevo para salir de pantalla completa.',
  keys: {
    play: 'Reproducir / pausar (igual que un clic sobre la imagen)',
    exit: 'Salir de pantalla completa (igual que un doble clic sobre la imagen)',
    back: 'Retroceder / avanzar 5 segundos',
    back10: 'Retroceder / avanzar 10 segundos',
    prevChapter: 'Capítulo anterior / siguiente',
    volUp: 'Volumen ±10 (activa el sonido automáticamente)',
    mute: 'Silenciar / activar el sonido',
    captions: 'Cambiar el modo de subtítulos',
    start: 'Ir al principio / al final',
    percent: 'Ir al 0 % – 90 % del vídeo',
    keys: 'Esta hoja',
  },
};
