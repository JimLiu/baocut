import { useRef, useState, type ReactNode } from 'react';
import { FileTrigger } from 'react-aria-components';
import { ActionButton, AlertDialog, DialogContainer, Text } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { addedFilePath, draftChanges, EMPTY_DRAFT, type FileDraft } from '../../model/skills-page.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import type { FileEditing } from './skill-files.tsx';
import { DETAIL_COPY, FILES_COPY } from './skills-copy.ts';

/** Skill 详情与项目品牌页共用的部件（原型 page-skills.css 的 `skp-head`、`skp-overview`、`skp-block`、`skp-info`）。 */

const backRow = style({ marginBottom: 8, marginStart: -8 });
const headRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 0, marginBottom: 16 });
const headIcon = style({
  display: 'inline-flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  size: 48,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  color: 'gray-800',
});
const headText = style({ display: 'flex', flexGrow: 1, flexDirection: 'column', gap: '[6px]', minWidth: 0, flexBasis: 240 });
const headTitle = style({ margin: 0, font: 'heading', color: 'gray-900', overflowWrap: 'anywhere' });
const headMeta = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, font: 'ui-xs', color: 'gray-600' });
const headActs = style({ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 });

export const overview = style({
  display: 'grid',
  gridTemplateColumns: { default: ['minmax(0, 1fr)', '[280px]'], '@container (max-width: 900px)': ['minmax(0, 1fr)'] },
  gap: 32,
  paddingTop: 20,
});
export const overviewMain = style({ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 });
export const overviewSide = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 16, minWidth: 0 });
export const lead = style({ margin: 0, font: 'body', color: 'gray-900', overflowWrap: 'anywhere' });
export const stateLine = style({ marginTop: -12, marginBottom: 0, font: 'ui-xs', color: 'gray-700' });
export const filesTab = style({ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 });
export const fileBar = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
export const fileBarLabel = style({ font: 'ui-xs', color: 'gray-600' });
export const grow = style({ flexGrow: 1 });
export const saveBar = style({
  position: 'sticky',
  bottom: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  paddingY: 12,
  backgroundColor: 'layer-1',
});
export const saveNote = style({ flexGrow: 1, minWidth: 160 });
export const quiet = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });

const block = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const blockTitle = style({ display: 'flex', alignItems: 'baseline', gap: 8, margin: 0, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const blockAside = style({ font: 'ui-xs', fontWeight: 'normal', color: 'gray-600' });
const blockHint = style({ margin: 0, font: 'ui-xs', color: 'gray-700' });
const info = style({ display: 'grid', gridTemplateColumns: ['auto', 'minmax(0, 1fr)'], columnGap: 16, rowGap: 8, margin: 0, font: 'ui-xs' });
const infoKey = style({ color: 'gray-600' });
const infoValue = style({ margin: 0, color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });

/** 页顶的「← Skills」。 */
export function BackToSkills() {
  const go = useShell((s) => s.go);
  return (
    <div className={backRow}>
      <ActionButton isQuiet size="S" onPress={() => go({ tab: 'skills' })}>
        <ChevronLeft />
        <Text>{DETAIL_COPY.back}</Text>
      </ActionButton>
    </div>
  );
}

export function PageHead({ icon, title, meta, actions }: { icon: ReactNode; title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={headRow}>
      <span className={headIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={headText}>
        <h1 className={headTitle}>{title}</h1>
        {meta ? <span className={headMeta}>{meta}</span> : null}
      </div>
      {actions ? <span className={headActs}>{actions}</span> : null}
    </header>
  );
}

export function Block({ title, aside, hint, children }: { title: string; aside?: string; hint?: string; children?: ReactNode }) {
  return (
    <section className={block} aria-label={title}>
      <h3 className={blockTitle}>
        {title}
        {aside ? <span className={blockAside}>{aside}</span> : null}
      </h3>
      {hint ? <p className={blockHint}>{hint}</p> : null}
      {children}
    </section>
  );
}

export function InfoList({ rows }: { rows: readonly (readonly [string, string] | null | false)[] }) {
  return (
    <dl className={info} aria-label={DETAIL_COPY.info}>
      {rows.filter((r): r is readonly [string, string] => !!r).map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt className={infoKey}>{key}</dt>
          <dd className={infoValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 编辑中的改动（文件页签的「编辑」）：改过的文本、从本机加进来的文件、删掉的文件；`originals` 记下改之前读到的原文，
 * 存的时候只交改过的。
 */
export function useFileDraft() {
  const [draft, setDraft] = useState<FileDraft | null>(null);
  const originals = useRef<Record<string, string>>({});
  const changes = draft ? draftChanges(draft, originals.current) : [];
  const editing: FileEditing | null = draft
    ? {
        texts: draft.texts,
        added: draft.added,
        onText: (path, text, original) => {
          if (!(path in originals.current)) originals.current[path] = original;
          setDraft((d) => (d ? { ...d, texts: { ...d.texts, [path]: text } } : d));
        },
      }
    : null;
  return {
    draft,
    editing,
    changes,
    dirty: changes.length > 0,
    start: () => {
      originals.current = {};
      setDraft(EMPTY_DRAFT);
    },
    stop: () => {
      originals.current = {};
      setDraft(null);
    },
    add: (files: readonly { path: string; from: string; size: number }[]) =>
      setDraft((d) => {
        if (!d) return d;
        const added = { ...d.added };
        for (const f of files) added[f.path] = { from: f.from, size: f.size };
        return { ...d, added, removed: d.removed.filter((p) => !files.some((f) => f.path === p)) };
      }),
    remove: (path: string) =>
      setDraft((d) => {
        if (!d) return d;
        if (d.added[path]) {
          const added = { ...d.added };
          delete added[path];
          return { ...d, added };
        }
        return { ...d, removed: d.removed.includes(path) ? d.removed : [...d.removed, path] };
      }),
  };
}

/** 「添加文件」：系统的文件选择，取本机路径与大小；素材进 `assets/`，其余进 `references/`（品牌进 `brand/`）。 */
export function AddFilesButton({ brand = false, onAdd }: { brand?: boolean; onAdd(files: { path: string; from: string; size: number }[]): void }) {
  const runtime = useRuntime();
  return (
    <FileTrigger
      allowsMultiple
      onSelect={(list) => {
        const files = Array.from(list ?? [])
          .map((file) => ({ path: addedFilePath(file.name, brand), from: runtime.host.pathForFile(file), size: file.size }))
          .filter((f) => f.from);
        if (files.length) onAdd(files);
      }}>
      <ActionButton size="S">
        <Add />
        <Text>{FILES_COPY.addFiles}</Text>
      </ActionButton>
    </FileTrigger>
  );
}

/** 放弃这次修改的确认。 */
export function DiscardDialog({ open, body, onDiscard, onClose }: { open: boolean; body: string; onDiscard(): void; onClose(): void }) {
  return (
    <DialogContainer onDismiss={onClose}>
      {open ? (
        <AlertDialog
          variant="destructive"
          title={FILES_COPY.discardTitle}
          primaryActionLabel={FILES_COPY.discard}
          cancelLabel={FILES_COPY.keep}
          onPrimaryAction={onDiscard}>
          {body}
        </AlertDialog>
      ) : null}
    </DialogContainer>
  );
}
