import { defineMessages } from '@baocut/protocol';
import { zhHans } from './player-copy.zh-Hans.ts';
import { zhHant } from './player-copy.zh-Hant.ts';
import { ja } from './player-copy.ja.ts';
import { ko } from './player-copy.ko.ts';
import { es } from './player-copy.es.ts';
import { fr } from './player-copy.fr.ts';
import { de } from './player-copy.de.ts';
import { nl } from './player-copy.nl.ts';
import { ptBR } from './player-copy.pt-BR.ts';
import { it } from './player-copy.it.ts';
import { ru } from './player-copy.ru.ts';
import { pl } from './player-copy.pl.ts';
import { tr } from './player-copy.tr.ts';
import { vi } from './player-copy.vi.ts';

/** 媒体播放器（播放区、字幕列表、控制条）的文案。英文写在这里，译文在 `player-copy.zh-Hans.ts`。 */
const en = {
  surface: (fileName: string) => `${fileName}: Space to play or pause, Left and Right arrows to skip back or forward`,
  loading: 'Loading',
  buffering: 'Buffering',
  openFailed: (message: string) => `Couldn’t open this file: ${message}`,
  subtitles: 'Subtitles',
  cueCount: (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`,
  subtitleFile: 'Subtitle file',
  noSubtitles: 'No subtitles',
  listFailed: (message: string) => `Couldn’t list subtitle files: ${message}`,
  finding: 'Looking for subtitle files…',
  noneNearby: (isAudio: boolean) =>
    `No subtitle files in the same folder. Put an .srt, .vtt, or .ass file next to the ${isAudio ? 'audio' : 'video'}; one with the same name is picked automatically.`,
  noneSelected: 'No subtitles selected.',
  reading: (fileName: string) => `Reading “${fileName}”…`,
  readFailed: (fileName: string, message: string) => `Couldn’t read “${fileName}”: ${message}`,
  empty: (fileName: string) => `No lines found in “${fileName}”. SRT, WebVTT, and ASS are supported.`,
  unknownFormat: 'Unrecognized subtitle format',
  tooLarge: 'The file is too large',
  fetchFailed: (status: number) => `Couldn’t read the file (${status})`,
  play: 'Play',
  pause: 'Pause',
  playTip: 'Play (Space)',
  pauseTip: 'Pause (Space)',
  replayTip: 'Replay (Space)',
  overlay: 'Overlay subtitles',
  showTip: 'Show subtitles (C)',
  hideTip: 'Hide subtitles (C)',
  rateCurrent: (rate: number) => `Playback speed ${rate}×`,
  rate: 'Playback speed',
  rateNormal: '1× (Normal)',
  mute: 'Mute',
  unmute: 'Unmute',
  muteTip: 'Mute (M)',
  unmuteTip: 'Unmute (M)',
  volume: 'Volume',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  fullscreenTip: 'Full screen (F)',
  exitFullscreenTip: 'Exit full screen (F)',
  position: 'Playback position',
  backToCurrent: 'Back to current line',
  mediaError: {
    aborted: 'Loading was interrupted',
    network: 'Something went wrong while reading the file',
    decode: 'Decoding failed; the file may be damaged',
    unsupported: 'BaoCut can’t play this file’s format or codec yet',
    other: 'Couldn’t play this file',
  },
};

export type PlayerMessages = typeof en;

export const P = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
