import { defineMessages, type MissingAsset } from '@baocut/protocol';
import { zhHans } from './stage-media-copy.zh-Hans.ts';
import { zhHant } from './stage-media-copy.zh-Hant.ts';
import { ja } from './stage-media-copy.ja.ts';
import { ko } from './stage-media-copy.ko.ts';
import { es } from './stage-media-copy.es.ts';
import { fr } from './stage-media-copy.fr.ts';
import { de } from './stage-media-copy.de.ts';
import { nl } from './stage-media-copy.nl.ts';
import { ptBR } from './stage-media-copy.pt-BR.ts';
import { it } from './stage-media-copy.it.ts';
import { ru } from './stage-media-copy.ru.ts';
import { pl } from './stage-media-copy.pl.ts';
import { tr } from './stage-media-copy.tr.ts';
import { vi } from './stage-media-copy.vi.ts';

/** 主媒体放不出来时舞台卡片的文案（model/stage-media.ts；译文在 `stage-media-copy.<语言>.ts`）。 */
const en = {
  titles: {
    missing: 'Source file not found',
    changed: 'The source file has changed',
    'outside-project': 'The source file is outside the project folder',
    unplayable: 'The source file can’t be played',
  } satisfies Record<MissingAsset['reason'] | 'unplayable', string>,
  causes: {
    missing: 'The file may have been moved, renamed or deleted, or it may be on a drive that’s been disconnected.',
    changed: 'The file at this location is no longer the one that was imported (its size doesn’t match). It may have been overwritten or exported again.',
    'outside-project': 'The recorded location is outside the project folder that holds this video, and BaoCut doesn’t read files there.',
  } satisfies Record<MissingAsset['reason'], string>,
  unplayable: (error: string) => `The player can’t open this file: ${error}.`,
  /** 字幕照常播（预览的时钟不依赖媒体）；缺的是画面与原声，或者只是一段声音。 */
  tail: {
    video: 'Subtitles still play; there’s just no picture or original sound.',
    audio: 'Subtitles still play; you just won’t hear this audio.',
  },
  /** 原因与结尾两句接成正文。 */
  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `The file is on “${volume}”. Connect that drive and it will recover automatically.`,
  more: (count: number) => `${count} more video or audio ${count === 1 ? 'asset' : 'assets'} can’t be played either.`,
  relinkHint: 'Choose the original file to recover it. BaoCut checks the contents, and a file with different contents can’t be relinked.',
  desktopOnly: 'To recover it, open this video in the BaoCut desktop app and use “Relink…” on the canvas to choose the original file.',
  managed: 'This file was stored in the video folder, so it can’t be relinked to another location.',
  oldRevision: 'The timeline uses an older version of this asset; only the current version can be relinked.',
  relink: 'Relink…',
  relinking: 'Checking…',
  pickTitle: (name: string) => `Find “${name}”`,
  pickButton: 'Relink',
  label: (name: string) => `Relink “${name}”`,
  relinkFailed: (message: string) => `Couldn’t relink: ${message}`,
  decodeFailed: 'Decoding failed',
  unsupported: 'Format not supported',
};
export type StageMediaMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
