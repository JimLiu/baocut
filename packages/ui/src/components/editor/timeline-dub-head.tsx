import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ActionButton, Header, Heading, Menu, MenuItem, MenuSection, MenuTrigger, Text, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import DeleteIcon from '@react-spectrum/s2/icons/Delete';
import More from '@react-spectrum/s2/icons/More';
import Redo from '@react-spectrum/s2/icons/Redo';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { languageName } from '../../model/caption-tracks.ts';
import {
  canListenDub,
  failedUnits,
  placedUnits,
  queuedKey,
  queuedSet,
  regenCandidates,
  sourceGroup,
  sourceOf,
  switchSourceOperations,
  trackCounts,
  type DubSource,
} from '../../model/dub-takes.ts';
import { rootSequence } from '../../model/editor.ts';
import { dubGroups, groupLocked, hasBackground, planRecordOf, type DubBlock, type DubGroup } from '../../model/timeline-dub.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { openAiTool } from './ai-tools-nav.ts';
import { DUB_REGEN_COPY as C, TIMELINE_DUB_COPY as DUB } from './dub-copy.ts';
import { openDubFit } from './dub-regen.ts';
import { useEditorActions } from './editor-context.tsx';
import { deleteDubGroup } from './timeline-commands.ts';
import { useDocumentBody } from './timeline-cues.tsx';

/**
 * 一条配音轨此刻的句子：时间线上的块、计划里没合成的、排队重配的，以及它们的计数。行头名字的提示与 ⋯ 的头部共用这一份
 * （设计稿两处都是 `trackLine(d.blocks)`），两边的句数才对得上。
 */
export function useDubTrack(group: DubGroup, sequence: Sequence, documents: Record<Id, DocumentRecord>, blocks: ReadonlyMap<Id, DubBlock>) {
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const queued = queuedSet(useJobs((s) => queuedKey(s.jobs, videoId)));
  const plan = planRecordOf(documents, group.groupId);
  const planBody = useDocumentBody(plan ?? undefined);
  const own = group.itemIds.flatMap((id) => blocks.get(id) ?? []);
  const failed = failedUnits(planBody, placedUnits(sequence, group.groupId));
  return { videoId, queued, plan, planBody, own, failed, counts: trackCounts(own, failed, queued) };
}

/**
 * 配音行头的 ⋯（设计稿 timeline-dub.jsx `DubHead` / `DubHeadMenu`）：头部写这条轨的句数、没合成、过快、静音与重生成中；
 * 听配音 / 听原声 / 两者都听（当前那一项打勾，model/dub-takes.ts 从轨道、静音与闪避反推）；重新生成 N 句…（没合成的与过快的，
 * 打开「改译文并重配」）；重新配音…（翻到工具页的翻译配音，带上这种语言）；移除这组配音（原来在块菜单里）。
 * 重新生成与重新配音是 AI 入口：Web 表面不放。切音源是一笔可撤销的编辑（轨道或实例的静音、闪避的开关），不跑模型。
 */
export function DubHeadMenu({
  group,
  label,
  sequence,
  documents,
  blocks,
}: {
  group: DubGroup;
  /** 行头的名字（「配音 · 英语」）。 */
  label: string;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  blocks: ReadonlyMap<Id, DubBlock>;
}) {
  const runtime = useRuntime();
  const actions = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const { videoId, queued, plan, planBody, own, failed, counts } = useDubTrack(group, sequence, documents, blocks);
  const desktop = runtime.host.platform !== 'web';

  const candidates = regenCandidates(failed, own, group.groupId, queued);
  const self = sourceGroup(group.groupId, planBody);
  const loaded = planBody !== undefined;
  const source: DubSource = loaded ? sourceOf(sequence, self) : 'none';
  const bed = hasBackground(sequence, group.groupId);
  const others = dubGroups(sequence).length > 1;
  const language = group.language ? languageName(group.language) : label;

  const disabled = [
    ...(!editable || !loaded ? ['dub', 'original', 'both'] : canListenDub(self) ? [] : ['dub']),
    ...(editable && plan && videoId && candidates.length > 0 ? [] : ['regen']),
    ...(editable && !groupLocked(sequence, group.groupId) ? [] : ['remove']),
  ];

  /** 配音计划正文：先看文档缓存，没有再读。 */
  const readBody = async (record: DocumentRecord | null): Promise<unknown> => {
    if (!record) return null;
    const cached = runtime.videos.documents.peek(record.id, record.currentRevision);
    if (cached !== undefined) return cached;
    if (!videoId) return null;
    return (await runtime.readDocument(videoId, record.id)).body;
  };

  const switchSource = async (target: Exclude<DubSource, 'none'>) => {
    let latest = sequence;
    let groups;
    try {
      groups = await Promise.all(dubGroups(sequence).map(async (g) => sourceGroup(g.groupId, await readBody(planRecordOf(documents, g.groupId)))));
      // 读计划的这一会儿视频可能变了：按最新的序列算操作。
      const snapshot = useVideo.getState().video?.state?.video;
      const fresh = snapshot ? rootSequence(snapshot) : null;
      if (fresh?.id === sequence.id) latest = fresh;
    } catch {
      ToastQueue.negative(DUB.planUnread, { timeout: 5000 });
      return;
    }
    const operations = switchSourceOperations(latest, groups, group.groupId, target);
    const done = target === 'dub' ? C.sourceDone.dub(language) : C.sourceDone[target];
    if (operations.length > 0 && !(await actions.apply(operations, C.sourceLabel[target]))) return;
    ToastQueue.neutral(done, { timeout: 3000 });
  };

  const run = (key: string) => {
    switch (key) {
      case 'dub':
      case 'original':
      case 'both':
        return void switchSource(key);
      case 'regen':
        if (videoId) openDubFit({ videoId, groupId: group.groupId, units: candidates });
        return;
      case 'redub':
        if (videoId) openAiTool(videoId, 'dub', { language: group.language ? languageName(group.language) : null });
        return;
      case 'remove':
        return void deleteDubGroup(actions, group.groupId, () => readBody(plan));
    }
  };

  const listenHint = !loaded ? C.fitLoading : canListenDub(self) ? C.listenDubHint({ bed, duck: self.policy === 'duck', others }) : C.listenDubKeep;
  return (
    <MenuTrigger align="start">
      <TooltipTrigger>
        <ActionButton isQuiet size="XS" aria-label={C.headMenu(label)}>
          <More />
        </ActionButton>
        <Tooltip>{C.headMenu(label)}</Tooltip>
      </TooltipTrigger>
      <Menu aria-label={C.headMenu(label)} disabledKeys={disabled} onAction={(key) => run(String(key))}>
        <MenuSection aria-label={C.sourceLabel.dub} selectionMode="single" selectedKeys={source === 'none' ? [] : [source]}>
          <Header>
            <Heading>{label}</Heading>
            <Text slot="description">{C.headLine(counts)}</Text>
          </Header>
          <MenuItem id="dub" textValue={C.listenDub}>
            <VolumeTwo />
            <Text slot="label">{C.listenDub}</Text>
            <Text slot="description">{listenHint}</Text>
          </MenuItem>
          <MenuItem id="original" textValue={C.listenOriginal}>
            <AudioWave />
            <Text slot="label">{C.listenOriginal}</Text>
            <Text slot="description">{C.listenOriginalHint(others)}</Text>
          </MenuItem>
          <MenuItem id="both" textValue={C.listenBoth}>
            <AudioWave />
            <Text slot="label">{C.listenBoth}</Text>
            <Text slot="description">{C.listenBothHint(bed)}</Text>
          </MenuItem>
        </MenuSection>
        {desktop && videoId ? (
          <MenuSection>
            <MenuItem id="regen" textValue={C.regenSome(candidates.length)}>
              <Refresh />
              <Text slot="label">{C.regenSome(candidates.length)}</Text>
              <Text slot="description">{editable ? C.regenSomeHint(failed.filter((f) => candidates.includes(f.unitId)).length, counts.fast) : C.readOnly}</Text>
            </MenuItem>
            <MenuItem id="redub" textValue={C.redub}>
              <Redo />
              <Text slot="label">{C.redub}</Text>
              <Text slot="description">{C.redubHint}</Text>
            </MenuItem>
          </MenuSection>
        ) : null}
        <MenuSection>
          <MenuItem id="remove" textValue={DUB.removeGroup}>
            <DeleteIcon />
            <Text slot="label">{DUB.removeGroup}</Text>
            <Text slot="description">{DUB.removeGroupHint(bed)}</Text>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}
