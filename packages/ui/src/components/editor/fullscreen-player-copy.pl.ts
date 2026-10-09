import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const pl: FullscreenPlayerMessages = {
  region: 'Odtwarzacz pełnoekranowy',
  enter: 'Odtwarzaj na pełnym ekranie',
  enterTip: 'Odtwarzaj na pełnym ekranie (F)',
  captions: 'Napisy',
  captionsTip: (mode: string) => `Napisy: ${mode} (C)`,
  captionMode: { off: 'Napisy wyłączone', source: 'Oryginał', trans: 'Tłumaczenie', both: 'Dwujęzyczne' },
  keysTip: 'Skróty klawiszowe (?)',
  keysTitle: 'Skróty klawiszowe',
  keysFooter: 'Naciśnij Esc, aby zamknąć tę listę, i ponownie, aby opuścić pełny ekran.',
  keys: {
    play: 'Odtwarzanie / pauza (to samo co kliknięcie obrazu)',
    exit: 'Opuść pełny ekran (to samo co dwukrotne kliknięcie obrazu)',
    back: '5 sekund wstecz / do przodu',
    back10: '10 sekund wstecz / do przodu',
    prevChapter: 'Poprzedni / następny rozdział',
    volUp: 'Głośność ±10 (automatycznie wyłącza wyciszenie)',
    mute: 'Wycisz / włącz dźwięk',
    captions: 'Przełącz tryb napisów',
    start: 'Przejdź na początek / koniec',
    percent: 'Przejdź do 0% – 90% filmu',
    keys: 'Ta lista',
  },
};
