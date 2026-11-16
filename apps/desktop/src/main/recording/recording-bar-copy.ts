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

/** 主进程开的录制小窗的标题与菜单栏（托盘）图标的文案（屏幕录制设计 §11）。小窗里的文字在 @baocut/ui。英文是键与类型的来源。 */
const en = {
  launcherTitle: 'Record',
  pickerTitle: 'Choose what to record',
  barTitle: 'Recording controls',
  cameraTitle: 'Camera preview',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed: string) => `Stop recording · ${elapsed}`,
  trayFinishing: 'Finishing…',
  trayOpen: 'Open BaoCut',
  trayDisplay: 'Record screen',
  trayWindow: 'Record window',
  trayArea: 'Record area',
  traySettings: 'Settings…',
  trayQuit: 'Quit BaoCut',
};

export type RecordingBarMessages = typeof en;

export const RB = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
