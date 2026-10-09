import { useState, type Key } from 'react';
import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import { ActionButton, Badge, Menu, MenuItem, MenuSection, MenuTrigger, Text, ToastQueue } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import More from '@react-spectrum/s2/icons/More';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import Redo from '@react-spectrum/s2/icons/Redo';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { languageName } from '../../model/caption-tracks.ts';
import { fallbackUndoOperations, mutedItemsOf } from '../../model/dub-undo.ts';
import { trackRows } from '../../model/editor.ts';
import { DUB_STATUS_TEXT, dubGroupCard, dubPlanRecord, type DubFileRow } from '../../model/editor-ops.ts';
import { formatClock } from '../../model/format.ts';
import { failedUnits, placedUnits, queuedId, queuedKey, queuedSet } from '../../model/dub-takes.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { openAiTool } from './ai-tools-nav.ts';
import { openDubFit } from './dub-regen.ts';
import { useEditorActions } from './editor-context.tsx';
import { useDocumentBody } from './use-document-body.ts';
import { DUB_GROUP_COPY as C } from './dub-group-copy.ts';

/**
 * 音频页里的配音组（设计稿 panel-media.jsx `AudioGroup`）：一种语言一张卡，组头是语言小牌、「配音 · English」、
 * 在不在时间线、文件与句数；点组头展开逐个文件（背景声一行，每句一行，点一句选中它并跳过去）。⋯ 是整组的动作。
 * 「移除这组配音」用配音收据的部分撤销那一套操作（dub-undo）：删掉这一组的实例、恢复这次静音的原声、去掉以配音轨为触发的闪避，
 * 一笔提交、可撤销；协议里没有删轨道与删文档的操作，空的配音轨与配音计划会留下。「重新生成 N 句…」打开改译文并重配
 * （dub-fit-dialog.tsx，挂在时间线上），只重配没合成或放不下的几句；整组下载 Runtime 还没有，置灰写明原因。
 */

const card = style({
  marginTop: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-25',
  overflow: 'hidden',
});
const head = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxSizing: 'border-box',
  width: 'full',
  minHeight: 48,
  paddingY: 4,
  paddingStart: 12,
  paddingEnd: 8,
  backgroundColor: { default: 'transparent', ':hover': 'gray-75' },
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  outlineOffset: -2,
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const badge = style({
  flexShrink: 0,
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-200',
  color: 'gray-800',
  fontSize: '[10px]',
  fontWeight: 'bold',
  lineHeight: '[16px]',
});
const names = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const title = style({ display: 'flex', alignItems: 'center', gap: 4, font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', whiteSpace: 'nowrap' });
const line = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const actions = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 });
const body = style({ borderTopWidth: 1, borderTopStyle: 'solid', borderColor: 'gray-200', maxHeight: 320, overflowY: 'auto' });
const file = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxSizing: 'border-box',
  width: 'full',
  minHeight: 32,
  paddingY: 4,
  paddingStart: 12,
  paddingEnd: 8,
  borderWidth: 0,
  borderTopWidth: { default: 0, isFollowing: 1 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
  backgroundColor: { default: 'transparent', isButton: { ':hover': 'gray-75' }, isSelected: 'blue-100' },
  textAlign: 'start',
  cursor: { default: 'default', isButton: 'pointer' },
  font: 'ui-xs',
  color: 'gray-500',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const fileName = style({
  flexShrink: 0,
  width: 92,
  fontWeight: 'bold',
  color: { default: 'gray-900', isBed: 'cyan-1000', isMuted: 'gray-500' },
  textDecoration: { default: 'none', isMuted: 'line-through' },
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const fileText = style({
  flexGrow: 1,
  minWidth: 0,
  color: { default: 'gray-600', isMuted: 'gray-500' },
  textDecoration: { default: 'none', isMuted: 'line-through' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const fileStatus = style({
  flexShrink: 0,
  paddingX: 4,
  borderRadius: 'sm',
  fontSize: '[10px]',
  fontWeight: 'bold',
  backgroundColor: { default: 'gray-200', isWarn: 'yellow-300', isFailed: 'transparent' },
  color: { default: 'gray-800', isWarn: 'yellow-1100', isFailed: 'gray-700' },
  borderWidth: { default: 0, isFailed: 1 },
  borderStyle: 'solid',
  borderColor: 'gray-400',
});
const fileDur = style({ flexShrink: 0, fontSize: '[10px]', color: 'gray-600', fontVariantNumeric: 'tabular-nums' });

export function DubGroupCard({
  groupId,
  sequence,
  assets,
  editable,
}: {
  groupId: string;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  editable: boolean;
}) {
  const runtime = useRuntime();
  const { apply, undo, seek } = useEditorActions();
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const documents = useVideo((s) => s.video?.state?.video.documents);
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState(false);
  const plan = documents ? dubPlanRecord(documents, groupId) : undefined;
  const planBody = useDocumentBody(plan);
  const g = dubGroupCard(sequence, assets, groupId, planBody);
  const desktop = runtime.host.platform !== 'web';
  const loading = !!plan && planBody === undefined;
  const trackLabel = g.trackId ? trackRows(sequence).find((row) => row.track.id === g.trackId)?.label : undefined;

  // 没合成或放不下、也不在重配的句（与 `g.regen` 同一个口径，再去掉正在重配的）。
  const queued = queuedSet(useJobs((s) => queuedKey(s.jobs, videoId)));
  const regenUnits = failedUnits(planBody, placedUnits(sequence, groupId)).flatMap((f) => (queued.has(queuedId(groupId, f.unitId)) ? [] : [f.unitId]));
  const disabled: string[] = ['download'];
  if (!editable || !videoId || regenUnits.length === 0) disabled.push('regen');
  if (g.state === 'gone') disabled.push('track', 'remove');
  if (!editable || loading) disabled.push('remove');

  const pickRow = (row: DubFileRow) => {
    if (!row.itemId) return;
    const item = sequence.items.find((i) => i.id === row.itemId);
    useEditor.getState().select([row.itemId]);
    if (item) {
      const start = item.type === 'audio' ? item.fromFrame : 'span' in item ? item.span.fromFrame : 0;
      seek((start * sequence.fps.den) / sequence.fps.num);
    }
  };

  const onAction = async (key: Key) => {
    if (key === 'track') {
      const first = g.files.find((f) => f.kind === 'sentence' && f.itemId);
      if (first) pickRow(first);
      ToastQueue.info(C.rowOnTimeline(trackLabel || g.title), { timeout: 3000 });
    } else if (key === 'regen' && videoId) {
      openDubFit({ videoId, groupId, units: regenUnits });
    } else if (key === 'redub' && videoId) {
      openAiTool(videoId, 'dub', { language: g.language ? languageName(g.language) : null });
    } else if (key === 'remove') {
      const fallback = fallbackUndoOperations(sequence, { groupId, trackId: g.trackId ?? '' }, mutedItemsOf(planBody));
      if (!fallback.operations.length) return;
      const receipt = await apply(fallback.operations, C.remove);
      if (!receipt) return;
      ToastQueue.positive(C.removed(g.title), {
        timeout: 5000,
        actionLabel: C.undo,
        onAction: () => void undo({ transaction: receipt.transactionId }),
        shouldCloseOnAction: true,
      });
    }
  };

  const toggle = () => setOpen((v) => !v);
  return (
    <section className={card} aria-label={g.title}>
      <div
        className={head}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          toggle();
        }}>
        {open ? <ChevronDown /> : <ChevronRight />}
        <span className={badge}>{g.badge}</span>
        <span className={names}>
          <span className={title}>
            {g.title}
            <Badge variant="neutral" size="S" fillStyle="subtle">
              {g.state === 'on' ? C.stateOn : g.state === 'off' ? C.stateOff : C.stateGone}
            </Badge>
          </span>
          <span className={line} title={g.line}>
            {g.line}
          </span>
        </span>
        {/* 组头是可点的 div：右侧的 ⋯ 本身是按钮，按钮里不能再套按钮；点它不开合。 */}
        <span className={actions} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <MenuTrigger>
            <ActionButton isQuiet size="S" aria-label={C.groupMenu}>
              <More />
            </ActionButton>
            <Menu aria-label={C.actionsOf(g.title)} disabledKeys={disabled} onAction={(key) => void onAction(key)}>
              <MenuSection>
                <MenuItem id="track" textValue={C.track}>
                  <AudioWave />
                  <Text slot="label">{C.track}</Text>
                  {g.state === 'gone' ? <Text slot="description">{C.trackGone}</Text> : null}
                </MenuItem>
                {g.regen && desktop ? (
                  <MenuItem id="regen" textValue={C.regen(regenUnits.length || g.regen)}>
                    <Refresh />
                    <Text slot="label">{C.regen(regenUnits.length || g.regen)}</Text>
                    <Text slot="description">{editable ? C.regenNote : C.readOnly}</Text>
                  </MenuItem>
                ) : null}
                <MenuItem id="download" textValue={C.download}>
                  <Download />
                  <Text slot="label">{C.download}</Text>
                  <Text slot="description">{C.downloadNote}</Text>
                </MenuItem>
                {desktop && videoId ? (
                  <MenuItem id="redub" textValue={C.redub}>
                    <Redo />
                    <Text slot="label">{C.redub}</Text>
                    <Text slot="description">{C.redubNote}</Text>
                  </MenuItem>
                ) : null}
              </MenuSection>
              <MenuSection>
                <MenuItem id="remove" textValue={C.remove}>
                  <Delete />
                  <Text slot="label">{C.remove}</Text>
                  <Text slot="description">{g.state === 'gone' ? C.trackGone : !editable ? C.readOnly : loading ? C.removeLoading : C.removeNote}</Text>
                </MenuItem>
              </MenuSection>
            </Menu>
          </MenuTrigger>
        </span>
      </div>
      {open ? (
        <div className={`${body} bc-scroll`}>
          {g.files.map((row, index) => {
            const statusText = row.status ? DUB_STATUS_TEXT[row.status] : null;
            const content = (
              <>
                {row.kind === 'bed' ? <MusicNote /> : <AudioWave />}
                <span className={fileName({ isBed: row.kind === 'bed', isMuted: row.muted })}>{row.name}</span>
                <span className={fileText({ isMuted: row.muted })}>{row.text}</span>
                {statusText ? (
                  <span className={fileStatus({ isFailed: row.status === 'failed', isWarn: row.status === 'needs-fit' })}>{statusText}</span>
                ) : null}
                {row.seconds !== null ? <span className={fileDur}>{formatClock(row.seconds, { tenths: true })}</span> : null}
              </>
            );
            const tip = row.text ? (row.itemId ? C.clickToSelect(row.text) : row.text) : row.name;
            return row.itemId && row.kind === 'sentence' ? (
              <button
                key={row.key}
                type="button"
                className={file({ isButton: true, isFollowing: index > 0, isSelected: selection.includes(row.itemId) })}
                title={tip}
                onClick={() => pickRow(row)}>
                {content}
              </button>
            ) : (
              <div key={row.key} className={file({ isFollowing: index > 0 })} title={tip}>
                {content}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
