import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const fr: FullscreenPlayerMessages = {
  region: 'Lecteur plein écran',
  enter: 'Lecture en plein écran',
  enterTip: 'Lecture en plein écran (F)',
  captions: 'Sous-titres',
  captionsTip: (mode: string) => `Sous-titres : ${mode} (C)`,
  captionMode: { off: 'Sous-titres désactivés', source: 'Original', trans: 'Traduction', both: 'Bilingue' },
  keysTip: 'Raccourcis clavier (?)',
  keysTitle: 'Raccourcis clavier',
  keysFooter: 'Appuyez sur Échap pour fermer cette liste, puis à nouveau pour quitter le plein écran.',
  keys: {
    play: 'Lecture / pause (équivaut à un clic sur l’image)',
    exit: 'Quitter le plein écran (équivaut à un double clic sur l’image)',
    back: 'Reculer / avancer de 5 secondes',
    back10: 'Reculer / avancer de 10 secondes',
    prevChapter: 'Chapitre précédent / suivant',
    volUp: 'Volume ±10 (réactive le son automatiquement)',
    mute: 'Couper / rétablir le son',
    captions: 'Faire défiler les modes de sous-titres',
    start: 'Aller au début / à la fin',
    percent: 'Aller à 0 % – 90 % de la vidéo',
    keys: 'Cette liste',
  },
};
