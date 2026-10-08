import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { EditorContext, Id } from '@baocut/protocol';
import { sequenceChapters, visibleChapters } from '../model/chapters.ts';
import type { VideoMentions } from '../model/composer-completions.ts';
import { readSpeechWords } from '../model/speech-cues.ts';
import { useRuntime } from '../runtime/context.tsx';
import { captureEditorContext, useContextTag, type ContextScope } from '../state/agent-context.ts';
import { useVideo } from '../state/video-store.ts';
import type { ComposerProps } from './composer.tsx';
import { mediaCandidates } from './editor/transcribe-run.ts';
import { S } from './shell-copy.ts';

/**
 * 输入框上方的视频引用标签与发送时的上下文（产品设计 §3.2.3、§3.2.4）。
 * 用户移除标签只影响下一条消息；发送前先等编辑器里已经发出的修改都有结果，再取版本。
 */
export function useEditorReference(scope: ContextScope): {
  reference: ComposerProps['reference'];
  /** 发送时调用：要附带时返回这一刻的上下文。 */
  capture(): Promise<EditorContext | undefined>;
  /** 发送成功后调用：恢复标签。 */
  reset(): void;
} {
  const runtime = useRuntime();
  const tag = useContextTag(scope);
  const [excluded, setExcluded] = useState<Id | null>(null);
  const included = tag !== null && excluded !== tag.videoId;
  return {
    reference: included
      ? {
          label: S.editorReference.label(tag.videoName, tag.selected),
          description: S.editorReference.description,
          onRemove: () => setExcluded(tag.videoId),
        }
      : null,
    capture: async () => {
      if (!included) return undefined;
      await runtime.videos.settled();
      return captureEditorContext(scope) ?? undefined;
    },
    reset: () => setExcluded(null),
  };
}

/**
 * @ 补全里「这个视频」那一组的数据（设计稿 model-agent.js `mentionItems`）：会话能附带的那个打开的视频（与引用标签同一判断）
 * 的主序列章节，和时间线上各份转写里出现过的说话人（名字去重）。转写正文经视频的文档缓存取，与文稿面板共用。
 * 没有打开、不在范围内时 null。
 */
export function useVideoMentions(scope: ContextScope): VideoMentions | null {
  const documents = useRuntime().videos.documents;
  const tag = useContextTag(scope);
  const snapshot = useVideo((s) => (tag && s.video?.videoId === tag.videoId ? (s.video.state?.video ?? null) : null));
  const sequence = snapshot ? snapshot.sequences[snapshot.rootSequenceId] : undefined;
  const speech = useMemo(
    () => (snapshot && sequence ? mediaCandidates(sequence, snapshot.assets, snapshot.documents).flatMap((c) => (c.speech ? [c.speech] : [])) : []),
    [snapshot, sequence],
  );
  const key = speech.map((record) => `${record.id}@${record.currentRevision}`).join(',');
  useEffect(() => {
    // 按「文档@版本」取：`key` 变了才需要再取。
    for (const record of speech) documents.load(record.id, record.currentRevision);
  }, [documents, key]);
  const subscribe = useCallback((listener: () => void) => documents.subscribe(listener), [documents]);
  const ready = useSyncExternalStore(subscribe, () => speech.map((r) => (documents.peek(r.id, r.currentRevision) === undefined ? 0 : 1)).join(''));
  return useMemo(() => {
    if (!sequence) return null;
    const speakers = new Map<string, { id: string; name: string }>();
    for (const record of speech) {
      const read = readSpeechWords(documents.peek(record.id, record.currentRevision));
      if (!read) continue;
      for (const word of read.words) {
        if (word.speaker === undefined) continue;
        const name = read.speakers.get(word.speaker) ?? word.speaker;
        if (!speakers.has(name)) speakers.set(name, { id: `${record.id}:${word.speaker}`, name });
      }
    }
    return { chapters: visibleChapters(sequenceChapters(sequence)), speakers: [...speakers.values()] };
    // `ready`：正文取到了才重算。
  }, [sequence, speech, documents, ready]);
}
