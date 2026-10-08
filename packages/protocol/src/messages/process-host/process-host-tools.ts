import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './process-host-tools.zh-Hans.ts';
import { zhHant } from './process-host-tools.zh-Hant.ts';
import { ja } from './process-host-tools.ja.ts';
import { ko } from './process-host-tools.ko.ts';
import { es } from './process-host-tools.es.ts';
import { fr } from './process-host-tools.fr.ts';
import { de } from './process-host-tools.de.ts';
import { nl } from './process-host-tools.nl.ts';
import { ptBR } from './process-host-tools.pt-BR.ts';
import { it } from './process-host-tools.it.ts';
import { ru } from './process-host-tools.ru.ts';
import { pl } from './process-host-tools.pl.ts';
import { tr } from './process-host-tools.tr.ts';
import { vi } from './process-host-tools.vi.ts';

/** 缺 ffmpeg 时的修法，与系统终端里先打印的那一行（`packages/process-host`）。 */
const en = {
  hintMac: 'for example, brew install ffmpeg',
  hintWindows: 'for example, winget install --id Gyan.FFmpeg -e, then reopen BaoCut',
  hintLinux: 'for example, sudo apt install ffmpeg',
  hintDownload: (p: { url: string }) => `download it from ${p.url}`,
  remedyWithProbe: (p: { hint: string }) =>
    `Install ffmpeg (includes ffprobe; ${p.hint}), or point the BAOCUT_FFMPEG / BAOCUT_FFPROBE environment variables at the executables`,
  remedy: (p: { hint: string }) => `Install ffmpeg (${p.hint}), or set its path with BAOCUT_FFMPEG`,
  terminalBanner: (p: { command: string }) => `BaoCut: running ${p.command}`,
};

export type ProcessHostToolsMessages = typeof en;

export const ProcessHostTools = defineCatalog('processHostTools', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
