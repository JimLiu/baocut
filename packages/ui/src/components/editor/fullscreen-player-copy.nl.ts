import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const nl: FullscreenPlayerMessages = {
  region: 'Speler op volledig scherm',
  enter: 'Afspelen op volledig scherm',
  enterTip: 'Afspelen op volledig scherm (F)',
  captions: 'Ondertitels',
  captionsTip: (mode: string) => `Ondertitels: ${mode} (C)`,
  captionMode: { off: 'Ondertitels uit', source: 'Origineel', trans: 'Vertaling', both: 'Tweetalig' },
  keysTip: 'Sneltoetsen (?)',
  keysTitle: 'Sneltoetsen',
  keysFooter: 'Druk op Esc om dit overzicht te sluiten en nogmaals om het volledige scherm te verlaten.',
  keys: {
    play: 'Afspelen / pauzeren (gelijk aan één klik op het beeld)',
    exit: 'Volledig scherm verlaten (gelijk aan dubbelklikken op het beeld)',
    back: '5 seconden terug / vooruit',
    back10: '10 seconden terug / vooruit',
    prevChapter: 'Vorig / volgend hoofdstuk',
    volUp: 'Volume ±10 (heft dempen automatisch op)',
    mute: 'Dempen / dempen opheffen',
    captions: 'Ondertitelmodus doorlopen',
    start: 'Naar het begin / einde springen',
    percent: 'Naar 0% – 90% van de video springen',
    keys: 'Dit overzicht',
  },
};
