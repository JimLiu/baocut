import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const de: FullscreenPlayerMessages = {
  region: 'Vollbild-Player',
  enter: 'Im Vollbild abspielen',
  enterTip: 'Im Vollbild abspielen (F)',
  captions: 'Untertitel',
  captionsTip: (mode: string) => `Untertitel: ${mode} (C)`,
  captionMode: { off: 'Untertitel aus', source: 'Original', trans: 'Übersetzung', both: 'Zweisprachig' },
  keysTip: 'Tastaturkurzbefehle (?)',
  keysTitle: 'Tastaturkurzbefehle',
  keysFooter: 'Mit Esc diese Übersicht schließen, mit einem weiteren Esc das Vollbild verlassen.',
  keys: {
    play: 'Abspielen / Pause (entspricht einem Klick auf das Bild)',
    exit: 'Vollbild verlassen (entspricht einem Doppelklick auf das Bild)',
    back: '5 Sekunden zurück / vor',
    back10: '10 Sekunden zurück / vor',
    prevChapter: 'Vorheriges / nächstes Kapitel',
    volUp: 'Lautstärke ±10 (hebt die Stummschaltung automatisch auf)',
    mute: 'Stummschalten / Ton einschalten',
    captions: 'Untertitelmodus durchschalten',
    start: 'Zum Anfang / Ende springen',
    percent: 'Zu 0 % – 90 % des Videos springen',
    keys: 'Diese Übersicht',
  },
};
