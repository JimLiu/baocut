import type { AudioItem, DubPlanTake, Id } from '@baocut/protocol';
import { ActionButton, Badge, Text, ToastQueue } from '@react-spectrum/s2';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { planTakes, queuedId, queuedKey, queuedSet, switchTakeOperations, takeRef, takeSeconds } from '../../model/dub-takes.ts';
import { rootSequence } from '../../model/editor.ts';
import { createdItemIds } from '../../model/new-items.ts';
import { dubMark, planRecordOf } from '../../model/timeline-dub.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { DUB_REGEN_COPY as C } from './dub-copy.ts';
import { regenDeps, regenerateUnits, useDubRegen } from './dub-regen.ts';
import { useEditorActions } from './editor-context.tsx';
import { Note, SecHead } from './inspector-controls.tsx';
import type { ItemPageProps } from './inspector-sections.tsx';
import { useDocumentBody } from './timeline-cues.tsx';

/**
 * 属性页里一句配音的版本（设计稿 panel-audio-sentence.jsx 的「版」）：一版一行，新的在上——第 k 版、种子、时长、对齐加的速；
 * 当前那一版标「当前」，其余给「换回这一版」（model/dub-takes.ts `switchTakeOperations`，一笔可撤销的编辑，不重新合成）。
 * 下面一个「重新生成这一句」（桌面端；换个种子再合成，旧的一版留着）。不是配音块、或计划里没有这一句时不画。
 */
export function DubTakesSection(props: ItemPageProps<AudioItem>) {
  const mark = dubMark(props.item);
  if (!mark?.unitId) return null;
  return <DubTakes {...props} groupId={mark.groupId} unitId={mark.unitId} />;
}

const rowStyle = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, font: 'ui-sm' });
const rowName = style({ fontWeight: 'bold', flexShrink: 0 });
const rowLine = style({ flexGrow: 1, minWidth: 0, color: 'neutral-subdued', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

function DubTakes({ item, sequence, assets, canChange, groupId, unitId }: ItemPageProps<AudioItem> & { groupId: string; unitId: Id }) {
  const runtime = useRuntime();
  const actions = useEditorActions();
  const documents = useVideo((s) => s.video?.state?.video.documents);
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const queued = queuedSet(useJobs((s) => queuedKey(s.jobs, videoId))).has(queuedId(groupId, unitId));
  const busy = useDubRegen((s) => !!s.busy[groupId]);
  const plan = documents ? planRecordOf(documents, groupId) : null;
  const body = useDocumentBody(plan ?? undefined);
  const unit = body === undefined ? undefined : planTakes(body).get(unitId);
  if (!plan || !unit) return null;
  const desktop = runtime.host.platform !== 'web';
  const takes = [...unit.takes].sort((a, b) => b.k - a.k);

  const use = async (take: DubPlanTake) => {
    const operations = switchTakeOperations({ sequence, item, record: plan, body, unitId, k: take.k, assets });
    if (!operations) return;
    const receipt = await actions.apply(operations, C.labelSwitchTake(take.k));
    if (!receipt) return;
    const snapshot = useVideo.getState().video?.state?.video;
    const fresh = snapshot ? rootSequence(snapshot) : null;
    const created = fresh ? createdItemIds(receipt.createdIds, fresh) : [];
    if (created.length > 0) useEditor.getState().select(created);
    ToastQueue.positive(C.switched(take.k), {
      timeout: 5000,
      actionLabel: C.undo,
      shouldCloseOnAction: true,
      onAction: () => void actions.undo({ transaction: receipt.transactionId }),
    });
  };

  const regen = () => {
    if (!videoId) return;
    void regenerateUnits(regenDeps(runtime, actions), { videoId, groupId, units: [unitId], planDocumentId: plan.id });
  };

  return (
    <>
      <SecHead aside={takes.length > 0 ? C.takesAside(takes.length) : undefined}>{C.takesTitle}</SecHead>
      {takes.map((take) => {
        const current = take.k === unit.take;
        const usable = !current && takeRef(take, assets) !== null;
        return (
          <div key={take.k} className={rowStyle}>
            <span className={rowName}>{C.takeName(take.k)}</span>
            <span className={rowLine} title={usable || current ? undefined : C.takeUnavailable}>
              {C.takeLine(take.seed, takeSeconds(take), take.tempo)}
            </span>
            {current ? (
              <Badge variant="neutral" size="S" fillStyle="subtle">
                {C.takeCurrent}
              </Badge>
            ) : (
              <ActionButton isQuiet size="S" isDisabled={!canChange || !usable || queued} onPress={() => void use(take)}>
                {C.takeUse}
              </ActionButton>
            )}
          </div>
        );
      })}
      {desktop ? (
        <ActionButton size="S" isDisabled={!canChange || queued || busy} onPress={regen}>
          <Refresh />
          <Text>{queued ? C.queued : C.regenThis}</Text>
        </ActionButton>
      ) : null}
      <Note>{C.takesNote}</Note>
    </>
  );
}
