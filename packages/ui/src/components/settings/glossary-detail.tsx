import { useEffect, useRef, useState } from 'react';
import { RpcError, type GlossaryContent, type LibraryEntry, type LibraryEntrySummary } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  Content,
  DialogContainer,
  Heading,
  InlineAlert,
  ProgressCircle,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import Delete from '@react-spectrum/s2/icons/Delete';
import Export from '@react-spectrum/s2/icons/Export';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel, shortenPath } from '../../model/format.ts';
import { isVersionConflict, libraryErrorText } from '../../model/library-entry.ts';
import {
  GLOSSARY_KINDS,
  addTranscriptionTerms,
  addTranslationTerms,
  addedText,
  exportFileName,
  glossaryNameProblem,
  languageLabel,
  reverseTranslation,
  sameLanguage,
  type TranscriptionTerm,
  type TranslationTerm,
} from '../../model/library-glossary.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { exportLibraryEntry, putLibraryEntry, removeLibraryEntry } from '../../runtime/library-commands.ts';
import { useLibraryEntry } from '../use-library-entry.ts';
import { GLOSSARY_COPY } from './glossary-copy.ts';
import { LanguagePicker } from './glossary-language-picker.tsx';
import { BulkAdd, QuickAdd, TermList, termKey, type GlossaryTerm } from './glossary-terms.tsx';

const detail = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const back = style({ alignSelf: 'start', marginStart: -8 });
const titleRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
const nameField = style({ flexGrow: 1, minWidth: 0 });
const meta = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, font: 'ui-sm', color: 'gray-700' });
const spacer = style({ flexGrow: 1 });
const stat = style({ font: 'ui-xs', color: 'gray-600' });
const fullWidth = style({ width: 'full' });
const foot = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 });
const loading = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-600' });

const D = () => GLOSSARY_COPY.detail;

/**
 * 一张术语表的详情（设计稿 `PackDetail`）：表名、语言、加词、条目、导出、反向与删除。每一处修改立刻存：
 * 在手上这一版上改，带 `expectedVersion` 写回；别处先改了就说明、重读最新的一版。修改排队一个一个发，
 * 连着加几条也不会和自己冲突。
 */
export function GlossaryDetail({ summary, onBack, onOpen }: { summary: LibraryEntrySummary; onBack(): void; onOpen(id: string): void }) {
  const runtime = useRuntime();
  const { entry: loaded, error, reload } = useLibraryEntry(summary);
  const [saved, setSaved] = useState<LibraryEntry | null>(null);
  const entry = saved && (!loaded || saved.version >= loaded.version) ? saved : loaded;
  const latest = useRef<LibraryEntry | null>(null);
  if (entry && (!latest.current || entry.version >= latest.current.version)) latest.current = entry;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** 在最新的一版上改一处并存下。`mutate` 返回 null 表示不用存。 */
  const commit = (action: string, mutate: (content: GlossaryContent) => GlossaryContent | null, done?: (next: GlossaryContent) => string) => {
    const run = async (): Promise<boolean> => {
      const base = latest.current;
      if (!base) return false;
      const next = mutate(base.content as GlossaryContent);
      if (!next) return false;
      setPending((n) => n + 1);
      try {
        const result = await putLibraryEntry(runtime, { library: 'glossaries', id: base.id, expectedVersion: base.version, content: next });
        latest.current = result.entry;
        setSaved(result.entry);
        if (done) ToastQueue.positive(done(next), { timeout: 3000 });
        return true;
      } catch (err) {
        ToastQueue.negative(libraryErrorText(action, err), { timeout: 6000 });
        if (isVersionConflict(err)) {
          setSaved(null);
          reload();
        }
        return false;
      } finally {
        setPending((n) => n - 1);
      }
    };
    const result = queue.current.then(run, run);
    queue.current = result;
    return result;
  };

  if (!entry) {
    return (
      <div className={detail}>
        <BackButton onBack={onBack} />
        {error ? (
          <InlineAlert variant="negative">
            <Heading>{D().loadFailed}</Heading>
            <Content>{error}</Content>
          </InlineAlert>
        ) : (
          <div className={loading}>
            <ProgressCircle aria-label={D().loadingLabel} size="S" isIndeterminate />
            {D().loading}
          </div>
        )}
      </div>
    );
  }

  const content = entry.content as GlossaryContent;
  const busy = pending > 0;

  /** 加一批词：表里已有的并进去（转录表并入新误写）；什么都没变时只提示，不存。返回 true 表示可以清空输入。 */
  const addTerms = async (incoming: GlossaryTerm[]) => {
    let receipt = '';
    let unchanged = false;
    const ok = await commit(
      D().addAction,
      (current) => {
        const result =
          current.kind === 'translation'
            ? addTranslationTerms(current.terms, incoming as TranslationTerm[])
            : addTranscriptionTerms(current.terms, incoming as TranscriptionTerm[]);
        receipt = addedText(result);
        if (JSON.stringify(result.terms) === JSON.stringify(current.terms)) {
          unchanged = true;
          ToastQueue.neutral(receipt, { timeout: 4000 });
          return null;
        }
        return { ...current, terms: result.terms } as GlossaryContent;
      },
      () => receipt,
    );
    return ok || unchanged;
  };

  const saveTerm = (key: string, term: GlossaryTerm) =>
    commit(D().saveTermAction, (current) => {
      const index = (current.terms as GlossaryTerm[]).findIndex((t) => termKey(t) === key);
      if (index < 0) {
        ToastQueue.negative(D().termGone, { timeout: 5000 });
        return null;
      }
      const terms = (current.terms as GlossaryTerm[]).slice();
      terms[index] = term;
      return { ...current, terms } as GlossaryContent;
    });

  const deleteTerm = (key: string) =>
    commit(
      D().deleteTermAction,
      (current) => ({ ...current, terms: (current.terms as GlossaryTerm[]).filter((t) => termKey(t) !== key) }) as GlossaryContent,
      () => D().termDeleted,
    );

  const exportTable = async () => {
    const pick = runtime.host.pickSavePath;
    if (!pick) return;
    const path = await pick({
      title: D().exportTitle,
      buttonLabel: D().exportButton,
      defaultName: exportFileName(content.name),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!path) return;
    try {
      const result = await exportLibraryEntry(runtime, { library: 'glossaries', id: entry.id, version: entry.version }, path);
      ToastQueue.positive(D().exported(shortenPath(result.path)), { timeout: 5000 });
    } catch (err) {
      const exists = err instanceof RpcError && err.code === 'conflict' && !isVersionConflict(err);
      ToastQueue.negative(exists ? D().exportExists : libraryErrorText(D().exportAction, err), { timeout: 6000 });
    }
  };

  const reverse = async () => {
    if (content.kind !== 'translation') return;
    const reversed = reverseTranslation(content);
    if (!reversed) return;
    try {
      const { entry: created } = await putLibraryEntry(runtime, { library: 'glossaries', content: reversed });
      ToastQueue.positive(D().reversed(reversed.name, reversed.terms.length), { timeout: 5000 });
      onOpen(created.id);
    } catch (err) {
      ToastQueue.negative(libraryErrorText(D().reverseAction, err), { timeout: 6000 });
    }
  };

  const remove = async () => {
    try {
      await removeLibraryEntry(runtime, 'glossaries', entry.id);
      ToastQueue.positive(D().deleted, { timeout: 3000 });
      onBack();
    } catch (err) {
      ToastQueue.negative(libraryErrorText(D().deleteAction, err), { timeout: 6000 });
    }
  };

  const canExport = !!runtime.host.pickSavePath;

  return (
    <div className={detail}>
      <BackButton onBack={onBack} />
      <div className={titleRow}>
        <NameField name={content.name} onCommit={(name) => commit(D().renameAction, (current) => ({ ...current, name }))} />
        <Badge variant="informative" fillStyle="subtle" size="S">
          {GLOSSARY_KINDS[content.kind].label}
        </Badge>
      </div>
      <div className={meta}>
        {content.kind === 'translation' ? (
          <>
            <LanguagePicker
              label={D().sourceLanguage}
              any
              value={content.sourceLanguage}
              onChange={(tag) => {
                if (sameLanguage(tag, content.targetLanguage)) {
                  ToastQueue.negative(D().sameLanguage, { timeout: 4000 });
                  return;
                }
                void commit(D().sourceAction, (current) => (current.kind === 'translation' ? { ...current, sourceLanguage: tag } : null));
              }}
            />
            <span aria-hidden>→</span>
            <LanguagePicker
              label={D().targetLanguage}
              value={content.targetLanguage}
              onChange={(tag) => {
                if (!tag) return;
                if (sameLanguage(content.sourceLanguage, tag)) {
                  ToastQueue.negative(D().sameLanguage, { timeout: 4000 });
                  return;
                }
                void commit(D().targetAction, (current) => (current.kind === 'translation' ? { ...current, targetLanguage: tag } : null));
              }}
            />
          </>
        ) : (
          <>
            <span>{D().spokenLanguage}</span>
            <LanguagePicker
              label={D().spokenLanguage}
              any
              value={content.language}
              onChange={(tag) => void commit(D().spokenAction, (current) => (current.kind === 'transcription' ? { ...current, language: tag } : null))}
            />
          </>
        )}
        <span className={spacer} />
        {busy ? <ProgressCircle aria-label={D().saving} size="S" isIndeterminate /> : null}
        <span className={stat}>{D().stats(content.terms.length, agoLabel(entry.updatedAt))}</span>
      </div>

      <QuickAdd key={content.kind} kind={content.kind} isDisabled={false} onAdd={addTerms} />
      <BulkAdd key={`bulk-${content.kind}`} kind={content.kind} isDisabled={false} onAdd={addTerms} />
      <TermList content={content} isDisabled={false} onSave={saveTerm} onDelete={deleteTerm} />

      <div className={foot}>
        <Button variant="secondary" size="S" isDisabled={!canExport} onPress={() => void exportTable()}>
          <Export />
          <Text>{D().exportTable}</Text>
        </Button>
        {content.kind === 'translation' && content.sourceLanguage ? (
          <Button variant="secondary" size="S" onPress={() => void reverse()}>
            {D().reverse(languageLabel(content.targetLanguage), languageLabel(content.sourceLanguage))}
          </Button>
        ) : null}
        <span className={spacer} />
        <Button variant="secondary" size="S" onPress={() => setConfirmDelete(true)}>
          <Delete />
          <Text>{D().deleteTable}</Text>
        </Button>
      </div>
      {canExport ? null : <div className={stat}>{D().exportUnavailable}</div>}

      <DialogContainer onDismiss={() => setConfirmDelete(false)}>
        {confirmDelete ? (
          <AlertDialog
            variant="destructive"
            title={D().deleteTitle(content.name)}
            primaryActionLabel={D().delete}
            cancelLabel={D().cancel}
            onPrimaryAction={() => void remove()}>
            {D().deleteBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}

function BackButton({ onBack }: { onBack(): void }) {
  return (
    <ActionButton isQuiet size="S" styles={back} onPress={onBack}>
      <ChevronLeft />
      <Text>{D().back}</Text>
    </ActionButton>
  );
}

/** 表名：改完回车或离开输入框时存；清空或超长时不存并提示。别处改了名字时跟上。 */
function NameField({ name, onCommit }: { name: string; onCommit(name: string): Promise<unknown> }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const problem = glossaryNameProblem(value);
  const commit = () => {
    const next = value.trim();
    if (problem || next === name) return;
    void onCommit(next);
  };
  return (
    <div className={nameField}>
      <TextField
        aria-label={D().name}
        value={value}
        onChange={setValue}
        isInvalid={!!problem}
        errorMessage={problem ?? undefined}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) commit();
          if (event.key === 'Escape') setValue(name);
        }}
        styles={fullWidth}
      />
    </div>
  );
}
