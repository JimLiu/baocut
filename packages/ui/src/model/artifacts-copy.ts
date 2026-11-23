import { defineMessages } from '@baocut/protocol';
import { zhHans } from './artifacts-copy.zh-Hans.ts';
import { zhHant } from './artifacts-copy.zh-Hant.ts';
import { ja } from './artifacts-copy.ja.ts';
import { ko } from './artifacts-copy.ko.ts';
import { es } from './artifacts-copy.es.ts';
import { fr } from './artifacts-copy.fr.ts';
import { de } from './artifacts-copy.de.ts';
import { nl } from './artifacts-copy.nl.ts';
import { ptBR } from './artifacts-copy.pt-BR.ts';
import { it } from './artifacts-copy.it.ts';
import { ru } from './artifacts-copy.ru.ts';
import { pl } from './artifacts-copy.pl.ts';
import { tr } from './artifacts-copy.tr.ts';
import { vi } from './artifacts-copy.vi.ts';

/**
 * Open Artifact 作品在界面上的文案（docs/design/artifacts §5）：作品标签、产物卡片上的种类，与打不开时的说明。
 * 「作品」是 Open Artifact 的 artifact，与 Job 的产物不同（术语表「作品」）。英文写在这里，译文在 `artifacts-copy.zh-Hans.ts` 等。
 */
const en = {
  kind: 'Artifact',
  opening: 'Opening artifact…',
  unavailable: 'Artifacts aren’t available right now.',
  openFailed: 'Couldn’t open this artifact.',
  retry: 'Try again',
  openInBrowser: 'Open in browser',
  types: {
    slides: 'Slides',
    docs: 'Doc',
    design: 'Design',
    designSystem: 'Design system',
    sheets: 'Sheet',
    data: 'Data',
    whiteboard: 'Whiteboard',
    motion: 'Animation',
  },
};
export type ArtifactsMessages = typeof en;
export const ARTIFACTS = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 作品类型的名字：Open Artifact 自带的那几种有译名，别的（自装的类型）没有，退回「作品」。 */
export function artifactTypeLabel(type: string): string {
  const types = ARTIFACTS.types as Record<string, string>;
  const key = type === 'design-system' ? 'designSystem' : type;
  return (Object.hasOwn(types, key) ? types[key] : undefined) ?? ARTIFACTS.kind;
}
