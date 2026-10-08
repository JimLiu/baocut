import { useMemo, useState } from 'react';
import type { Id, SpaceEntry } from '@baocut/protocol';
import { ActionButton, Button, Text, ToastQueue } from '@react-spectrum/s2';
import FileText from '@react-spectrum/s2/icons/FileText';
import Folder from '@react-spectrum/s2/icons/Folder';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { mergeDraft } from '../../model/ai-tools-handoff.ts';
import { entryPath, videoTargetOf } from '../../model/space.ts';
import { placeKindOf, videoNameOf } from '../../model/space-actions.ts';
import { isVideoTool, type ToolId } from '../../model/tool-catalog.ts';
import { saveDirLabel } from '../../model/tool-frame.ts';
import { entriesOfJob, followUps, handoverText, newMovieBlock, outputDetail, type FollowUp } from '../../model/tool-outputs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { showInSpace } from '../../state/space-focus-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { EntryThumb } from '../space/space-list.tsx';
import { detail } from './tool-parts.tsx';
import { OUTPUT_COPY } from './tools-copy.ts';
import { ProjectPicker } from './tool-run-view.tsx';
import { useVideoTools } from './use-video-tools.ts';

/*
 * 产物行（产品设计 §2.7「结果与下一步」，设计稿 tool-frame.jsx `ToolOutputRow` / `ToolOutputs`）：一次运行发布进 Space 的
 * 每个条目一行——名字、种类、大小或时长、所在目录；在 Space 中查看、在文件夹中显示（Web 没有，浏览器打不开本机文件夹）、
 * 交给 Agent（`space.continueInConversation` 带上引用，预填一句可改写的话，不自动发送），以及接着用哪个工具。
 * 结果页、任务详情、生成记录共用。接着做什么见 model/tool-outputs.ts。
 */

/** 这几个任务发布进 Space 的产物（`origin.jobId`）。 */
export function useJobOutputs(jobIds: readonly Id[]): SpaceEntry[] {
  const entries = useSpace((s) => s.entries);
  const key = jobIds.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 按 ID 串比较，调用方每次给新数组也不重算
  return useMemo(() => entriesOfJob(entries, jobIds), [entries, key]);
}

/** 一个产物的几样动作；`openEntry` 之外都不关心是哪一页调用。 */
export function useOutputActions() {
  const runtime = useRuntime();
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const { go, openVideo } = useShell.getState();
  const web = runtime.host.platform === 'web';

  const pathOf = (entry: SpaceEntry) => entry.file?.path ?? entryPath(entry, { projects, conversations });
  const reveal = (entry: SpaceEntry) => {
    const path = pathOf(entry);
    if (!path) return;
    runtime.host.revealPath(path).catch((e: Error) => ToastQueue.negative(OUTPUT_COPY.revealFailed(e.message), { timeout: 6000 }));
  };
  const handover = (entry: SpaceEntry) => {
    runtime
      .continueSpaceEntry(entry.id)
      .then(({ conversation, created }) => {
        const shell = useShell.getState();
        shell.setDraft(conversation.id, mergeDraft(shell.drafts[conversation.id], handoverText(entry)));
        go({ tab: 'home', conversationId: conversation.id, projectId: null });
        ToastQueue.positive(OUTPUT_COPY.handedOver(created, entry.name, conversation.title || OUTPUT_COPY.untitled), { timeout: 6000 });
      })
      .catch((e: Error) => ToastQueue.negative(OUTPUT_COPY.handoverFailed(e.message), { timeout: 6000 }));
  };
  const toTool = (tool: ToolId, entry: SpaceEntry) => {
    const { setPreset, setView } = useVideoTools.getState();
    setPreset({ tool, entryId: entry.id });
    if (isVideoTool(tool)) setView(tool, null);
    go({ tab: 'tools', tool });
  };
  const openMovie = (entry: SpaceEntry) => openVideo(videoTargetOf(entry), { conversationId: null, projectId: entry.source.projectId });
  const newMovie = async (entry: SpaceEntry, projectId: Id) => {
    const path = pathOf(entry);
    if (!path) return;
    const name = videoNameOf(path);
    try {
      const { target, importError } = await runtime.createVideoFromFile({ projectId }, path, placeKindOf(entry.fileName), name);
      openVideo(target, { conversationId: null, projectId });
      if (importError) ToastQueue.negative(OUTPUT_COPY.newMovieEmpty(importError), { timeout: 8000 });
      else ToastQueue.positive(OUTPUT_COPY.newMovieDone(name), { timeout: 4000 });
    } catch (e) {
      ToastQueue.negative(OUTPUT_COPY.newMovieFailed((e as Error).message), { timeout: 6000 });
    }
  };
  return { web, pathOf, reveal, handover, toTool, openMovie, newMovie, view: showInSpace };
}

const row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: { default: 12, isCompact: 8 },
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'base',
  minWidth: 0,
});
const head = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const text = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 });
const name = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const sub = style({ font: 'ui-xs', color: 'gray-700', overflowWrap: 'anywhere' });
const acts = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 });
const nextRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const nextLabel = style({ font: 'ui-xs', color: 'gray-700' });
const pickBox = style({ display: 'flex', flexDirection: 'column', gap: 8, width: 'full' });

/** 「以此新建视频」：音频、图片、视频文件选一个项目后直接成为新视频的素材；文稿与字幕写明为什么不行。 */
function NewMovieFrom({ entry, label }: { entry: SpaceEntry; label: string }) {
  const actions = useOutputActions();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<Id | null>(null);
  const [busy, setBusy] = useState(false);
  const block = newMovieBlock(entry, actions.pathOf(entry));
  if (block) {
    return (
      <>
        <Button variant="secondary" size="S" isDisabled>
          {label}
        </Button>
        <span className={detail}>{block}</span>
      </>
    );
  }
  if (!open) {
    return (
      <Button variant="secondary" size="S" onPress={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  const go = () => {
    if (!projectId) return;
    setBusy(true);
    void actions.newMovie(entry, projectId).finally(() => setBusy(false));
  };
  return (
    <div className={pickBox}>
      <span className={detail}>{OUTPUT_COPY.newMovieNote}</span>
      <ProjectPicker value={projectId} onChange={setProjectId} />
      <div className={acts}>
        <Button variant="accent" size="S" isDisabled={!projectId} isPending={busy} onPress={go}>
          {OUTPUT_COPY.newMovieGo}
        </Button>
        <ActionButton isQuiet size="S" onPress={() => setOpen(false)}>
          <Text>{OUTPUT_COPY.newMovieCancel}</Text>
        </ActionButton>
      </div>
    </div>
  );
}

/** 产物行；`fromTool` 是产出它的工具（写进视频的结果按它给下一步）；`compact` 是记录卡里的窄版。 */
export function ToolOutputRow({ entry, fromTool, compact = false }: { entry: SpaceEntry; fromTool?: ToolId | null; compact?: boolean }) {
  const actions = useOutputActions();
  const movie = entry.kind === 'video';
  const nexts = followUps(entry, fromTool);
  const open = nexts.find((n) => n.id === 'open-movie');
  const rest = nexts.filter((n) => n.id !== 'open-movie');
  const path = movie ? null : actions.pathOf(entry);
  const pending = entry.status === 'generating';
  const btn = (n: FollowUp) =>
    n.id === 'new-movie' ? (
      <NewMovieFrom key={n.id} entry={entry} label={n.label} />
    ) : n.kind === 'tool' ? (
      <Button key={n.id} variant="secondary" size="S" isDisabled={pending} onPress={() => actions.toTool(n.id as ToolId, entry)}>
        {n.label}
      </Button>
    ) : null;
  return (
    <div className={row({ isCompact: compact })}>
      <div className={head}>
        <EntryThumb entry={entry} small />
        <span className={text}>
          <span className={name} title={entry.name}>
            {entry.name}
          </span>
          <span className={sub}>{movie ? OUTPUT_COPY.movie : outputDetail(entry)}</span>
        </span>
      </div>
      <div className={acts}>
        {open ? (
          <Button variant="accent" size="S" onPress={() => actions.openMovie(entry)}>
            {open.label}
          </Button>
        ) : null}
        {!movie ? (
          <ActionButton isQuiet size="S" onPress={() => actions.view(entry)}>
            <FileText />
            <Text>{OUTPUT_COPY.inSpace}</Text>
          </ActionButton>
        ) : null}
        {!movie && !actions.web && path ? (
          <ActionButton isQuiet size="S" onPress={() => actions.reveal(entry)}>
            <Folder />
            <Text>{OUTPUT_COPY.reveal}</Text>
          </ActionButton>
        ) : null}
        <ActionButton isQuiet size="S" isDisabled={pending} onPress={() => actions.handover(entry)}>
          <Text>{OUTPUT_COPY.handover}</Text>
        </ActionButton>
      </div>
      {rest.length ? (
        <div className={nextRow}>
          <span className={nextLabel}>{OUTPUT_COPY.nextLabel}</span>
          {rest.map(btn)}
        </div>
      ) : null}
    </div>
  );
}

const list = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const listHead = style({ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 });
const listTitle = style({ flexGrow: 1, margin: 0, font: 'detail', fontWeight: 'bold', color: 'gray-700' });

/** 一次运行的全部产物；`saveDir` 给了就在头上写保存位置。没有产物时什么也不画。 */
export function ToolOutputs({ entries, fromTool, saveDir }: { entries: readonly SpaceEntry[]; fromTool?: ToolId | null; saveDir?: string | null }) {
  if (!entries.length) return null;
  return (
    <div className={list}>
      <div className={listHead}>
        <h3 className={listTitle}>{OUTPUT_COPY.title}</h3>
        {saveDir ? <span className={detail}>{OUTPUT_COPY.savedIn(saveDirLabel(saveDir))}</span> : null}
      </div>
      {entries.map((e) => (
        <ToolOutputRow key={e.id} entry={e} fromTool={fromTool} />
      ))}
    </div>
  );
}
