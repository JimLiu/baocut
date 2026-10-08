import type { LibraryName, SpeakerVoiceBinding, VideoLibrarySelection } from '@baocut/protocol';
import { M } from './library-copy.ts';

/**
 * `baocut library` 管理命令的参数与输出（架构设计 §5.9）。列出与查看条目是派生命令（`library list|show`）。
 */

/** 库名：`glossaries | voices | brand`。 */
export function parseLibraryName(text: string | undefined): LibraryName {
  if (text === 'glossaries' || text === 'voices' || text === 'brand') return text;
  throw new Error(M.unknownLibrary(text));
}

export function libraryLabel(library: LibraryName): string {
  return M.libraryLabels[library];
}

/** `--speaker-voice <转写 id>:<说话人>=<音色>[@<Provider>]`：`library:` 音色不带 Provider。 */
export function parseSpeakerVoice(text: string): SpeakerVoiceBinding {
  const colon = text.indexOf(':');
  const equals = text.indexOf('=', colon + 1);
  if (colon <= 0 || equals <= colon + 1 || equals === text.length - 1) {
    throw new Error(M.speakerVoiceFormat(text));
  }
  const documentId = text.slice(0, colon);
  const speakerId = text.slice(colon + 1, equals);
  let voice = text.slice(equals + 1);
  const at = voice.lastIndexOf('@');
  const providerId = at > 0 ? voice.slice(at + 1) : '';
  if (at > 0) voice = voice.slice(0, at);
  return { documentId, speakerId, voice, ...(providerId ? { providerId } : {}) };
}

/** 逗号分隔的条目 ID；空字符串表示清空。 */
export function parseIdList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** `baocut library video-selection` 的输出：每一步启用的术语表与说话人的音色。 */
export function formatVideoSelection(result: VideoLibrarySelection): string[] {
  const { selection } = result;
  const list = (ids: string[]) => (ids.length > 0 ? ids.join(M.listSep) : M.none);
  const lines = [
    M.selectionHead(result.videoId, result.documentId, result.revision),
    M.transcribeGlossaries(list(selection.glossaries.transcribe)),
    M.translateGlossaries(list(selection.glossaries.translate)),
  ];
  if (selection.speakerVoices.length === 0) lines.push(M.speakerVoicesNone);
  for (const b of selection.speakerVoices) {
    lines.push(M.speakerVoice(b.documentId, b.speakerId, b.voice, b.providerId ?? null));
  }
  return lines;
}
