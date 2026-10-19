import { Fragment, useEffect, useMemo, useState } from 'react';
import type { DocumentRecord, Id, VideoSnapshotState, VideoVersion, VideoVersionList, VideoVersionText } from '@baocut/protocol';
import { ActionButton, Badge, Button, Content, Heading, InlineAlert, ProgressCircle, Text, ToastQueue } from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Cloud from '@react-spectrum/s2/icons/Cloud';
import Comment from '@react-spectrum/s2/icons/Comment';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Revert from '@react-spectrum/s2/icons/Revert';
import Settings from '@react-spectrum/s2/icons/Settings';
import User from '@react-spectrum/s2/icons/User';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatBytes } from '../../model/space.ts';
import {
  actorGroups,
  blockedText,
  changeLabel,
  fileChange,
  fileLabel,
  kindLabel,
  parseUnifiedDiff,
  predictNoop,
  rangeText,
  reach,
  versionError,
  versionFileName,
  versionTitle,
  type VersionRow,
} from '../../model/video-versions.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { VIDEO_VERSIONS_COPY as C } from './video-versions-copy.ts';

/** 版本记录对话框的右栏（原型 video-versions.jsx 的 Detail / DiffView）：选中版本的说明、能做的动作、动作清单、改了的文件与 diff。 */

const KIND_ICON = { segment: Edit, save: Bookmark, restore: Revert, external: Cloud, rebuild: Refresh } as const;
const ACTOR_ICON = { user: User, agent: AIMark, external: Cloud, system: Settings } as const;

export function VersionDetail({
  row,
  list,
  brokenAt,
  state,
  writable,
  documents,
  texts,
  onRestore,
  onDelete,
  onConversation,
}: {
  row: VersionRow;
  list: VideoVersionList;
  brokenAt: number | null;
  state: VideoSnapshotState | null;
  writable: boolean;
  documents: Readonly<Record<Id, DocumentRecord>>;
  /** 读过的版本文本（对话框开着时留着），键带上更新时间与大小：还开着的最新一版变了会重读。 */
  texts: Map<string, VideoVersionText>;
  onRestore(version: number, before: boolean): void;
  onDelete(version: number): void;
  onConversation(conversationId: Id): void;
}) {
  const conversations = useDirectory((s) => s.conversations);
  const n = row.version;

  if (row.unreadable) {
    const why = blockedText(reach(list, brokenAt, n, true)) ?? C.whyUnreadable(n);
    return (
      <div className={`${pane} bc-scroll`}>
        <div className={eyebrow}>
          <AlertTriangle styles={smallIcon} />
          {C.versionN(n)}
        </div>
        <h3 className={title}>{C.unreadableTitle}</h3>
        <InlineAlert variant="notice" styles={unreadableAlert}>
          <Heading>{C.unreadableHeading(versionFileName(n))}</Heading>
          <Content>{C.unreadableText(why)}</Content>
        </InlineAlert>
      </div>
    );
  }

  const item = row.item;
  const KindIcon = KIND_ICON[item.kind];
  // 顶上那一版结束时就是现在的状态，不给「回到这个版本」。
  const choices = (row.top ? [true] : [false, true]).map((before) => {
    const r = reach(list, brokenAt, n, before);
    return { before, reach: r, noop: r.ok && predictNoop(list, state, n, before) };
  });
  // 回不去的写原因；回得去但就是现在的状态的也先说一声（再点只提示，不提交、不出新版本，§9.5）。
  const noops = choices.filter((c) => c.noop);
  const why = [...new Set(choices.map((c) => blockedText(c.reach)).filter((t): t is string => t !== null))].concat(
    noops.length === 2 ? [C.noopBoth(n)] : noops.map((c) => (c.before ? C.noopBefore(n) : C.noopEnd(n))),
  );
  const groups = actorGroups(item.actions);

  return (
    <div className={`${pane} bc-scroll`}>
      <div className={eyebrow}>
        <KindIcon styles={smallIcon} />
        <span>
          {C.versionN(n)} · {kindLabel(item.kind)}
        </span>
        {item.open ? (
          <Badge variant="informative" size="S">
            {C.openBadge}
          </Badge>
        ) : null}
      </div>
      <h3 className={title}>{versionTitle(item)}</h3>
      {item.note ? <p className={note}>{item.note}</p> : null}
      <p className={meta}>
        {rangeText(item.startedAt, item.updatedAt)} · {C.revisions(item.fromRevision, item.toRevision)}
      </p>
      {item.open ? (
        <p className={hint}>
          {state === 'pending'
            ? C.openHintPending
            : state === 'conflict'
              ? C.openHintConflict
              : state === 'external'
                ? C.openHintExternal
                : C.openHint}
        </p>
      ) : null}
      {/* 「外部变更」版本：从哪来、回到它之前就是导入前的内容（§9.8）。 */}
      {item.kind === 'external' ? <p className={hint}>{C.externalHint}</p> : null}
      <div className={acts}>
        {choices.map((c) => (
          <Button key={String(c.before)} variant="secondary" isDisabled={!writable || !c.reach.ok} onPress={() => onRestore(n, c.before)}>
            {c.before ? null : <Revert />}
            <Text>{c.before ? C.restoreBefore : C.restoreEnd}</Text>
          </Button>
        ))}
        {item.kind === 'save' ? (
          <Button variant="secondary" fillStyle="outline" isDisabled={!writable} onPress={() => onDelete(n)}>
            <Delete />
            <Text>{C.deleteSaved}</Text>
          </Button>
        ) : null}
      </div>
      {why.map((text) => (
        <p key={text} className={whyLine}>
          <InfoCircle styles={whyIcon} />
          <span>{text}</span>
        </p>
      ))}
      <dl className={facts}>
        <dt className={factName}>{C.factActors}</dt>
        <dd className={factValue}>
          {groups.length ? (
            groups.map((g) => {
              const Icon = ACTOR_ICON[g.kind];
              return (
                <div key={g.key} className={actor}>
                  <span className={actorWho}>
                    <Icon styles={smallIcon} />
                    {g.label}
                  </span>
                  <span>{g.items}</span>
                </div>
              );
            })
          ) : (
            <span className={muted}>{item.kind === 'rebuild' ? C.noActionsRebuild : C.noActions}</span>
          )}
          {item.actionsOmitted ? <span className={muted}>{C.omitted(item.actionsOmitted)}</span> : null}
        </dd>
        {item.conversations.length ? (
          <>
            <dt className={factName}>{C.factConversations}</dt>
            <dd className={factValue}>
              {item.conversations.map((c) => {
                const here = conversations.find((known) => known.id === c.id);
                const label = here?.title || c.title;
                return here ? (
                  <ActionButton key={c.id} size="S" isQuiet aria-label={C.openConversation(label)} onPress={() => onConversation(c.id)} styles={convLink}>
                    <Comment />
                    <Text>{label}</Text>
                  </ActionButton>
                ) : (
                  <span key={c.id} className={convText}>
                    <Comment styles={smallIcon} />
                    {label}
                    <span className={muted}>{C.notHere}</span>
                  </span>
                );
              })}
            </dd>
          </>
        ) : null}
        <dt className={factName}>{C.factFiles}</dt>
        <dd className={factValue}>
          {item.files.length ? (
            item.files.map((f) => (
              <span key={f.path} className={fileRow}>
                <span>{fileLabel(f.path, documents)}</span>
                <span className={muted}>{changeLabel(fileChange(f))}</span>
              </span>
            ))
          ) : (
            <span className={muted}>{C.noFiles}</span>
          )}
        </dd>
        {item.checkpointId ? (
          <>
            <dt className={factName}>{C.factCheckpoint}</dt>
            <dd className={`${factValue} ${mono}`}>{item.checkpointId}</dd>
          </>
        ) : null}
      </dl>
      <DiffView item={item} documents={documents} texts={texts} />
    </div>
  );
}

/** 一次最多画这么多行 diff；再多的复制出去看，免得大版本拖慢对话框。 */
const MAX_LINES = 1500;

function DiffView({ item, documents, texts }: { item: VideoVersion; documents: Readonly<Record<Id, DocumentRecord>>; texts: Map<string, VideoVersionText> }) {
  const runtime = useRuntime();
  const key = `${item.version}:${item.updatedAt}:${item.bytes}`;
  const empty = item.files.length === 0;
  const [text, setText] = useState<VideoVersionText | null>(() => texts.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (empty) return;
    const cached = texts.get(key);
    if (cached) {
      setText(cached);
      return;
    }
    setText(null);
    setError(null);
    let cancelled = false;
    runtime.videos.versionText(item.version).then(
      (next) => {
        texts.set(key, next);
        if (!cancelled) setText(next);
      },
      (reason: unknown) => !cancelled && setError(versionError(reason).message),
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, texts, key, empty, item.version]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // 超过上限的行不画，只计数；文件头（名字与 +/−）照样列出。
  const shown = useMemo(() => {
    let budget = MAX_LINES;
    let hidden = 0;
    const files = (text ? parseUnifiedDiff(text.diff) : []).map((file) => ({
      file,
      hunks: file.hunks.flatMap((hunk) => {
        if (budget <= 0) {
          hidden += hunk.lines.length;
          return [];
        }
        const lines = hunk.lines.slice(0, budget);
        hidden += hunk.lines.length - lines.length;
        budget -= lines.length;
        return [{ head: hunk.head, lines }];
      }),
    }));
    return { files, hidden };
  }, [text]);
  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text.diff).then(
      () => setCopied(true),
      () => ToastQueue.negative(C.copyFailed, { timeout: 4000 }),
    );
  };

  return (
    <section className={diff} aria-label={C.diffLabel(item.version)}>
      <div className={diffBar}>
        <h4 className={sectionTitle}>{C.diffTitle}</h4>
        <span className={diffFile}>
          {versionFileName(item.version)} · {formatBytes(item.bytes)}
        </span>
        <span className={grow} />
        {shown.files.length ? (
          <ActionButton size="S" isQuiet onPress={copy}>
            {copied ? <Checkmark /> : <Copy />}
            <Text>{copied ? C.copied : C.copyDiff}</Text>
          </ActionButton>
        ) : null}
      </div>
      {empty ? (
        <p className={muted}>{C.diffEmpty}</p>
      ) : error ? (
        <InlineAlert variant="notice">
          <Content>{C.diffFailed(error)}</Content>
        </InlineAlert>
      ) : !text ? (
        <ProgressCircle size="S" isIndeterminate aria-label={C.diffLoading} />
      ) : shown.files.length === 0 ? (
        <p className={muted}>{C.diffEmpty}</p>
      ) : (
        <>
          {shown.files.map(({ file: f, hunks }) => (
            <div key={f.path} className={diffCard}>
              <div className={diffHead}>
                <strong className={diffName}>{fileLabel(f.path, documents)}</strong>
                <span className={diffPath}>{f.path}</span>
                <span className={grow} />
                <span className={diffChange}>{changeLabel(f.change)}</span>
                <span className={diffStat}>
                  <span className={statAdd}>+{f.plus}</span>
                  <span className={statDel}>−{f.minus}</span>
                </span>
              </div>
              {hunks.length ? (
                <pre className={code}>
                  {hunks.map((h, i) => (
                    <Fragment key={i}>
                      <span className={line({ sign: 'hunk' })}>{h.head}</span>
                      {h.lines.map((l, j) => (
                        <span key={j} className={line({ sign: l.sign === '+' ? 'add' : l.sign === '-' ? 'del' : 'same' })}>
                          {l.sign + l.text}
                        </span>
                      ))}
                    </Fragment>
                  ))}
                </pre>
              ) : null}
            </div>
          ))}
          {shown.hidden > 0 ? <p className={more}>{C.diffMore(shown.hidden)}</p> : null}
        </>
      )}
    </section>
  );
}

/* ---------- 样式（原型 video-versions.css 的 .vh-detail 与 .vh-diff） ---------- */

const pane = style({ minWidth: 0, minHeight: 0, overflowY: 'auto', paddingTop: 20, paddingX: { default: 24, '@media (max-width: 720px)': 16 }, paddingBottom: 24 });
const eyebrow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const smallIcon = iconStyle({ size: 'S' });
const title = style({ marginTop: 8, marginBottom: 0, fontFamily: 'sans', fontSize: '[20px]', fontWeight: 'extra-bold', lineHeight: '[1.3]', color: 'gray-900', overflowWrap: 'anywhere' });
const note = style({ marginTop: 8, marginBottom: 0, font: 'ui', lineHeight: '[1.5]', color: 'gray-800', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
const meta = style({ marginTop: 8, marginBottom: 0, font: 'ui-xs', color: 'gray-600' });
const hint = style({ marginTop: 12, marginBottom: 0, paddingY: 8, paddingX: 12, borderRadius: 'lg', backgroundColor: 'blue-100', color: 'blue-1000', font: 'ui-xs', lineHeight: '[1.5]' });
const acts = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 });
const whyLine = style({ display: 'flex', alignItems: 'start', gap: 8, marginTop: 8, marginBottom: 0, font: 'ui-xs', lineHeight: '[1.5]', color: 'gray-700' });
const whyIcon = iconStyle({ size: 'XS', color: 'neutral', marginTop: 2 });
const unreadableAlert = style({ marginTop: 16 });

const facts = style({ display: 'grid', gridTemplateColumns: '[72px minmax(0, 1fr)]', columnGap: 16, rowGap: 12, marginTop: 20, marginBottom: 0, font: 'ui' });
const factName = style({ font: 'ui-xs', lineHeight: '[20px]', color: 'gray-600' });
const factValue = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, margin: 0, minWidth: 0 });
const actor = style({ display: 'flex', alignItems: 'baseline', columnGap: 8, rowGap: 2, flexWrap: 'wrap', color: 'gray-800' });
const actorWho = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 'bold',
  color: 'gray-900',
  alignSelf: 'center',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const convLink = style({ marginStart: -8 });
const convText = style({ display: 'inline-flex', alignItems: 'center', gap: 8, '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const fileRow = style({ display: 'flex', gap: 8 });
const muted = style({ marginY: 0, font: 'ui-xs', color: 'gray-600' });
const mono = style({ font: 'code-xs', overflowWrap: 'anywhere' });

const diff = style({ marginTop: 24 });
const diffBar = style({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, minHeight: 32 });
const sectionTitle = style({ margin: 0, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const diffFile = style({ font: 'code-xs', color: 'gray-600', whiteSpace: 'nowrap' });
const grow = style({ flexGrow: 1 });
const diffCard = style({
  marginBottom: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  overflow: 'hidden',
});
const diffHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingY: 8,
  paddingX: 12,
  backgroundColor: 'gray-75',
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
});
const diffName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', whiteSpace: 'nowrap' });
const diffPath = style({ font: 'code-xs', color: 'gray-600', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const diffChange = style({ color: 'gray-700', whiteSpace: 'nowrap' });
const diffStat = style({ display: 'inline-flex', gap: 8, font: 'code-xs' });
const statAdd = style({ color: 'green-900' });
const statDel = style({ color: 'red-900' });
const code = style({ margin: 0, paddingY: 4, overflowX: 'auto', font: 'code-xs', lineHeight: '[20px]', color: 'gray-800', backgroundColor: 'gray-25', userSelect: 'text' });
const line = style<{ sign: 'add' | 'del' | 'hunk' | 'same' }>({
  display: 'block',
  width: 'max',
  minWidth: 'full',
  boxSizing: 'border-box',
  paddingX: 12,
  whiteSpace: 'pre',
  backgroundColor: { sign: { same: 'transparent', add: 'green-100', del: 'red-100', hunk: 'blue-100' } },
  color: { sign: { same: 'gray-800', add: 'green-1100', del: 'red-1100', hunk: 'blue-1000' } },
});
const more = style({ marginTop: 0, marginBottom: 0, font: 'ui-xs', color: 'gray-600' });
