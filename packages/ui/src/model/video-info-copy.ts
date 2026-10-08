import { defineMessages } from '@baocut/protocol';
import { zhHans } from './video-info-copy.zh-Hans.ts';
import { zhHant } from './video-info-copy.zh-Hant.ts';
import { ja } from './video-info-copy.ja.ts';
import { ko } from './video-info-copy.ko.ts';
import { es } from './video-info-copy.es.ts';
import { fr } from './video-info-copy.fr.ts';
import { de } from './video-info-copy.de.ts';
import { nl } from './video-info-copy.nl.ts';
import { ptBR } from './video-info-copy.pt-BR.ts';
import { it } from './video-info-copy.it.ts';
import { ru } from './video-info-copy.ru.ts';
import { pl } from './video-info-copy.pl.ts';
import { tr } from './video-info-copy.tr.ts';
import { vi } from './video-info-copy.vi.ts';

/** 视频详情框的文案（model/video-info.ts；译文在 `video-info-copy.<语言>.ts`）。 */
const en = {
  section: { media: 'Source and media', source: 'Source info' },
  speakers: (count: number) => `${count} ${count === 1 ? 'speaker' : 'speakers'}`,
  chapters: (count: number) => `${count} ${count === 1 ? 'chapter' : 'chapters'}`,
  paragraphs: (count: number) => `${count} ${count === 1 ? 'paragraph' : 'paragraphs'}`,
  /** 几个名字连成一串（各份译文的目标语）。 */
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: {
    'link-import': 'Imported from URL',
    'user-import': 'Local file',
    generated: 'Generated',
    library: 'User library',
  },
  row: {
    contents: 'Contents',
    translation: 'Translation',
    location: 'Location',
    media: 'Media',
    transcript: 'Transcription',
    channel: 'Channel',
    published: 'Published',
    platform: 'Platform',
    mediaId: 'Video ID',
    url: 'URL',
  },
};
export type VideoInfoMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
