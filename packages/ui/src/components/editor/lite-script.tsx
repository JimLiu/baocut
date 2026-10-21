import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DocumentRecord, HistoryEntry, Id, Revision } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ActionButton, AlertDialog, Badge, Button, DialogContainer, Text, ToastQueue, ToggleButton } from '@react-spectrum/s2';
import Compare from '@react-spectrum/s2/icons/Compare';
import Edit from '@react-spectrum/s2/icons/Edit';
import FileText from '@react-spectrum/s2/icons/FileText';
import History from '@react-spectrum/s2/icons/History';
import Revert from '@react-spectrum/s2/icons/Revert';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ListBox, ListBoxItem } from 'react-aria-components';
import {
  changeCount,
  changedSections,
  readScript,
  restoreSummary,
  scriptBlocks,
  scriptDiff,
  scriptRecord,
  scriptVersions,
  sectionFor,
  versionChange,
  type ScriptChange,
  type ScriptVersion,
} from '../../model/script-document.ts';
import { momentText } from '../../model/video-versions.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useVideoHistory } from '../thread/use-video-history.ts';
import { useEditorActions } from './editor-context.tsx';
import { LITE_COPY as L } from './lite-copy.ts';
import { PanelHead } from './panel-head.tsx';
import { ScriptMarkdown } from './script-markdown.tsx';

/**
 * 轻量视图侧栏的「脚本」页与「脚本的版本」页（轻量编辑器设计 §3「侧栏」；视频格式规范 §7.13；原型 editor-lite-script.jsx）。
 * 脚本是视频里 `kind: 'script'` 的文档，版本就是这份文档的版本；回到某一版 = 把那一版的正文写成新的一版（`summary.restoredFrom`）。
 * 规则在 model/script-document.ts。
 */

export interface ScriptSource {
  record: DocumentRecord;
  /** 旧的在前。 */
  versions: ScriptVersion[];
  /** 一版的正文：还没取到时 undefined。 */
  bodyOf(revision: Revision): unknown;
}

/** 视频里的脚本与它每一版的正文（脚本很小，每一版都取，版本列表要按改动写标题）。没有脚本时 null。 */
export function useScript(documents: Record<Id, DocumentRecord>): ScriptSource | null {
  const cache = useRuntime().videos.documents;
  const record = useMemo(() => scriptRecord(documents), [documents]);
  const versions = useMemo(() => (record ? scriptVersions(record) : []), [record]);
  const key = record ? `${record.id}:${versions.map((v) => v.revision).join(',')}` : '';
  useEffect(() => {
    if (record) for (const v of versions) cache.load(record.id, v.revision);
  }, [cache, key]);
  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache]);
  const ready = useSyncExternalStore(subscribe, () =>
    record ? versions.map((v) => (cache.peek(record.id, v.revision) === undefined ? 0 : 1)).join('') : '',
  );
  return useMemo(
    () => (record && versions.length ? { record, versions, bodyOf: (revision: Revision) => cache.peek(record.id, revision) } : null),
    // `ready`：取到一版的正文就重算。
    [cache, record, versions, ready],
  );
}

const markdownOf = (script: ScriptSource) => (revision: Revision) => readScript(script.bodyOf(revision))?.markdown ?? null;

/** 写下这一版的是谁（按事务找修改历史）；找不到或是系统写的时 null。 */
function authorOf(history: readonly HistoryEntry[] | null, version: ScriptVersion): string | null {
  const kind = history?.find((entry) => entry.transactionId === version.createdBy)?.actor.kind;
  return kind === 'user' ? L.byYou : kind === 'agent' ? L.byAgent : null;
}

const versionSub = (history: readonly HistoryEntry[] | null, version: ScriptVersion) =>
  [momentText(version.createdAt), authorOf(history, version)].filter(Boolean).join(' · ');

/* ---------- 脚本页 ---------- */

const page = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, height: 'full' });
const divider = { borderStyle: 'solid', borderWidth: 0, borderColor: 'gray-100' } as const;
const metaRow = style({
  ...divider,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingStart: 16,
  paddingEnd: 12,
  paddingY: 8,
  borderBottomWidth: 2,
});
const metaText = style({
  flexGrow: 1,
  minWidth: 0,
  font: 'ui-xs',
  color: 'gray-600',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const scroll = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 16 });
const note = style({ font: 'ui-xs', color: 'gray-600', margin: 0, paddingY: 8 });
/**
 * 一块脚本（原型 .lt-sp__blk）：小节标题上面空一行；正在播的那一小节（标题到下一个标题）左边一根蓝线；
 * 版本页按改动上底色与边线。
 */
const block = style<{ isHeading?: boolean; isIn?: boolean; isAdded?: boolean; isChanged?: boolean; isRemoved?: boolean }>({
  position: 'relative',
  marginTop: { default: 0, isHeading: 16 },
  marginBottom: { default: 0, isAdded: 4, isChanged: 4, isRemoved: 4 },
  marginX: { default: 0, isIn: '[-16px]', isAdded: '[-12px]', isChanged: '[-12px]', isRemoved: '[-12px]' },
  paddingStart: { default: 0, isIn: '[14px]', isAdded: '[10px]', isChanged: '[10px]', isRemoved: '[10px]' },
  paddingEnd: { default: 0, isIn: 16, isAdded: 12, isChanged: 12, isRemoved: 12 },
  paddingY: { default: 0, isAdded: 4, isChanged: 4, isRemoved: 4 },
  borderRadius: { default: 'none', isAdded: 'lg', isChanged: 'lg', isRemoved: 'lg' },
  font: 'body-xs',
  color: { default: 'gray-800', isRemoved: 'gray-600' },
  overflowWrap: 'anywhere',
  backgroundColor: { default: 'transparent', isAdded: 'green-100', isChanged: 'orange-100', isRemoved: 'red-100' },
  borderStyle: 'solid',
  borderWidth: 0,
  borderStartWidth: { default: 0, isIn: 2, isAdded: 2, isChanged: 2, isRemoved: 2 },
  borderColor: { default: 'transparent', isIn: 'blue-800', isAdded: 'green-700', isChanged: 'orange-700', isRemoved: 'red-700' },
});
const struck = style({ textDecoration: 'line-through' });
/** 块右上角的字（「正在播放」、改动的类别）。 */
const tag = style<{ isHere?: boolean; isAdded?: boolean; isChanged?: boolean; isRemoved?: boolean }>({
  float: 'inline-end',
  marginStart: 8,
  marginTop: 2,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: { default: 'gray-700', isHere: 'blue-900', isAdded: 'green-1000', isChanged: 'orange-1000', isRemoved: 'red-1000' },
});

/** 脚本页：头上一行是哪一版、什么时候谁写的与「脚本版本」；正文整份只读，正在播的那一段对得上的小节标出来，换段时滚到顶上。 */
export function ScriptPane({
  script,
  segment,
  onVersions,
}: {
  script: ScriptSource;
  /** 正在播的那一段：段名与它在章节表里的章节号（不是章节段时没有）。 */
  segment: { title: string; chapterId: string | null } | null;
  onVersions(): void;
}) {
  const agent = useRuntime().host.platform !== 'web';
  const history = useVideoHistory(useVideo((s) => s.video?.videoId ?? ''));
  const latest = script.versions[script.versions.length - 1]!;
  const body = script.bodyOf(latest.revision);
  const read = readScript(body);
  const blocks = useMemo(() => (read ? scriptBlocks(read.markdown) : []), [read?.markdown]);
  const at = sectionFor(blocks, segment);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hereRef = useRef<HTMLDivElement>(null);
  // 换段时把这一段的小节滚到顶上（只滚侧栏自己，不带动外面的容器）。
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const here = hereRef.current;
    if (box && here) box.scrollTop += here.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, [at, blocks]);

  const meta = [read?.file, L.versionN(latest.n), versionSub(history, latest)].filter(Boolean).join(' · ');
  let inHere = false;
  return (
    <div className={page}>
      <div className={metaRow}>
        <span className={metaText} title={meta}>
          {meta}
        </span>
        <ActionButton size="S" isQuiet onPress={onVersions}>
          <History />
          <Text>{L.scriptVersionsButton(script.versions.length)}</Text>
        </ActionButton>
      </div>
      <div ref={scrollRef} className={`${scroll} bc-scroll`}>
        {body === undefined ? (
          <p className={note}>{L.scriptLoading}</p>
        ) : !read ? (
          <p className={note}>{L.scriptUnreadable(schemaOf(body))}</p>
        ) : (
          <>
            {blocks.map((b, i) => {
              if (b.heading) inHere = i === at;
              return (
                <div
                  key={i}
                  ref={i === at ? hereRef : undefined}
                  className={block({ isHeading: !!b.heading && i > 0, isIn: inHere })}
                  aria-current={i === at ? 'location' : undefined}
                >
                  {i === at ? <span className={tag({ isHere: true })}>{L.playing}</span> : null}
                  <ScriptMarkdown text={b.text} />
                </div>
              );
            })}
            <p className={note}>{agent ? L.scriptHintAgent : L.scriptHint}</p>
          </>
        )}
      </div>
    </div>
  );
}

function schemaOf(body: unknown): string {
  return typeof body === 'object' && body !== null && typeof (body as { schema?: unknown }).schema === 'string'
    ? (body as { schema: string }).schema
    : '?';
}

/* ---------- 脚本的版本 ---------- */

const listBox = style({ ...divider, flexShrink: 0, maxHeight: '[40%]', overflowY: 'auto', padding: 8, borderBottomWidth: 2 });
const rowBox = style<{ isHovered: boolean; isSelected: boolean; isFocusVisible: boolean }>({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 2,
  padding: 8,
  borderRadius: 'lg',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isSelected: 'blue-100' },
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
});
const rowIcon = iconStyle({ size: 'M', color: 'gray' });
const rowBody = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const rowTitle = style({ font: 'ui', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const rowSub = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const noShrink = style({ flexShrink: 0 });
const bar = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingX: 12, paddingY: 8 });
const grow = style({ flexGrow: 1 });
const why = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600', margin: 0, paddingX: 12, paddingBottom: 8 });
const versionPage = style({
  ...divider,
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingX: 16,
  paddingTop: 8,
  paddingBottom: 16,
  borderTopWidth: 2,
});
const count = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });

const KIND_ICON = { create: FileText, edit: Edit, restore: Revert } as const;
const CHANGE_TAG: Record<Exclude<ScriptChange['status'], 'same'>, () => string> = {
  added: () => L.changeAdded,
  changed: () => L.changeChanged,
  removed: () => L.changeRemoved,
};

/** 版本页：上面是版本列表（新的在前），选一版，下面是那一版的正文，可以标出与前一版比改了哪几块；「回到这个版本」把那一版的正文写成新的一版。 */
export function ScriptVersionsPage({ script, onBack }: { script: ScriptSource; onBack(): void }) {
  const { apply } = useEditorActions();
  const agent = useRuntime().host.platform !== 'web';
  const editable = useVideo((s) => canEdit(s.video));
  const history = useVideoHistory(useVideo((s) => s.video?.videoId ?? ''));
  const { versions } = script;
  const latest = versions[versions.length - 1]!;
  // 选中的版本按文档版本记：回到版本加出新的一版以后选中的还是那一版。没选时是最新的一版。
  const [picked, setPicked] = useState<Revision | null>(null);
  const [marks, setMarks] = useState(true);
  const [asking, setAsking] = useState(false);
  const index = Math.max(0, picked === null ? versions.length - 1 : versions.findIndex((v) => v.revision === picked));
  const selected = versions[index]!;
  const of = markdownOf(script);
  const rows = useMemo(
    () =>
      versions
        .map((version, i) => {
          const change = versionChange(versions, i, of);
          const sections = change.changes ? changedSections(change.changes) : [];
          const title =
            change.kind === 'create'
              ? L.versionCreated
              : change.kind === 'restore'
                ? L.versionRestored(change.from ?? 0)
                : !change.changes
                  ? L.versionN(version.n)
                  : sections.length
                    ? L.versionChanged(
                        sections.slice(0, 2).map((s) => s ?? L.sectionStart),
                        sections.length,
                      )
                    : L.versionUnchanged;
          return {
            id: version.revision,
            version,
            kind: change.kind,
            title,
            sub: `${L.versionN(version.n)} · ${versionSub(history, version)}`,
          };
        })
        .reverse(),
    // `of` 跟着 `script` 变（取到一版的正文 `script` 就是新的一份）。
    [versions, script, history],
  );

  const markdown = of(selected.revision);
  const first = index === 0;
  const changes = useMemo(
    () => (markdown === null ? null : scriptDiff(first ? null : of(versions[index - 1]!.revision), markdown)),
    [markdown, first, script, index],
  );
  const showMarks = marks && !first;
  const items = !changes ? [] : showMarks ? changes : changes.filter((x) => x.status !== 'removed');
  const isLatest = selected === latest;
  const same = !isLatest && markdown !== null && markdown === of(latest.revision);
  const body = script.bodyOf(selected.revision);
  const canRestore = editable && !isLatest && !same && body !== undefined && readScript(body) !== null;
  const reason = isLatest ? L.whyLatest : same ? L.whyNoop(selected.n) : null;

  const restore = async () => {
    setAsking(false);
    const receipt = await apply(
      [{ type: 'putDocument', documentId: script.record.id, kind: script.record.kind, body, summary: restoreSummary(selected.revision) }],
      EditLabel.restoreScript({ version: selected.n }),
    );
    if (!receipt) return;
    setPicked(null);
    ToastQueue.positive(L.restored(selected.n, latest.n + 1), { timeout: 5000 });
  };

  return (
    <div className={page}>
      <PanelHead title={L.scriptVersions} back={{ label: L.backTo(L.script), onPress: onBack }}>
        <span className={count}>{L.versionCount(versions.length)}</span>
      </PanelHead>
      <div className={`${listBox} bc-scroll`}>
        <ListBox
          aria-label={L.scriptVersions}
          items={rows}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[selected.revision]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return;
            const key = [...keys][0];
            if (key !== undefined) setPicked(String(key));
          }}
        >
          {(row) => {
            const Icon = KIND_ICON[row.kind];
            return (
              <ListBoxItem id={row.id} textValue={`${L.versionN(row.version.n)} ${row.title}`} className={(rp) => rowBox(rp)}>
                <Icon styles={rowIcon} />
                <span className={rowBody}>
                  <span className={rowTitle}>{row.title}</span>
                  <span className={rowSub}>{row.sub}</span>
                </span>
                {row.version === latest ? (
                  <Badge variant="informative" size="S" styles={noShrink}>
                    {L.current}
                  </Badge>
                ) : null}
              </ListBoxItem>
            );
          }}
        </ListBox>
      </div>
      <div className={bar}>
        <ToggleButton size="S" isSelected={showMarks} isDisabled={first || !changes} onChange={setMarks}>
          <Compare />
          <Text>{first ? L.firstVersion : L.showChanges(changes ? changeCount(changes) : 0)}</Text>
        </ToggleButton>
        <span className={grow} />
        <Button variant="secondary" size="S" isDisabled={!canRestore} onPress={() => setAsking(true)}>
          <Revert />
          <Text>{L.restore}</Text>
        </Button>
      </div>
      {reason ? <p className={why}>{reason}</p> : null}
      <article className={`${versionPage} bc-scroll`} aria-label={`${L.script} · ${L.versionN(selected.n)}`}>
        {body === undefined ? (
          <p className={note}>{L.versionLoading}</p>
        ) : markdown === null ? (
          <p className={note}>{L.scriptUnreadable(schemaOf(body))}</p>
        ) : (
          items.map((x, i) => {
            const mark = showMarks && x.status !== 'same' ? x.status : null;
            const flags = { isAdded: mark === 'added', isChanged: mark === 'changed', isRemoved: mark === 'removed' };
            return (
              <div key={`${i}:${x.status}`} className={block({ isHeading: !!x.heading && i > 0, ...flags })}>
                {mark ? <span className={tag(flags)}>{CHANGE_TAG[mark]()}</span> : null}
                <div className={mark === 'removed' ? struck : undefined}>
                  <ScriptMarkdown text={x.text} />
                </div>
              </div>
            );
          })
        )}
      </article>
      <DialogContainer onDismiss={() => setAsking(false)}>
        {asking ? (
          <AlertDialog
            variant="confirmation"
            title={L.restoreTitle(selected.n)}
            primaryActionLabel={L.restore}
            cancelLabel={L.cancel}
            onPrimaryAction={() => void restore()}
          >
            {L.restoreBody(selected.n, momentText(selected.createdAt)) + (agent ? L.restoreBodyAgent : '')}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}
