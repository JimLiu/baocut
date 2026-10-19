import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { VideoSnapshotStatus, VideoVersionList, VideoVersionText } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  Content,
  CustomDialog,
  DialogContainer,
  DialogTrigger,
  Heading,
  IllustratedMessage,
  InlineAlert,
  NotificationBadge,
  Popover,
  ProgressCircle,
  StatusLight,
  Text,
  TextArea,
  TextField,
  Tooltip,
  TooltipTrigger,
  type CustomDialogProps,
} from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Close from '@react-spectrum/s2/icons/Close';
import Cloud from '@react-spectrum/s2/icons/Cloud';
import Edit from '@react-spectrum/s2/icons/Edit';
import History from '@react-spectrum/s2/icons/History';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Revert from '@react-spectrum/s2/icons/Revert';
import Undo from '@react-spectrum/s2/icons/Undo';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ListBox, ListBoxItem } from 'react-aria-components';
import { agoLabel } from '../../model/format.ts';
import {
  actorsText,
  buttonTip,
  fileLabel,
  momentText,
  snapshotState,
  versionError,
  versionRows,
  versionTitle,
  type VersionError,
  type VersionRow,
} from '../../model/video-versions.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { canEdit, useVideo, type OpenVideo } from '../../state/video-store.ts';
import { useNow } from '../use-now.ts';
import { useEditorActions } from './editor-context.tsx';
import { VersionDetail } from './video-versions-detail.tsx';
import { VIDEO_VERSIONS_COPY as C } from './video-versions-copy.ts';

/**
 * 视频的版本记录（视频格式规范 §9、版本记录设计 §6；原型 video-versions.jsx / video-versions.css）：视频栏右侧的入口按钮，
 * 和它打开的对话框——左边是这部视频的版本（新的在前），右边是选中版本的详情、动作与 diff（video-versions-detail.tsx）。
 * 规则与显示名在 model/video-versions.ts。版本变化没有推送：入口在修订号变了之后、快照该写下的时候再问一次状态，
 * 对话框打开时读一次，每次操作后再读，快照正在写入时每隔几秒读一次。
 */

/** 快照在最后一笔修改 10 秒后写下（§9.3）；多等一会儿再问，读到的是写完之后的状态。 */
const STATUS_DELAY = 11_500;
const PENDING_POLL = 3_000;

export function VersionsButton({ video }: { video: OpenVideo }) {
  const runtime = useRuntime();
  const inProject = Boolean(video.ref?.source.projectId);
  const revision = video.state?.video.revision ?? null;
  const [status, setStatus] = useState<VideoSnapshotStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!inProject || revision === null || !video.videoId) return;
    // 打开视频时马上问一次；之后修订号每变一次，等快照写下再问（连续修改只问最后一次）。
    const immediate = seen.current !== video.videoId;
    seen.current = video.videoId;
    let cancelled = false;
    const timer = window.setTimeout(
      () =>
        runtime.videos.versionStatus().then(
          (next) => !cancelled && setStatus(next),
          () => {},
        ),
      immediate ? 0 : STATUS_DELAY,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runtime, inProject, revision, video.videoId]);

  const tip = buttonTip(inProject, inProject ? status : null);
  const show = () => {
    setSession((n) => n + 1);
    setOpen(true);
  };
  return (
    <>
      <TooltipTrigger>
        <ActionButton isQuiet aria-label={tip} onPress={show}>
          <History />
          {inProject && status?.state === 'conflict' ? <NotificationBadge /> : null}
        </ActionButton>
        <Tooltip>{tip}</Tooltip>
      </TooltipTrigger>
      {/* DialogContainer 关闭后仍留着上一个子元素（为了退场动画）；按打开次数换 key，每次打开重新读。 */}
      <DialogContainer onDismiss={() => setOpen(false)}>
        {open ? <VideoVersionsDialog key={session} video={video} initialStatus={status} onStatus={setStatus} onClose={() => setOpen(false)} /> : null}
      </DialogContainer>
    </>
  );
}

/* ---------- 保存版本（按钮下的小表单） ---------- */

function SaveVersion({ disabled, onSave }: { disabled: boolean; onSave(name: string, note: string): void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const missing = !name.trim();
  const reset = () => {
    setName('');
    setNote('');
    setTouched(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (missing) return;
    onSave(name.trim(), note.trim());
    setOpen(false);
    reset();
  };
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}>
      <Button variant="secondary" isDisabled={disabled} styles={noShrink}>
        <Bookmark />
        <Text>{C.save}</Text>
      </Button>
      <Popover placement="bottom end" padding="none" aria-label={C.save}>
        <form className={saveForm} onSubmit={submit}>
          <h3 className={saveTitle}>{C.save}</h3>
          <p className={saveIntro}>{C.saveIntro}</p>
          <TextField
            label={C.nameLabel}
            value={name}
            autoFocus
            maxLength={200}
            placeholder={C.namePlaceholder}
            onChange={(value) => {
              setName(value);
              setTouched(true);
            }}
            isInvalid={touched && missing}
            errorMessage={C.nameRequired}
          />
          <TextArea label={C.noteLabel} value={note} maxLength={2000} onChange={setNote} />
          <div className={saveActs}>
            <Button variant="secondary" onPress={() => setOpen(false)}>
              {C.cancel}
            </Button>
            <Button variant="accent" type="submit">
              {C.saveSubmit}
            </Button>
          </div>
        </form>
      </Popover>
    </DialogTrigger>
  );
}

/* ---------- 对话框 ---------- */

/** 最近一次成功操作的结果。对话框是模态的，toast 落在遮罩下面点不到，所以结果（和「撤销」）写在对话框里。 */
interface Done {
  tone: 'positive' | 'informative';
  title: string;
  text: string;
  undo?: () => void;
}

type Ask = { kind: 'restore'; version: number; before: boolean; when: string } | { kind: 'delete'; version: number; name: string; next: number | null };

function VideoVersionsDialog({
  video,
  initialStatus,
  onStatus,
  onClose,
}: {
  video: OpenVideo;
  initialStatus: VideoSnapshotStatus | null;
  onStatus(status: VideoSnapshotStatus): void;
  onClose(): void;
}) {
  const runtime = useRuntime();
  const { undo } = useEditorActions();
  const titleId = useId();
  const now = useNow(30_000);
  const keep = useSetting('versions.keep') ?? 10;
  const documents = useVideo((s) => s.video?.state?.video.documents);
  const inProject = Boolean(video.ref?.source.projectId);
  const editable = canEdit(video);
  const revision = video.state?.video.revision ?? null;
  const name = video.state?.video.name ?? video.ref?.name ?? '';

  const [list, setList] = useState<VideoVersionList | null>(null);
  const [status, setStatus] = useState<VideoSnapshotStatus | null>(initialStatus);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /** 上次回到版本时引擎报出的断点（`VERSION_CHAIN_BROKEN`）：比它旧的状态都回不去。 */
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
  /** 最近一次被拒绝的写操作。视频不变，提示留到下一次成功的操作。 */
  const [refused, setRefused] = useState<VersionError | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const texts = useRef(new Map<string, VideoVersionText>());
  const alive = useRef(true);
  const reads = useRef(0);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const refresh = useCallback(async () => {
    const read = ++reads.current;
    try {
      const [nextList, nextStatus] = await Promise.all([runtime.videos.versionList(), runtime.videos.versionStatus()]);
      // 只认最后一次读：先发的读晚回来时不盖掉新的。
      if (!alive.current || read !== reads.current) return;
      setList(nextList);
      setStatus(nextStatus);
      setLoadError(null);
      onStatus(nextStatus);
    } catch (error) {
      if (alive.current && read === reads.current) setLoadError(versionError(error).message);
    }
  }, [runtime, onStatus]);

  // 打开时读；修订号变了（比如智能体在改）稍后再读，读到「正在写入」。
  useEffect(() => {
    if (!inProject) return;
    const timer = window.setTimeout(() => void refresh(), list === null ? 0 : 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只按修订号重读，list 只用来区分第一次
  }, [inProject, revision, refresh]);

  // 快照正在写入：几秒后再读，直到写完。
  useEffect(() => {
    if (status?.state !== 'pending') return;
    const timer = window.setTimeout(() => void refresh(), PENDING_POLL);
    return () => window.clearTimeout(timer);
  }, [status, refresh]);

  const rows = useMemo(() => (list ? versionRows(list, brokenAt) : []), [list, brokenAt]);
  const current = rows.find((r) => r.version === selected) ?? rows[0] ?? null;
  const state = status ? snapshotState(status.state) : null;
  const writable = inProject && editable && status?.state !== 'conflict' && !busy;

  const succeed = (next: Done) => {
    setRefused(null);
    setDone(next);
  };
  const fail = (error: VersionError) => {
    setDone(null);
    setRefused(error);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      const reason = versionError(error);
      if (reason.brokenAt !== null) setBrokenAt(reason.brokenAt);
      if (alive.current) fail(reason);
    } finally {
      if (alive.current) setBusy(false);
      await refresh();
    }
  };

  const save = (versionName: string, note: string) =>
    void run(async () => {
      const { version } = await runtime.videos.saveVersion(versionName, note || undefined);
      setSelected(version);
      succeed({ tone: 'positive', title: C.savedTitle(version, versionName), text: C.savedText });
    });

  const restore = (version: number, before: boolean) =>
    void run(async () => {
      setSelected(version);
      const result = await runtime.videos.restoreVersion(version, before);
      if (!result.receipt || result.version === null) {
        succeed({ tone: 'informative', title: C.noopTitle, text: C.noopText(version, before) });
        return;
      }
      const transaction = result.receipt.transactionId;
      setSelected(result.version);
      succeed({
        tone: 'positive',
        title: C.restoredTitle(version, before, result.version),
        text: C.restoredText,
        undo: () =>
          void run(async () => {
            const receipt = await undo({ transaction });
            if (receipt) succeed({ tone: 'informative', title: C.undoneTitle(version, before), text: C.undoneText });
            else {
              // 撤销失败时编辑器的 toast 在遮罩下面看不到，这里再说一次。
              const message = useVideo.getState().video?.commandError?.message;
              if (message) fail({ code: null, brokenAt: null, message });
            }
          }),
      });
    });

  const remove = (version: number, versionName: string) =>
    void run(async () => {
      await runtime.videos.deleteVersion(version);
      succeed({ tone: 'informative', title: C.deletedTitle(versionName), text: C.deletedText });
    });

  const askRestore = (version: number, before: boolean) => {
    const item = list?.versions.find((v) => v.version === version);
    if (!item) return;
    setAsk({ kind: 'restore', version, before, when: momentText(before ? item.startedAt : item.updatedAt) });
  };
  const askDelete = (version: number) => {
    const item = list?.versions.find((v) => v.version === version);
    if (!item) return;
    // 紧接着的更新的版本（列表新的在前）：被删的保存版本的修改并进它；没有就是最新的一版。
    const newer = rows.filter((r) => r.version > version).at(-1)?.version ?? null;
    setAsk({ kind: 'delete', version, name: item.name ?? versionTitle(item), next: newer });
  };
  const openConversation = (conversationId: string) => {
    onClose();
    useShell.getState().go({ tab: 'home', conversationId, projectId: null });
  };

  const body = !inProject ? (
    <div className={emptyBox}>
      <IllustratedMessage>
        <Heading>{C.outsideTitle}</Heading>
        <Content>{C.outsideText}</Content>
      </IllustratedMessage>
    </div>
  ) : (
    <>
      {status?.state === 'conflict' ? (
        <InlineAlert variant="negative" styles={alert}>
          <Heading>{C.conflictTitle}</Heading>
          <Content>
            {C.conflictIntro}
            <span className={paths}>
              {(status.changedPaths ?? []).map((path) => (
                <span key={path} className={pathRow}>
                  <span className={mono}>{path}</span>
                  <span>{fileLabel(path, documents ?? {})}</span>
                </span>
              ))}
            </span>
            {C.conflictOutro}
          </Content>
        </InlineAlert>
      ) : null}
      {refused ? (
        <InlineAlert variant={refused.code === 'VERSION_CHAIN_BROKEN' ? 'negative' : 'notice'} styles={alert}>
          <Heading>{refused.code === 'VERSION_CHAIN_BROKEN' ? C.refusedBroken : C.refusedOther}</Heading>
          <Content>{C.refusedText(refused.message.replace(/[.。]\s*$/, ''))}</Content>
        </InlineAlert>
      ) : null}
      {done ? (
        <InlineAlert variant={done.tone} styles={alert}>
          <Heading>{done.title}</Heading>
          <Content>
            <span className={doneRow}>
              <span>{done.text}</span>
              {done.undo ? (
                <Button variant="secondary" size="S" isDisabled={busy || !editable} onPress={done.undo}>
                  <Undo />
                  <Text>{C.undo}</Text>
                </Button>
              ) : null}
            </span>
          </Content>
        </InlineAlert>
      ) : null}
      {list === null ? (
        <div className={emptyBox}>
          {loadError ? (
            <InlineAlert variant="negative">
              <Content>{C.loadFailed(loadError)}</Content>
            </InlineAlert>
          ) : (
            <ProgressCircle isIndeterminate aria-label={C.loading} />
          )}
        </div>
      ) : current ? (
        <div className={layout}>
          <nav className={`${listPane} bc-scroll`} aria-label={C.listLabel}>
            <ListBox
              aria-label={C.listLabel}
              items={rows.map((row) => ({ ...row, id: row.version }))}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[current.version]}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const key = [...keys][0];
                if (key !== undefined) setSelected(Number(key));
              }}>
              {(row) => <VersionListItem row={row} now={now} />}
            </ListBox>
          </nav>
          <VersionDetail
            key={current.version}
            row={current}
            list={list}
            brokenAt={brokenAt}
            state={status?.state ?? null}
            writable={writable}
            documents={documents ?? {}}
            texts={texts.current}
            onRestore={askRestore}
            onDelete={askDelete}
            onConversation={openConversation}
          />
        </div>
      ) : (
        <div className={emptyBox}>
          <IllustratedMessage>
            <Heading>{C.emptyTitle}</Heading>
            <Content>{C.emptyText(status?.state === 'missing')}</Content>
          </IllustratedMessage>
        </div>
      )}
    </>
  );

  return (
    // S2 的 Modal 有 XL（960px，Dialog 的 XL 同宽），CustomDialog 的类型没列出来；原型同样用 XL。
    <CustomDialog size={'XL' as CustomDialogProps['size']} padding="none" isDismissible aria-labelledby={titleId}>
      <div className={`${shell} bc-no-drag`}>
        <header className={head}>
          <span className={mark}>
            <History />
          </span>
          <div className={headText}>
            <h2 id={titleId} className={headTitle}>
              {C.title}
            </h2>
            <span className={headVideo}>{name}</span>
          </div>
          {inProject && state ? (
            <span className={headState}>
              <StatusLight variant={state.tone} size="S">
                {state.label}
              </StatusLight>
            </span>
          ) : null}
          <span className={grow} />
          {inProject ? <SaveVersion disabled={!writable || list === null} onSave={save} /> : null}
          <TooltipTrigger>
            <ActionButton isQuiet aria-label={C.close} onPress={onClose}>
              <Close />
            </ActionButton>
            <Tooltip>{C.close}</Tooltip>
          </TooltipTrigger>
        </header>
        {body}
        {inProject ? (
          <footer className={foot}>
            {state ? <span>{state.desc}</span> : null}
            <span>{C.footer(keep)}</span>
          </footer>
        ) : null}
      </div>
      <DialogContainer onDismiss={() => setAsk(null)}>
        {ask?.kind === 'restore' ? (
          <AlertDialog
            variant="confirmation"
            title={C.confirmRestoreTitle(ask.version, ask.before)}
            primaryActionLabel={ask.before ? C.restoreBefore : C.restoreEnd}
            cancelLabel={C.cancel}
            onPrimaryAction={() => restore(ask.version, ask.before)}>
            {C.confirmRestoreBody(ask.version, ask.before, ask.when)}
          </AlertDialog>
        ) : ask?.kind === 'delete' ? (
          <AlertDialog
            variant="destructive"
            title={C.confirmDeleteTitle(ask.name)}
            primaryActionLabel={C.delete}
            cancelLabel={C.cancel}
            onPrimaryAction={() => remove(ask.version, ask.name)}>
            {ask.next === null ? C.confirmDeleteTop : C.confirmDeleteMiddle(ask.next)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </CustomDialog>
  );
}

const KIND_ICON = { segment: Edit, save: Bookmark, restore: Revert, external: Cloud, rebuild: Refresh } as const;

function VersionListItem({ row, now }: { row: VersionRow & { id: number }; now: number }) {
  if (row.unreadable) {
    return (
      <ListBoxItem id={row.id} textValue={`${C.versionN(row.version)} ${C.unreadableTitle}`} className={(rp) => rowBox({ ...rp, isBlocked: true })}>
        <AlertTriangle styles={rowIconNotice} />
        <span className={rowBody}>
          <span className={rowTitle({ isBlocked: true })}>{C.unreadableTitle}</span>
          <span className={rowSub}>{C.versionN(row.version)}</span>
        </span>
      </ListBoxItem>
    );
  }
  const { item, blocked } = row;
  const Icon = KIND_ICON[item.kind];
  const title = versionTitle(item);
  const sub = [C.versionN(row.version), agoLabel(item.updatedAt, now), actorsText(item)].filter(Boolean).join(' · ');
  const isSave = item.kind === 'save';
  return (
    <ListBoxItem id={row.id} textValue={`${C.versionN(row.version)} ${title}`} className={(rp) => rowBox({ ...rp, isBlocked: blocked })}>
      <Icon styles={isSave && !blocked ? rowIconSave : rowIcon} />
      <span className={rowBody}>
        <span className={rowTitle({ isSave, isBlocked: blocked })}>{title}</span>
        <span className={rowSub}>{sub}</span>
      </span>
      {item.open ? (
        <Badge variant="informative" size="S" styles={noShrink}>
          {C.openBadge}
        </Badge>
      ) : blocked ? (
        <span className={rowFlag}>{C.blockedFlag}</span>
      ) : null}
    </ListBoxItem>
  );
}

/* ---------- 样式（原型 video-versions.css） ---------- */

const NARROW = '@media (max-width: 720px)';

/** 高度跟 S2 弹层的 max-height 90% 对齐，矮窗口里不出外层滚动条。 */
const shell = style({
  display: 'flex',
  flexDirection: 'column',
  width: 'full',
  height: '[min(720px, 90dvh)]',
  minHeight: 0,
  backgroundColor: 'gray-25',
  color: 'gray-800',
});
const head = style({
  display: 'flex',
  flexWrap: { default: 'nowrap', [NARROW]: 'wrap' },
  alignItems: 'center',
  columnGap: 12,
  rowGap: 4,
  flexShrink: 0,
  paddingY: 16,
  paddingStart: { default: 24, [NARROW]: 16 },
  paddingEnd: 16,
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const mark = style({
  display: { default: 'grid', [NARROW]: 'none' },
  placeItems: 'center',
  flexShrink: 0,
  size: 32,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  color: 'gray-800',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const headText = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: { default: 0, [NARROW]: 1 } });
const headTitle = style({ margin: 0, fontFamily: 'sans', fontSize: 'ui-lg', fontWeight: 'extra-bold', color: 'gray-900' });
const headVideo = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 窄屏：快照状态换到第二行，标题、保存、关闭留在第一行。 */
const headState = style({ flexShrink: 0, whiteSpace: 'nowrap', order: { default: 0, [NARROW]: 1 }, flexBasis: { default: 'auto', [NARROW]: 'full' } });
const grow = style({ flexGrow: 1, display: { default: 'block', [NARROW]: 'none' } });
const noShrink = style({ flexShrink: 0 });

const alert = style({ flexShrink: 0, marginTop: 12, marginX: { default: 24, [NARROW]: 16 } });
const paths = style({ display: 'flex', flexDirection: 'column', gap: 2, marginY: 8 });
const pathRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 });
const mono = style({ font: 'code-xs', overflowWrap: 'anywhere' });
const doneRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' });

const layout = style({
  display: 'grid',
  flexGrow: 1,
  minHeight: 0,
  gridTemplateColumns: { default: '[minmax(260px, 320px) minmax(0, 1fr)]', [NARROW]: '[minmax(0, 1fr)]' },
  gridTemplateRows: { default: '[minmax(0, 1fr)]', [NARROW]: '[minmax(160px, 38%) minmax(0, 1fr)]' },
});
const listPane = style({
  minHeight: 0,
  overflowY: 'auto',
  padding: 8,
  backgroundColor: 'gray-75',
  borderWidth: 0,
  borderEndWidth: { default: 1, [NARROW]: 0 },
  borderBottomWidth: { default: 0, [NARROW]: 1 },
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const rowBox = style<{ isHovered: boolean; isSelected: boolean; isFocusVisible: boolean; isBlocked: boolean }>({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 2,
  paddingY: 8,
  paddingX: 12,
  borderRadius: 'lg',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isSelected: 'blue-100' },
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
});
/** 保存的版本图标用强调色，读不出的用提醒色。 */
const rowIcon = iconStyle({ size: 'M', color: 'gray' });
const rowIconSave = iconStyle({ size: 'M', color: 'accent' });
const rowIconNotice = iconStyle({ size: 'M', color: 'notice' });
const rowBody = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const rowTitle = style<{ isSave?: boolean; isBlocked?: boolean }>({
  font: 'ui',
  fontWeight: { default: 'normal', isSave: 'bold' },
  color: { default: 'gray-900', isBlocked: 'gray-600' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const rowSub = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const rowFlag = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });

const emptyBox = style({ display: 'grid', placeItems: 'center', flexGrow: 1, minHeight: 240, padding: 24, textAlign: 'center' });
const foot = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flexShrink: 0,
  paddingY: 12,
  paddingX: { default: 24, [NARROW]: 16 },
  borderWidth: 0,
  borderTopWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
  color: 'gray-600',
});

const saveForm = style({ display: 'flex', flexDirection: 'column', gap: 12, width: 340, maxWidth: 'full', boxSizing: 'border-box', padding: 16 });
const saveTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const saveIntro = style({ margin: 0, font: 'ui-xs', lineHeight: '[1.5]', color: 'gray-700' });
const saveActs = style({ display: 'flex', justifyContent: 'end', gap: 8 });
