import { useState, type ReactNode } from 'react';
import type { GlossaryContent, LibraryEntrySummary } from '@baocut/protocol';
import { ActionButton, Badge, Button, ProgressCircle, Switch, Text, ToastQueue } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Import from '@react-spectrum/s2/icons/Import';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { isVersionConflict, libraryErrorText } from '../../model/library-entry.ts';
import { newTranscriptionGlossary, newTranslationGlossary, pairLabel, sameLanguage, type GlossaryKind } from '../../model/library-glossary.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { importLibraryFile, putLibraryEntry } from '../../runtime/library-commands.ts';
import { useLibrary } from '../../state/library-store.ts';
import { useLibraryEntry } from '../use-library-entry.ts';
import { GLOSSARY_COPY } from './glossary-copy.ts';
import { GlossaryDetail } from './glossary-detail.tsx';
import { LanguagePicker } from './glossary-language-picker.tsx';

const root = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const lede = style({ marginTop: -24, marginBottom: 0, font: 'ui', color: 'gray-700' });
const section = style({ marginTop: 32, marginBottom: 8 });
const sectionTitle = style({ margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const sectionHint = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyleType: 'none' });
const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', ':hover': 'gray-300' },
  borderRadius: 'lg',
});
const cardMain = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const cardName = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const cardTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere' });
const cardStat = style({ font: 'ui-xs', color: 'gray-600' });
const cardSide = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const actions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 });
const newBox = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 12,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
});
const newText = style({ font: 'ui-sm', color: 'gray-800' });
const spacer = style({ flexGrow: 1 });
const footActions = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 32,
  paddingTop: 16,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const foot = style({ marginTop: 12, marginBottom: 0, font: 'ui-xs', color: 'gray-600' });
const loadingRow = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, font: 'ui-sm', color: 'gray-600' });
const emptyText = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });

const L = () => GLOSSARY_COPY.list;

/** 从文件导入的文件类型（Runtime 按内容认格式，这里只收窄对话框里的候选）。 */
const importFilters = () => [{ name: GLOSSARY_COPY.list.importFilter, extensions: ['md', 'markdown', 'txt'] }];

/**
 * 设置 › 术语库（产品设计 §15.10，设计稿 settings-glossary.jsx）：转录与翻译各用各的表。列表跟着 `library` 主题走；
 * 点进一张表编辑。每个视频用哪几张表在那个视频自己的转录、翻译设置里选，不在这里。
 */
export function GlossarySettings() {
  const ready = useLibrary((s) => s.ready);
  const glossaries = useLibrary((s) => s.glossaries);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? glossaries.find((g) => g.id === openId) : undefined;

  if (open) return <GlossaryDetail key={open.id} summary={open} onBack={() => setOpenId(null)} onOpen={setOpenId} />;
  return <GlossaryList ready={ready} glossaries={glossaries} onOpen={setOpenId} />;
}

function GlossaryList({ ready, glossaries, onOpen }: { ready: boolean; glossaries: LibraryEntrySummary[]; onOpen(id: string): void }) {
  const runtime = useRuntime();
  const [newTranslation, setNewTranslation] = useState(false);
  const [importing, setImporting] = useState(false);
  const asr = glossaries.filter((g) => g.kind === 'transcription');
  const translation = glossaries.filter((g) => g.kind === 'translation');

  const create = async (content: GlossaryContent) => {
    try {
      const { entry } = await putLibraryEntry(runtime, { library: 'glossaries', content });
      setNewTranslation(false);
      onOpen(entry.id);
    } catch (error) {
      ToastQueue.negative(libraryErrorText(L().createAction, error), { timeout: 6000 });
    }
  };

  const importFile = async () => {
    const pick = runtime.host.pickFiles;
    if (!pick) return;
    const [path] = await pick({ title: L().importTitle, buttonLabel: L().importButton, filters: importFilters() });
    if (!path) return;
    setImporting(true);
    try {
      const entry = await importLibraryFile(runtime, path);
      if (entry.library === 'glossaries') {
        const content = entry.content as GlossaryContent;
        ToastQueue.positive(L().imported(content.name, content.terms.length), { timeout: 4000 });
        onOpen(entry.id);
      } else {
        ToastQueue.neutral(L().notGlossary(L().otherLibrary[entry.library] ?? L().userLibrary), { timeout: 6000 });
      }
    } catch (error) {
      ToastQueue.negative(libraryErrorText(L().importAction, error), { timeout: 6000 });
    } finally {
      setImporting(false);
    }
  };

  const canImport = !!runtime.host.pickFiles;

  return (
    <div className={root}>
      <p className={lede}>{L().lede}</p>
      {!ready ? (
        <div className={loadingRow}>
          <ProgressCircle aria-label={L().loadingLabel} size="S" isIndeterminate />
          {L().loading}
        </div>
      ) : (
        <>
          <Section kind="transcription" hint={L().transcriptionHint}>
            <Cards items={asr} empty={L().transcriptionEmpty} onOpen={onOpen} />
            <div className={actions}>
              <Button variant="secondary" size="S" onPress={() => void create(newTranscriptionGlossary())}>
                <Add />
                <Text>{L().newTranscription}</Text>
              </Button>
            </div>
          </Section>
          <Section kind="translation" hint={L().translationHint}>
            <Cards items={translation} empty={L().translationEmpty} onOpen={onOpen} />
            {newTranslation ? (
              <NewTranslation onCancel={() => setNewTranslation(false)} onCreate={(from, to) => create(newTranslationGlossary(from, to))} />
            ) : (
              <div className={actions}>
                <Button variant="secondary" size="S" onPress={() => setNewTranslation(true)}>
                  <Add />
                  <Text>{L().newTranslation}</Text>
                </Button>
              </div>
            )}
          </Section>
        </>
      )}
      <div className={footActions}>
        <Button variant="secondary" size="S" isDisabled={!canImport || !ready} isPending={importing} onPress={() => void importFile()}>
          <Import />
          <Text>{L().importFile}</Text>
        </Button>
        {canImport ? null : <span className={cardStat}>{L().importUnavailable}</span>}
      </div>
      <p className={foot}>{L().foot}</p>
    </div>
  );
}

function Section({ kind, hint, children }: { kind: GlossaryKind; hint: string; children: ReactNode }) {
  const title = kind === 'translation' ? L().translationTitle : L().transcriptionTitle;
  return (
    <section aria-label={title}>
      <div className={section}>
        <h2 className={sectionTitle}>{title}</h2>
        <p className={sectionHint}>{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Cards({ items, empty, onOpen }: { items: LibraryEntrySummary[]; empty: string; onOpen(id: string): void }) {
  if (!items.length) return <p className={emptyText}>{empty}</p>;
  return (
    <ul className={list}>
      {items.map((summary) => (
        <GlossaryCard key={summary.id} summary={summary} onOpen={() => onOpen(summary.id)} />
      ))}
    </ul>
  );
}

/** 一张表一行（设计稿 `PackCard`）：名字、方向、条数与更新时间；右边是「新视频默认用」与进入详情。 */
function GlossaryCard({ summary, onOpen }: { summary: LibraryEntrySummary; onOpen(): void }) {
  const runtime = useRuntime();
  const { entry, reload } = useLibraryEntry(summary);
  const [pending, setPending] = useState<boolean | null>(null);
  const content = entry?.content as GlossaryContent | undefined;
  const enabled = pending ?? summary.defaultEnabled ?? content?.defaultEnabled ?? false;

  const toggle = async (next: boolean) => {
    if (!entry || !content) return;
    setPending(next);
    try {
      await putLibraryEntry(runtime, {
        library: 'glossaries',
        id: entry.id,
        expectedVersion: entry.version,
        content: { ...content, defaultEnabled: next },
      });
    } catch (error) {
      ToastQueue.negative(libraryErrorText(next ? L().defaultOnAction : L().defaultOffAction, error), { timeout: 6000 });
      if (isVersionConflict(error)) reload();
    } finally {
      setPending(null);
    }
  };

  return (
    <li className={card}>
      <div className={cardMain}>
        <div className={cardName}>
          <span className={cardTitle}>{summary.name}</span>
          {content ? (
            <Badge variant="neutral" fillStyle="subtle" size="S">
              {pairLabel(content)}
            </Badge>
          ) : null}
        </div>
        <span className={cardStat}>{L().stats(summary.termCount ?? content?.terms.length ?? 0, agoLabel(summary.updatedAt))}</span>
      </div>
      <div className={cardSide}>
        <Switch size="S" isSelected={enabled} isDisabled={!entry || pending !== null} onChange={(next) => void toggle(next)}>
          {L().defaultForNew}
        </Switch>
        <ActionButton isQuiet size="S" aria-label={L().open(summary.name)} onPress={onOpen}>
          <ChevronRight />
        </ActionButton>
      </div>
    </li>
  );
}

/** 新建翻译表先问方向——方向是这张表的身份，不是以后再补的属性（设计稿 `NewTrans`）。 */
function NewTranslation({ onCreate, onCancel }: { onCreate(from: string | null, to: string): Promise<void>; onCancel(): void }) {
  const [from, setFrom] = useState<string | null>('en');
  const [to, setTo] = useState('zh');
  const [busy, setBusy] = useState(false);
  const same = sameLanguage(from, to);
  return (
    <div className={newBox}>
      <span className={newText}>{L().from}</span>
      <LanguagePicker label={L().sourceLanguage} any value={from} onChange={setFrom} />
      <span className={newText}>{L().to}</span>
      <LanguagePicker label={L().targetLanguage} value={to} onChange={(tag) => tag && setTo(tag)} />
      <span className={spacer} />
      {same ? <span className={cardStat}>{L().sameLanguage}</span> : null}
      <Button
        variant="accent"
        size="S"
        isDisabled={same}
        isPending={busy}
        onPress={() => {
          setBusy(true);
          void onCreate(from, to).finally(() => setBusy(false));
        }}>
        {L().create}
      </Button>
      <Button variant="secondary" size="S" onPress={onCancel}>
        {L().cancel}
      </Button>
    </div>
  );
}
