import { defineMessages } from '@baocut/protocol';
import { zhHans } from './recording-bar-copy.zh-Hans.ts';
import { zhHant } from './recording-bar-copy.zh-Hant.ts';
import { ja } from './recording-bar-copy.ja.ts';
import { ko } from './recording-bar-copy.ko.ts';
import { es } from './recording-bar-copy.es.ts';
import { fr } from './recording-bar-copy.fr.ts';
import { de } from './recording-bar-copy.de.ts';
import { nl } from './recording-bar-copy.nl.ts';
import { ptBR } from './recording-bar-copy.pt-BR.ts';
import { it } from './recording-bar-copy.it.ts';
import { ru } from './recording-bar-copy.ru.ts';
import { pl } from './recording-bar-copy.pl.ts';
import { tr } from './recording-bar-copy.tr.ts';
import { vi } from './recording-bar-copy.vi.ts';

/** 录制中的控制条与菜单栏图标的文案（屏幕录制设计 §11「录制中」）。英文是键与类型的来源。 */
const en = {
  barTitle: 'Recording controls',
  recording: 'Recording',
  paused: 'Paused',
  countdown: (n: number) => `Starting in ${n}`,
  finishing: 'Finishing…',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  discard: 'Discard',
  discardConfirm: 'Discard this recording?',
  discardYes: 'Discard',
  discardNo: 'Keep',
  lost: (names: string) => `Disconnected: ${names}. Recording continues without it.`,
  roleCamera: 'camera',
  roleMicrophone: 'microphone',
  roleSystemAudio: 'system audio',
  roleScreen: 'screen',
  rolePointer: 'pointer',
  roleKeyboard: 'keyboard',
  trayTip: (elapsed: string) => `BaoCut is recording · ${elapsed}`,
  trayShow: 'Show BaoCut',
  failed: (message: string) => `Couldn’t do that: ${message}`,
};

export type RecordingBarMessages = typeof en;

export const RB = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
