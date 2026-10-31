import { useMemo } from 'react';
import type { ArtifactRef, Id, ResourceRef, WorkItem } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { refOutput } from '../../model/bot-refs.ts';
import { conversationVideoJobs } from '../../model/video-cards.ts';
import { useChannels } from '../../state/channels-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { OutputCard } from '../thread/output-card.tsx';
import { BOT_COPY as C } from './bot-copy.ts';

// 一列不超过视频卡的 360（`OutputCard`），文件卡与视频卡一样宽。
const grid = style({ display: 'grid', gridTemplateColumns: '[repeat(auto-fill, minmax(240px, 360px))]', gap: 8, alignItems: 'start' });
const rows = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none', font: 'ui-sm', color: 'gray-800' });
const row = style({ overflowWrap: 'anywhere' });

/** 资源与产物的一行：有名字写名字；没写名字的文件用文件名，不然一排「文件」分不出是哪个。 */
export function resourceLabel(ref: ResourceRef | ArtifactRef): string {
  const kind = C.detail.resource[ref.kind];
  const name = 'label' in ref && ref.label ? ref.label : ref.kind === 'file' ? ref.path.split(/[\\/]/).pop() : null;
  return name ? `${kind} · ${name}` : kind;
}

/** 视频片段：先把编辑器的播放头放到片段开头，编辑器换到这部视频时按它定位（与 Space 搜索命中相同）。 */
function seekTo(ref: Extract<ResourceRef, { kind: 'video-range' }>) {
  const editor = useEditor.getState();
  const at = ref.startMs / 1000;
  if (editor.videoId === ref.videoId) editor.requestSeek(at);
  else {
    editor.attach(ref.videoId);
    editor.setPlayhead(at);
  }
}

/**
 * 任务的产物或资源（BOT-VE-03、需求 §11.6 第 4 条）：视频、视频片段、文件与 Space 条目画成会话里同一种产物卡——视频卡带缩略图、
 * 时长与状态，下面列线程在这部视频上的活；点「打开编辑器」或文件卡在功能区打开。画不了卡的（消息、任务、文档 id）写一行字。
 * `jobsShownFor`：已经在上面一组卡下列过活的视频，这里不再重复列。
 */
export function TaskRefs({ refs, item, jobsShownFor }: { refs: readonly (ResourceRef | ArtifactRef)[]; item: WorkItem; jobsShownFor?: ReadonlySet<Id> }) {
  const entries = useSpace((s) => s.entries);
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const jobs = useJobs((s) => s.jobs);
  const channelConversation = useChannels((s) => s.channels.find((c) => c.channel.id === item.channelId)?.channel.conversationId ?? null);
  // 线程与频道共用频道文件目录；相对路径的文件、线程交的活都按线程会话找，用户自己的任务没有线程时用频道会话。
  const conversationId = item.threadId ?? channelConversation;
  const cards = useMemo(
    () => refs.map((ref) => ({ ref, output: refOutput(ref, entries, { projects, conversations }, conversationId, C.detail.resource.video) })),
    [refs, entries, projects, conversations, conversationId],
  );
  const jobIds = (ref: ResourceRef | ArtifactRef): Id[] | undefined =>
    item.threadId && (ref.kind === 'video' || ref.kind === 'video-range') && !jobsShownFor?.has(ref.videoId)
      ? conversationVideoJobs(ref.videoId, jobs, item.threadId)
      : undefined;
  // 同一组里同一部视频的活只列在第一张卡下面。
  const listed = new Set<Id>();
  const drawn = cards.filter((card) => card.output);
  const plain = cards.filter((card) => !card.output);
  return (
    <>
      {drawn.length ? (
        <div className={grid}>
          {drawn.map(({ ref, output }, index) => {
            const video = ref.kind === 'video' || ref.kind === 'video-range' ? ref.videoId : null;
            const ids = video && !listed.has(video) ? jobIds(ref) : undefined;
            if (video) listed.add(video);
            return (
              <OutputCard
                key={index}
                output={output!}
                // 只有没带定位的文件才按这条会话的工作目录打开；这里的文件卡都带定位（`refOutput`）。
                conversationId={conversationId ?? ''}
                jobIds={ids}
                onOpen={ref.kind === 'video-range' ? () => seekTo(ref) : undefined}
              />
            );
          })}
        </div>
      ) : null}
      {plain.length ? (
        <ul className={rows}>
          {plain.map(({ ref }, index) => (
            <li key={index} className={row} title={ref.kind === 'file' ? ref.path : undefined}>
              {resourceLabel(ref)}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** 产物里列过活的视频：资源里同一部视频的卡下面不再列一遍。 */
export function videoIdsOf(refs: readonly (ResourceRef | ArtifactRef)[]): Set<Id> {
  return new Set(refs.flatMap((ref) => (ref.kind === 'video' || ref.kind === 'video-range' ? [ref.videoId] : [])));
}
