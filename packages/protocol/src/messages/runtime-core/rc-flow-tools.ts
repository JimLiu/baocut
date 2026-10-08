import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-flow-tools.zh-Hans.ts';
import { zhHant } from './rc-flow-tools.zh-Hant.ts';
import { ja } from './rc-flow-tools.ja.ts';
import { ko } from './rc-flow-tools.ko.ts';
import { es } from './rc-flow-tools.es.ts';
import { fr } from './rc-flow-tools.fr.ts';
import { de } from './rc-flow-tools.de.ts';
import { nl } from './rc-flow-tools.nl.ts';
import { ptBR } from './rc-flow-tools.pt-BR.ts';
import { it } from './rc-flow-tools.it.ts';
import { ru } from './rc-flow-tools.ru.ts';
import { pl } from './rc-flow-tools.pl.ts';
import { tr } from './rc-flow-tools.tr.ts';
import { vi } from './rc-flow-tools.vi.ts';

/**
 * 一级动词（agent-tools/flow-tools.ts：`transcribe`、`translate`、`dub`、`transcode`）给用户看的文字：审批卡里的摘要。
 * 工具说明、错误与给智能体的下一步只给模型看，不在这里。英文是键与类型的来源，译文在 `rc-flow-tools.<语言>.ts`。
 */

/** 摘要里的服务商与模型：给了 provider 时写在括号里。 */
function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}

/** 配音时原声怎么处理（`duck`、`mute`、`keep`）。 */
function originalAction(original: string): string {
  switch (original) {
    case 'mute':
      return 'mute';
    case 'keep':
      return 'keep';
    default:
      return 'lower';
  }
}

/** 转码的动作（`compress`、`merge`、`extract-audio`）连同文件数。 */
function transcodeAction(action: string, count: number): string {
  const files = `${count} ${count === 1 ? 'file' : 'files'}`;
  switch (action) {
    case 'merge':
      return `Merge ${files} in order`;
    case 'extract-audio':
      return `Extract audio from ${files}`;
    default:
      return `Compress ${files}`;
  }
}

const en = {
  /** 列表里各项之间的分隔。 */
  listSeparator: ', ',

  /** 转写已有视频里的素材；`asset` 为 null 时是主轨上的素材。 */
  transcribeVideoSummary: (p: { asset: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Transcribe ${p.asset ? `asset ${p.asset}` : 'the asset on the main track'}${providerNote(p)}${p.captions ? ' and add a subtitle layer' : ''}`,
  /** 转写已有视频里的素材并换用文稿（`target: 'replace'`）。 */
  transcribeReplaceSummary: (p: { asset: string | null; provider: string | null; model: string | null }) =>
    `Re-transcribe ${p.asset ? `asset ${p.asset}` : 'the asset on the main track'}${providerNote(p)} and replace the video's current transcript, carrying over translations, subtitles and dubbing (one undoable transaction)`,
  /** 转写本机文件，只写 TXT 与 SRT 文稿；`outDir` 为 null 时写到下载目录。 */
  transcribeFileSummary: (p: { file: string; provider: string | null; model: string | null; outDir: string | null }) =>
    `Transcribe ${p.file}${providerNote(p)} and write TXT and SRT transcripts to ${p.outDir ?? 'the Downloads folder'}`,
  /** 从本机文件新建视频、导入、放上时间线再转写。 */
  transcribeCreateSummary: (p: { name: string | null; file: string; provider: string | null; model: string | null; captions: boolean }) =>
    `Create video${p.name ? ` "${p.name}"` : ''}, import ${p.file} and add it to the timeline, then transcribe it${providerNote(p)}${p.captions ? ' and add a subtitle layer' : ''}`,

  /** 用文本模型翻译视频里的转写。 */
  translateVideoSummary: (p: { to: string; provider: string | null; model: string | null; captions: boolean; bilingual: boolean }) =>
    `Translate the transcript into ${p.to} with the text model${providerNote(p)}${p.captions ? ` and add a ${p.bilingual ? 'bilingual ' : ''}subtitle layer` : ''}`,
  /** 用文本模型翻译本机的字幕文件；`outDir` 为 null 时写到下载目录。 */
  translateFileSummary: (p: { input: string; to: string; provider: string | null; model: string | null; outDir: string | null }) =>
    `Translate subtitle file ${p.input} into ${p.to} with the text model${providerNote(p)} and write the new file to ${p.outDir ?? 'the Downloads folder'}`,

  /** 翻译配音；`original` 是 `duck`、`mute` 或 `keep`。 */
  dubSummary: (p: {
    to: string | null;
    translation: string | null;
    provider: string | null;
    model: string | null;
    voice: string | null;
    original: string;
  }) =>
    `Translated voice-over${p.to ? ` (${p.to})` : ''}: ${p.translation ? `use translation ${p.translation}` : 'translate with the text model first'}, synthesize sentence by sentence${providerNote(p)}${p.voice ? ` with voice ${p.voice}` : ''}, add a new voice-over track, and ${originalAction(p.original)} the original audio`,

  /** 转码；`action` 是 `compress`、`merge` 或 `extract-audio`，`files` 是前几个文件（用 `listSeparator` 连起来），`truncated` 表示还有更多。 */
  transcodeSummary: (p: { action: string; count: number; files: string; truncated: boolean; outDir: string | null }) =>
    `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? '…' : ''}) and save to ${p.outDir ?? 'the Downloads folder'}`,
};

export type RcFlowToolsMessages = typeof en;

export const RcFlowTools = defineCatalog('rcFlowTools', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
