import { defineMessages } from '@baocut/protocol';
import { zhHans } from './model-management-copy.zh-Hans.ts';
import { zhHant } from './model-management-copy.zh-Hant.ts';
import { ja } from './model-management-copy.ja.ts';
import { ko } from './model-management-copy.ko.ts';
import { es } from './model-management-copy.es.ts';
import { fr } from './model-management-copy.fr.ts';
import { de } from './model-management-copy.de.ts';
import { nl } from './model-management-copy.nl.ts';
import { ptBR } from './model-management-copy.pt-BR.ts';
import { it } from './model-management-copy.it.ts';
import { ru } from './model-management-copy.ru.ts';
import { pl } from './model-management-copy.pl.ts';
import { tr } from './model-management-copy.tr.ts';
import { vi } from './model-management-copy.vi.ts';

const en = {
  removeModel: "Remove model",
  removeModelBody: "Remove this added model from BaoCut? Its provider and accounts are kept. If it is the default, that default will be cleared. If a built-in model has the same ID, it will still be listed after removal and cannot be deleted.",
  pickAudio: "Choose audio or video",
  asrTitle: "Test speech recognition",
  asrNote: "Choose a short audio/video file. Its audio is sent to the selected provider; TXT/SRT results are saved to your configured save location and listed in Space.",
  asrRunning: "Sending audio and waiting for transcription…",
  desktopOnly: "Choose a local file in the desktop app to test speech recognition.",
};
export type ModelManagementMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, 'ja': ja, 'ko': ko, 'es': es, 'fr': fr, 'de': de, 'nl': nl, 'pt-BR': ptBR, 'it': it, 'ru': ru, 'pl': pl, 'tr': tr, 'vi': vi });
