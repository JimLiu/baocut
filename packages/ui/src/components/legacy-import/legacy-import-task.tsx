import { useState, type ReactNode } from 'react';
import type { LegacyImportItem, LegacyImportRun } from '@baocut/protocol';
import { ActionButton, Badge, Button, ProgressBar, ProgressCircle, Text, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Close from '@react-spectrum/s2/icons/Close';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import {
  itemNote,
  legacyTaskId,
  LR,
  pendingPaths,
  problemGroups,
  revealTarget,
  runBanner,
  runCounts,
  runPhase,
  cardHint,
  cardNote,
  type ProblemGroup as Group,
} from '../../model/legacy-import-run.ts';
import type { TaskRow } from '../../model/task-list.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useLegacyImport } from '../../state/legacy-import-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { sectionTitle } from '../tasks/task-sections.tsx';
import { TK } from '../tasks/tasks-copy.ts';
import { useNow } from '../use-now.ts';
import { UtilityPage } from '../utility-page.tsx';

/*
 * 旧版项目导入这一轮的界面（设计稿 legacy-import-task.jsx；进度、分组、原因与补救的文案在 model/legacy-import-run.ts）：
 * - LegacyImportCardNote：任务页卡片上的原因一句、怎么办一句，加「全部重试」「全部跳过」。
 * - LegacyImportDetail：任务详情里的计数、没导入的项目（按原因分组，每组写原因与怎么办，整组或逐个重试 / 跳过）、
 *   正在导入与排队的、已导入的、已跳过的（可以改为导入）。
 * - LegacyImportBanner：Home 顶上一条。导入是全局的事，视频顶栏的任务胶囊只报这部视频的任务，不报它；
 *   在跑时报进度，跑完留了没导入的报结果与原因，可以关掉。
 * 重试 / 跳过发给 Runtime（`legacyImport.retry` / `legacyImport.setSkipped`），结果经 `legacy-import` 主题回来。
 */

/** 每一节先列这么多行，其余收起。 */
const FOLD = 5;

/** 去 Space 看导入的项目：导入目录就是一个项目；还没在目录里时去 Space 的总览。 */
export function useOpenImported(): (run: Pick<LegacyImportRun, 'directory'> | null) => void {
  const go = useShell((s) => s.go);
  return (run) => {
    const trim = (p: string) => p.replace(/[\\/]+$/, '');
    const target = run ? trim(run.directory) : null;
    const project = target ? useDirectory.getState().projects.find((p) => trim(p.path) === target) : undefined;
    go({ tab: 'space', category: 'all', projectId: project?.id ?? null });
  };
}

/** 重试 / 跳过 / 撤销跳过。数字按 Runtime 给的「改了几个」念。 */
export function useLegacyActions(): { retry(paths?: string[]): void; skip(paths?: string[]): void } {
  const runtime = useRuntime();
  const fail = (error: unknown) =>
    ToastQueue.negative(LR.actionFailed(error instanceof Error ? error.message : String(error)));
  const retry = (paths?: string[]) => {
    runtime
      .retryLegacyImport(paths)
      .then((n) => {
        if (n) ToastQueue.info(LR.retrying(n));
      })
      .catch(fail);
  };
  const skip = (paths?: string[]) => {
    const picked = pendingPaths(useLegacyImport.getState().run, paths);
    if (!picked.length) return;
    runtime
      .skipLegacyImport(picked, true)
      .then((n) => {
        if (!n) return;
        ToastQueue.neutral(LR.skipped(n), {
          actionLabel: LR.undo,
          shouldCloseOnAction: true,
          onAction: () => void runtime.skipLegacyImport(picked, false).catch(fail),
        });
      })
      .catch(fail);
  };
  return { retry, skip };
}

const note = style({ marginTop: 8, paddingX: 12, paddingY: 8, borderRadius: 'default', backgroundColor: 'orange-100' });
const noteWhy = style({
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'orange-1100',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const noteFix = style({ font: 'ui-xs', color: 'gray-800', marginTop: 4 });
const noteActs = style({ display: 'flex', gap: 8, marginTop: 8 });

/** 任务页卡片上：原因一句、怎么办一句、全部重试 / 全部跳过。没有没导入的不画。 */
export function LegacyImportCardNote() {
  const run = useLegacyImport((s) => s.run);
  const act = useLegacyActions();
  const why = cardNote(run);
  if (!why) return null;
  return (
    <div className={note}>
      <div className={noteWhy}>
        <AlertTriangle />
        <span>{why}</span>
      </div>
      <div className={noteFix}>{cardHint(run)}</div>
      <div className={noteActs}>
        <Button variant="secondary" size="S" onPress={() => act.retry()}>
          {LR.retryAll}
        </Button>
        <ActionButton isQuiet size="S" onPress={() => act.skip()}>
          {LR.skipAll}
        </ActionButton>
      </div>
    </div>
  );
}

const statusLine = style({ font: 'ui-sm', color: 'gray-600', marginTop: -20, marginBottom: 0 });
const progress = style({ maxWidth: 420, marginTop: 16 });
const phaseLine = style({ font: 'ui-sm', color: 'gray-600', marginTop: '[6px]', marginBottom: 0 });
const stats = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 });
const stat = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 96,
  paddingX: 16,
  paddingY: 8,
  borderRadius: 'default',
  backgroundColor: { default: 'gray-100', tone: { notice: 'orange-100' } },
});
const statN = style({
  font: 'heading-sm',
  color: { default: 'gray-900', tone: { positive: 'green-1000', notice: 'orange-1100' } },
});
const statLabel = style({ font: 'ui-xs', color: 'gray-600' });
const sectionRow = style({ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 28 });
const sectionHead = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-600', margin: 0, flexGrow: 1 });
const sectionHint = style({ font: 'ui-xs', color: 'gray-600' });
const card = style({
  marginTop: 8,
  paddingX: 16,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
});
const groupHead = style({
  display: 'flex',
  alignItems: 'start',
  gap: 12,
  paddingTop: 16,
  paddingBottom: 12,
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const groupIcon = style({ display: 'flex', flexShrink: 0, color: 'orange-900', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const groupBody = style({ flexGrow: 1, minWidth: 0 });
const groupTitle = style({ font: 'title-sm', color: 'gray-900' });
const groupLine = style({ font: 'ui-sm', color: 'gray-800', marginTop: 4 });
const groupActs = style({ display: 'flex', gap: 8, flexShrink: 0 });
const itemRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 12,
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const rowIcon = style({
  display: 'flex',
  flexShrink: 0,
  color: { default: 'gray-700', isOk: 'green-900' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const rowBody = style({ flexGrow: 1, minWidth: 0 });
const rowHead = style({ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 });
const rowName = style({ font: 'ui', color: 'gray-900', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const rowWhen = style({ font: 'ui-xs', color: 'gray-600', flexShrink: 0 });
const rowNote = style({ font: { default: 'ui-xs', isPath: 'code-xs' }, color: 'gray-600', marginTop: 2, overflowWrap: 'anywhere', userSelect: 'text' });
const rowActs = style({ display: 'flex', gap: 4, flexShrink: 0 });
const fold = style({
  paddingY: 4,
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'positive' | 'notice' }) {
  return (
    <div className={stat({ tone })}>
      <span className={statN({ tone })}>{n}</span>
      <span className={statLabel}>{label}</span>
    </div>
  );
}

/** 一节里的行：先列 FOLD 行，其余一颗「展开」。 */
function Fold<T>({ items, render }: { items: readonly T[]; render(item: T): ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FOLD);
  return (
    <>
      {shown.map(render)}
      {items.length > FOLD ? (
        <div className={fold}>
          <ActionButton isQuiet size="S" onPress={() => setAll(!all)}>
            {all ? LR.collapse : LR.expand(items.length - FOLD)}
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}

function ItemHead({ item }: { item: LegacyImportItem }) {
  return (
    <div className={rowHead}>
      <span className={rowName} title={item.path}>
        {item.title}
      </span>
      {item.editedAt ? <span className={rowWhen}>{agoLabel(item.editedAt)}</span> : null}
    </div>
  );
}

function ProblemGroup({ group, act }: { group: Group; act: ReturnType<typeof useLegacyActions> }) {
  const runtime = useRuntime();
  const paths = group.items.map((it) => it.path);
  return (
    <div className={card} data-kind={group.kind}>
      <div className={groupHead}>
        <span className={groupIcon}>
          <AlertTriangle />
        </span>
        <div className={groupBody}>
          <div className={groupTitle}>{LR.groupTitle(group.title, group.items.length)}</div>
          <div className={groupLine}>{group.why}</div>
          <div className={groupLine}>
            <strong>{LR.howTo}</strong>
            {group.fix}
          </div>
        </div>
        {group.items.length > 1 ? (
          <div className={groupActs}>
            <Button variant="secondary" size="S" onPress={() => act.retry(paths)}>
              {LR.retryAll}
            </Button>
            <ActionButton isQuiet size="S" onPress={() => act.skip(paths)}>
              {LR.skipAll}
            </ActionButton>
          </div>
        ) : null}
      </div>
      <Fold
        items={group.items}
        render={(item) => {
          const reveal = revealTarget(item);
          return (
            <div className={itemRow} key={item.path}>
              <span className={rowIcon({})}>
                <FolderOpen />
              </span>
              <div className={rowBody}>
                <ItemHead item={item} />
                <div className={rowNote({ isPath: group.kind === 'offline' || group.kind === 'missing' })}>{itemNote(item)}</div>
              </div>
              <div className={rowActs}>
                {reveal ? (
                  <ActionButton isQuiet size="S" onPress={() => void runtime.host.revealPath(reveal)}>
                    <Folder />
                    <Text>{LR.reveal}</Text>
                  </ActionButton>
                ) : null}
                <Button variant="secondary" size="S" onPress={() => act.retry([item.path])}>
                  {LR.retry}
                </Button>
                <ActionButton isQuiet size="S" onPress={() => act.skip([item.path])}>
                  {LR.skip}
                </ActionButton>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}

/** 任务详情：标题、状态行、进度，然后是计数与各节（设计稿 `LegacyImportTaskPanel`）。 */
export function LegacyImportDetail({ row, run, backButton }: { row: TaskRow; run: LegacyImportRun; backButton: ReactNode }) {
  const now = useNow(1000, row.live);
  const act = useLegacyActions();
  const openImported = useOpenImported();
  const c = runCounts(run);
  const groups = problemGroups(run);
  const live = run.items.filter((it) => it.state === 'importing' || it.state === 'queued');
  const imported = run.items.filter((it) => it.state === 'imported');
  const skipped = run.items.filter((it) => it.state === 'skipped');
  const detail = row.live ? runPhase(run).detail : null;

  return (
    <UtilityPage kind="tasks" before={backButton} title={row.title}>
      <p className={statusLine}>{[row.where, agoLabel(row.startedAt, now)].filter(Boolean).join(' · ')}</p>
      {row.live && typeof row.progress === 'number' ? (
        <div className={progress}>
          <ProgressBar size="S" aria-label={TK.progress(row.title, row.label)} value={row.progress} />
        </div>
      ) : null}
      {row.live && (detail || row.phase) ? <p className={phaseLine}>{detail ?? row.phase}</p> : null}

      <div className={stats}>
        <Stat n={c.imported} label={LR.statImported} tone={c.imported ? 'positive' : undefined} />
        <Stat n={c.pending} label={LR.statPending} tone={c.pending ? 'notice' : undefined} />
        <Stat n={c.skipped} label={LR.statSkipped} />
        {c.live ? <Stat n={c.live} label={LR.statLive} /> : null}
      </div>

      {groups.length ? (
        <>
          <div className={sectionRow}>
            <h2 className={sectionHead}>{LR.pendingSection}</h2>
            <span className={sectionHint}>{LR.pendingHint}</span>
          </div>
          {groups.map((group) => (
            <ProblemGroup key={group.key} group={group} act={act} />
          ))}
        </>
      ) : null}

      {live.length ? (
        <>
          <h2 className={sectionTitle}>{LR.liveSection}</h2>
          <div className={card}>
            <Fold
              items={live}
              render={(item) => (
                <div className={itemRow} key={item.path}>
                  <span className={rowIcon({})}>
                    <FolderOpen />
                  </span>
                  <div className={rowBody}>
                    <ItemHead item={item} />
                  </div>
                  <Badge variant={item.state === 'importing' ? 'informative' : 'neutral'} fillStyle="subtle" size="S">
                    {item.state === 'importing' ? LR.importingChip : LR.queuedChip}
                  </Badge>
                </div>
              )}
            />
          </div>
        </>
      ) : null}

      {imported.length ? (
        <>
          <div className={sectionRow}>
            <h2 className={sectionHead}>{LR.importedSection}</h2>
            <ActionButton isQuiet size="S" onPress={() => openImported(run)}>
              {LR.viewInSpace}
            </ActionButton>
          </div>
          <div className={card}>
            <Fold
              items={imported}
              render={(item) => (
                <div className={itemRow} key={item.path}>
                  <span className={rowIcon({ isOk: true })}>
                    <Checkmark />
                  </span>
                  <div className={rowBody}>
                    <ItemHead item={item} />
                  </div>
                </div>
              )}
            />
          </div>
        </>
      ) : null}

      {skipped.length ? (
        <>
          <div className={sectionRow}>
            <h2 className={sectionHead}>{LR.skippedSection}</h2>
            <span className={sectionHint}>{LR.skippedHint}</span>
          </div>
          <div className={card}>
            <Fold
              items={skipped}
              render={(item) => (
                <div className={itemRow} key={item.path}>
                  <span className={rowIcon({})}>
                    <FolderOpen />
                  </span>
                  <div className={rowBody}>
                    <ItemHead item={item} />
                  </div>
                  <ActionButton isQuiet size="S" onPress={() => act.retry([item.path])}>
                    {LR.importInstead}
                  </ActionButton>
                </div>
              )}
            />
          </div>
        </>
      ) : null}
    </UtilityPage>
  );
}

const banner = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 'full',
  maxWidth: 760,
  marginX: 'auto',
  marginBottom: 20,
  paddingY: 12,
  paddingStart: 16,
  paddingEnd: 12,
  borderRadius: 'lg',
  boxSizing: 'border-box',
  backgroundColor: { default: 'gray-100', isResult: 'orange-100' },
});
const bannerIcon = style({
  display: 'flex',
  flexShrink: 0,
  color: { default: 'gray-700', isResult: 'orange-900' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const bannerBody = style({ flexGrow: 1, minWidth: 0 });
const bannerTitle = style({ font: 'title-sm', color: 'gray-900' });
/** 在跑时那一句只占一行；跑完的原因要读全，换行。 */
const bannerDetail = style({ font: 'ui-sm', color: 'gray-600', marginTop: 2, truncate: true });
const bannerReason = style({ font: 'ui-sm', color: 'gray-800', marginTop: 2 });
const bannerProgress = style({ marginTop: 8, maxWidth: 360 });

/** Home 顶上那一条：在跑报进度，跑完留了没导入的报结果与原因（可以关掉，新的结果会再出来）。 */
export function LegacyImportBanner() {
  const platform = useRuntime().host.platform;
  const run = useLegacyImport((s) => s.run);
  const closed = useLegacyImport((s) => s.bannerClosed);
  const closeBanner = useLegacyImport((s) => s.closeBanner);
  const go = useShell((s) => s.go);
  const b = runBanner(run, platform);
  if (!run || !b || (b.state === 'result' && closed === b.key)) return null;
  const isResult = b.state === 'result';
  return (
    <div className={banner({ isResult })} data-testid="legacy-import-banner">
      <span className={bannerIcon({ isResult })}>
        {isResult ? <AlertTriangle /> : <ProgressCircle size="S" isIndeterminate aria-label={b.title} />}
      </span>
      <div className={bannerBody}>
        <div className={bannerTitle}>{b.title}</div>
        <div className={isResult ? bannerReason : bannerDetail} title={b.detail}>
          {b.detail}
        </div>
        {b.pct !== null ? (
          <div className={bannerProgress}>
            <ProgressBar size="S" aria-label={b.title} value={b.pct} />
          </div>
        ) : null}
      </div>
      <Button variant="secondary" size="S" onPress={() => go({ tab: 'tasks', taskId: legacyTaskId(run.runId) })}>
        {isResult ? LR.viewReasons : LR.viewProgress}
      </Button>
      {isResult ? (
        <ActionButton isQuiet size="S" aria-label={LR.close} onPress={() => closeBanner(b.key)}>
          <Close />
        </ActionButton>
      ) : null}
    </div>
  );
}
