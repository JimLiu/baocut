import {
  LIBRARY_SELECTION_KIND,
  LIBRARY_SELECTION_SCHEMA,
  MAX_SELECTED_GLOSSARIES,
  MAX_SPEAKER_VOICES,
  type DocumentRecord,
  type Id,
  type LibrarySelection,
  type SpeakerVoiceBinding,
} from '@baocut/protocol';

/**
 * 视频里启用的库条目（架构设计 §5.9；视频格式规范 §4.6 的 `library-selection`）：读正文、找文档。
 * 正文认不出的部分不解释（读到的当作没启用），写回由 `library.setVideoSelection` 整份重写。
 */

export function emptySelection(): LibrarySelection {
  return { glossaries: { transcribe: [], translate: [] }, speakerVoices: [] };
}

/** 视频里的 `library-selection` 文档；有几份时取 ID 最小的一份（正常只有一份）。 */
export function selectionDocument(documents: Record<Id, DocumentRecord>): DocumentRecord | null {
  const found = Object.values(documents)
    .filter((d) => d.kind === LIBRARY_SELECTION_KIND)
    .sort((a, b) => a.id.localeCompare(b.id));
  return found[0] ?? null;
}

const ids = (value: unknown): Id[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(0, MAX_SELECTED_GLOSSARIES)
    : [];

/** 读正文：不是 `baocut.library-selection/1` 时当作什么都没启用；不合的项丢掉。 */
export function readSelection(body: unknown): LibrarySelection {
  const b = body as { schema?: unknown; glossaries?: { transcribe?: unknown; translate?: unknown }; speakerVoices?: unknown } | null;
  if (!b || typeof b !== 'object' || b.schema !== LIBRARY_SELECTION_SCHEMA) return emptySelection();
  const speakerVoices: SpeakerVoiceBinding[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(b.speakerVoices) ? b.speakerVoices : []) {
    const v = raw as Partial<SpeakerVoiceBinding> | null;
    if (!v || typeof v.documentId !== 'string' || typeof v.speakerId !== 'string' || typeof v.voice !== 'string' || v.voice === '')
      continue;
    const key = `${v.documentId}\u0000${v.speakerId}`;
    if (seen.has(key) || speakerVoices.length >= MAX_SPEAKER_VOICES) continue;
    seen.add(key);
    speakerVoices.push({
      documentId: v.documentId,
      speakerId: v.speakerId,
      voice: v.voice,
      ...(typeof v.providerId === 'string' && v.providerId !== '' ? { providerId: v.providerId } : {}),
    });
  }
  return { glossaries: { transcribe: ids(b.glossaries?.transcribe), translate: ids(b.glossaries?.translate) }, speakerVoices };
}

/** 写进视频的正文。 */
export function selectionBody(selection: LibrarySelection): Record<string, unknown> {
  return { schema: LIBRARY_SELECTION_SCHEMA, ...selection };
}

/** 读一个视频此刻启用的条目（经 `document` 读正文）；没有这份文档时是空的。 */
export async function videoSelection(
  documents: Record<Id, DocumentRecord>,
  read: (documentId: Id, revision: string) => Promise<unknown>,
): Promise<{ document: DocumentRecord | null; selection: LibrarySelection }> {
  const document = selectionDocument(documents);
  if (!document) return { document: null, selection: emptySelection() };
  return { document, selection: readSelection(await read(document.id, document.currentRevision)) };
}
