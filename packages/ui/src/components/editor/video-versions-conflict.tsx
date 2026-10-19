import { useEffect, useState } from 'react';
import type { DocumentRecord, Id, VideoSnapshotStatus } from '@baocut/protocol';
import { AlertDialog, Button, Content, DialogContainer, Heading, InlineAlert, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { create } from 'zustand';
import { fileLabel, isImportChange, resolveAsk, versionError, type ResolveKeep, type VersionError } from '../../model/video-versions.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { canEdit, useVideo, type OpenVideo } from '../../state/video-store.ts';
import { useAlive } from '../use-alive.ts';
import { useEditorActions } from './editor-context.tsx';
import { VIDEO_VERSIONS_COPY as C } from './video-versions-copy.ts';

/**
 * 快照被外部改过（视频格式规范 §9.8、版本记录设计 §4.3 与 §6；原型 video-versions.jsx）：两边都改了或快照读不出时，
 * 编辑器顶部的一条与版本记录对话框都给出保留哪边的选择（`videos.versions.resolve`），先确认、写明各自丢掉什么；
 * 只有快照被改时 Runtime 自己导入，这里认出那笔「外部变更」，说一声并给出撤销。
 * 对话框开着时结果写进对话框（toast 落在遮罩下面点不到），关着时弹 toast。
 */

const TOAST_MS = 8000;

/** 一次操作的结果说明：对话框里是一条提示，编辑器里是 toast（只用标题）。 */
export interface VersionNote {
  tone: 'positive' | 'informative';
  title: string;
  text: string;
  undo?: () => void;
}

/** 版本记录对话框开没开、第几次打开（每次打开换 key 重新读）；Runtime 导入外部改动时对话框开着就把结果交给它。 */
interface VersionsDialogStore {
  open: boolean;
  session: number;
  imported: VersionNote | null;
  show(): void;
  hide(): void;
  announce(note: VersionNote | null): void;
}

export const useVersionsDialog = create<VersionsDialogStore>()((set) => ({
  open: false,
  session: 0,
  imported: null,
  show: () => set((s) => ({ open: true, session: s.session + 1 })),
  hide: () => set({ open: false, imported: null }),
  announce: (imported) => set({ imported }),
}));

/** 自己选「用磁盘上的」产生的导入：主题事件里的那笔不再当作 Runtime 自动导入说一遍。事件可能先于结果到，选的期间一律不算。 */
let resolving = 0;
const ownImports = new Set<Id>();

/**
 * 两个选择的确认与执行。`report.done` 收结果（用磁盘上的带「撤销」），`report.refuse` 收拒绝；`onSettled` 在每次执行之后调用
 * （对话框据此重读列表）。返回的 `dialog` 要放进界面里，确认框从它弹出。
 */
export function useResolve(
  status: VideoSnapshotStatus | null,
  documents: Readonly<Record<Id, DocumentRecord>>,
  report: { done(note: VersionNote): void; refuse(error: VersionError): void },
  onSettled?: () => void,
) {
  const runtime = useRuntime();
  const { undo } = useEditorActions();
  const [asking, setAsking] = useState<ResolveKeep | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useAlive();

  const undoImport = (transaction: Id) =>
    void undo({ transaction }).then((receipt) => {
      if (!alive.current) return;
      if (receipt) report.done({ tone: 'informative', title: C.importUndoneTitle, text: C.importUndoneText });
      else if (useVersionsDialog.getState().open) {
        // 撤销失败时编辑器弹的 toast 在对话框的遮罩下面，对话框里再说一次。
        const message = useVideo.getState().video?.commandError?.message;
        if (message) report.refuse({ code: null, brokenAt: null, message });
      }
    });

  const run = async (keep: ResolveKeep) => {
    setBusy(true);
    resolving++;
    try {
      const result = await runtime.videos.resolveVersions(keep);
      if (result.receipt) ownImports.add(result.receipt.transactionId);
      if (!alive.current) return;
      if (keep === 'video') {
        report.done({ tone: 'positive', title: C.keptTitle, text: C.keptText(result.status.latestVersion ?? null) });
        return;
      }
      const transaction = result.receipt?.transactionId;
      const version = result.version ?? result.status.latestVersion ?? null;
      report.done({
        tone: 'positive',
        title: version === null ? C.importedTitle(null) : C.usedDiskTitle(version),
        text: version === null ? C.importedText : C.usedDiskText(version),
        ...(transaction ? { undo: () => undoImport(transaction) } : {}),
      });
    } catch (error) {
      if (alive.current) report.refuse(versionError(error));
    } finally {
      resolving--;
      if (alive.current) setBusy(false);
      onSettled?.();
    }
  };

  const ask = asking && status ? resolveAsk(asking, status, documents) : null;
  const dialog = (
    <DialogContainer onDismiss={() => setAsking(null)}>
      {ask && asking ? (
        <AlertDialog
          variant={ask.destructive ? 'destructive' : 'confirmation'}
          title={ask.title}
          primaryActionLabel={ask.confirm}
          cancelLabel={C.cancel}
          onPrimaryAction={() => void run(asking)}>
          {ask.body}
        </AlertDialog>
      ) : null}
    </DialogContainer>
  );
  return { ask: setAsking, busy, dialog };
}

/** 对话框里的冲突：原因、被改过的文件、两个选择（快照读不出时只能保留 BaoCut 里的）。顺序同版本记录设计 §4.3。 */
export function ConflictAlert({
  status,
  documents,
  disabled,
  onResolve,
}: {
  status: VideoSnapshotStatus;
  documents: Readonly<Record<Id, DocumentRecord>>;
  disabled: boolean;
  onResolve(keep: ResolveKeep): void;
}) {
  const invalid = status.conflict === 'invalid';
  return (
    <InlineAlert variant="negative" styles={alert}>
      <Heading>{invalid ? C.stateInvalid : C.stateConflict}</Heading>
      <Content>
        {invalid ? C.invalidIntro : C.conflictIntro}
        <Paths paths={status.changedPaths ?? []} documents={documents} />
        {invalid ? C.invalidOutro : C.conflictOutro}
        <span className={choice}>
          <Button variant="secondary" size="S" isDisabled={disabled} onPress={() => onResolve('video')}>
            {C.keepVideo}
          </Button>
          {invalid ? null : (
            <Button variant="secondary" size="S" isDisabled={disabled} onPress={() => onResolve('snapshot')}>
              {C.useSnapshot}
            </Button>
          )}
        </span>
      </Content>
    </InlineAlert>
  );
}

/** 只有快照被改、Runtime 正在导入（通常不到一秒）：列出被改过的文件，导入之后可以撤销。 */
export function ExternalAlert({ status, documents }: { status: VideoSnapshotStatus; documents: Readonly<Record<Id, DocumentRecord>> }) {
  return (
    <InlineAlert variant="informative" styles={alert}>
      <Heading>{C.stateExternal}</Heading>
      <Content>
        {C.externalIntro}
        <Paths paths={status.changedPaths ?? []} documents={documents} />
        {C.externalOutro}
      </Content>
    </InlineAlert>
  );
}

function Paths({ paths, documents }: { paths: readonly string[]; documents: Readonly<Record<Id, DocumentRecord>> }) {
  return (
    <span className={pathList}>
      {paths.map((path) => (
        <span key={path} className={pathRow}>
          <span className={mono}>{path}</span>
          <span>{fileLabel(path, documents)}</span>
        </span>
      ))}
    </span>
  );
}

const toastNote = (note: VersionNote) =>
  ToastQueue[note.tone === 'positive' ? 'positive' : 'info'](
    note.title,
    note.undo ? { timeout: TOAST_MS, actionLabel: C.undo, onAction: note.undo, shouldCloseOnAction: true } : { timeout: TOAST_MS },
  );

/**
 * 编辑器顶部那一条（版本记录设计 §6）：快照两边都改了或读不出时出现，「查看」打开版本记录，另外两个按钮直接选。
 * 结果弹 toast（只用标题，用磁盘上的带「撤销」）。
 */
export function VersionsStrip({ video }: { video: OpenVideo }) {
  const status = video.versionStatus ?? null;
  const documents = video.state?.video.documents ?? {};
  const resolve = useResolve(status, documents, {
    done: toastNote,
    refuse: (error) => ToastQueue.negative(C.refusedText(error.message.replace(/[.。]\s*$/, '')), { timeout: TOAST_MS }),
  });
  if (!video.ref?.source.projectId || status?.state !== 'conflict') return null;
  const invalid = status.conflict === 'invalid';
  const disabled = resolve.busy || !canEdit(video);
  return (
    <div className={strip} role="status">
      <AlertTriangle styles={stripIcon} />
      <span className={stripText}>{invalid ? C.stripInvalid : C.stripConflict}</span>
      <span className={stripActs}>
        <Button variant="secondary" size="S" fillStyle="outline" onPress={() => useVersionsDialog.getState().show()}>
          {C.view}
        </Button>
        <Button variant="secondary" size="S" isDisabled={disabled} onPress={() => resolve.ask('video')}>
          {C.keepVideo}
        </Button>
        {invalid ? null : (
          <Button variant="secondary" size="S" isDisabled={disabled} onPress={() => resolve.ask('snapshot')}>
            {C.useSnapshot}
          </Button>
        )}
      </span>
      {resolve.dialog}
    </div>
  );
}

/**
 * Runtime 自己导入了外部改动（主题事件里 `system:history` 的一笔，不是撤销，也不是自己刚选的「用磁盘上的」）：重读状态拿到
 * 新版本号，对话框开着时交给它，关着时弹 toast；两处都能撤销。
 */
export function useImportNotice(inProject: boolean) {
  const runtime = useRuntime();
  const { undo } = useEditorActions();
  useEffect(() => {
    if (!inProject) return;
    return useVideo.subscribe((state, prev) => {
      const change = state.video?.lastChange ?? null;
      if (change === (prev.video?.lastChange ?? null) || !isImportChange(change) || !change?.transactionId) return;
      const transaction = change.transactionId;
      if (resolving > 0 || ownImports.has(transaction)) return;
      void runtime.videos.versionStatus().then(
        (status) => {
          const version = status.latestVersion ?? null;
          const note: VersionNote = {
            tone: 'informative',
            title: C.importedTitle(version),
            text: C.importedText,
            undo: () =>
              void undo({ transaction }).then((receipt) => {
                if (!receipt) return;
                const done: VersionNote = { tone: 'informative', title: C.importUndoneTitle, text: C.importUndoneText };
                if (useVersionsDialog.getState().open) useVersionsDialog.getState().announce(done);
                else toastNote(done);
              }),
          };
          if (useVersionsDialog.getState().open) useVersionsDialog.getState().announce(note);
          else toastNote(note);
        },
        () => {},
      );
    });
  }, [runtime, undo, inProject]);
}

/* ---------- 样式（原型 video-versions.css 的 .vh-strip、.vh-choice） ---------- */

const alert = style({ flexShrink: 0, marginTop: 12, marginX: { default: 24, '@media (max-width: 720px)': 16 } });
/** 窄屏底部还有 git 状态条：文件多时列表限高、自己滚动，选择按钮与版本列表留在屏幕上。 */
const pathList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginY: 8,
  maxHeight: { default: '[none]', '@media (max-width: 720px)': '[24dvh]' },
  overflowY: { default: 'visible', '@media (max-width: 720px)': 'auto' },
});
const pathRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 });
const mono = style({ font: 'code-xs', overflowWrap: 'anywhere' });
const choice = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 });

/** 与字体那一条同一个位置与尺寸，危险色；窄时按钮折到第二行。 */
const strip = style({
  flexShrink: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 4,
  marginTop: '[10px]',
  marginX: 12,
  paddingY: '[6px]',
  paddingStart: 12,
  paddingEnd: '[6px]',
  borderRadius: 'default',
  font: 'ui-sm',
  backgroundColor: 'red-100',
  color: 'red-1000',
});
const stripIcon = iconStyle({ size: 'S', color: 'negative' });
const stripText = style({ flexGrow: 1, flexShrink: 1, flexBasis: '[200px]', minWidth: 0 });
const stripActs = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
