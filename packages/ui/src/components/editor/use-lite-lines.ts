import { useMemo } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { speechLines, type LiteLine } from '../../model/lite-segments.ts';
import { readSpeechWords } from '../../model/speech-cues.ts';
import { transcriptWords } from '../../model/transcript-cut.ts';
import { mediaCandidates } from './transcribe-run.ts';
import { useDocumentBodies } from './use-document-bodies.ts';

/**
 * 轻量视图的逐句（轻量编辑器设计 §2「句」）：时间线上每段媒体最新的那份转写（与文稿面板同一来源，`mediaCandidates`），
 * 投到序列上（剪掉的词不算），按句末、停顿与说话人折成句，几段媒体的句按时间排到一起。还没取到正文时是空表。
 */
export function useLiteLines(sequence: Sequence, assets: Record<Id, AssetRecord>, documents: Record<Id, DocumentRecord>): LiteLine[] {
  const candidates = useMemo(() => mediaCandidates(sequence, assets, documents), [sequence, assets, documents]);
  const records = useMemo(() => candidates.flatMap((c) => (c.speech ? [c.speech] : [])), [candidates]);
  const { bodies } = useDocumentBodies(records);
  return useMemo(() => {
    const lines: LiteLine[] = [];
    for (const { asset, speech } of candidates) {
      if (!speech) continue;
      const body = bodies.get(speech.id);
      const read = body === undefined ? null : readSpeechWords(body);
      if (!read) continue;
      for (const line of speechLines(transcriptWords(sequence, asset.id, read.words)))
        lines.push({ ...line, id: `${asset.id}:${line.id}` });
    }
    return lines.sort((a, b) => a.start - b.start);
  }, [candidates, bodies, sequence]);
}
