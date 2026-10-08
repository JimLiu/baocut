import { useRef, useState, type KeyboardEvent } from 'react';
import type { GlossaryContent } from '@baocut/protocol';
import { ActionButton, Button, SearchField, Switch, Text, TextArea, TextField, Tooltip, TooltipTrigger, type TextFieldRef } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  GLOSSARY_KINDS,
  joinMisheard,
  normKey,
  parseTranscriptionLines,
  parseTranslationLines,
  searchTerms,
  splitMisheard,
  tidyTranscriptionTerm,
  tidyTranslationTerm,
  transcriptionTermProblems,
  translationTermProblems,
  type GlossaryKind,
  type TranscriptionTerm,
  type TranslationTerm,
} from '../../model/library-glossary.ts';
import { GLOSSARY_COPY } from './glossary-copy.ts';

const T = () => GLOSSARY_COPY.terms;

/** 一条术语（两种表各自的形状）。 */
export type GlossaryTerm = TranscriptionTerm | TranslationTerm;

/** 条目在表里的身份：规范写法（原文）的归并键（同一张表里不会有两条同键的）；全是标点时用原文。 */
export function termKey(term: GlossaryTerm): string {
  const text = 'canonical' in term ? term.canonical : term.source;
  return normKey(text) || `=${text}`;
}

/** 一次最多画这么多行；再多的用搜索缩小范围（一张表最多 5000 条）。 */
const MAX_ROWS = 200;

const addBox = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const addRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
const grow = style({ flexGrow: 1, flexBasis: 0, minWidth: 0 });
const arrow = style({ flexShrink: 0, font: 'ui', color: 'gray-600' });
const bad = style({ font: 'ui-xs', color: 'red-900', overflowWrap: 'anywhere' });
const bulk = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
});
const full = style({ width: 'full' });
const how = style({ font: 'ui-xs', color: 'gray-700' });
const skipList = style({ display: 'flex', flexDirection: 'column', gap: 4, font: 'ui-xs', color: 'orange-1000', overflowWrap: 'anywhere' });
const acts = style({ display: 'flex', alignItems: 'center', gap: 8 });
const spacer = style({ flexGrow: 1 });
const mono = style({ font: 'code-sm' });
const terms = style({ marginTop: 12, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'lg', overflow: 'hidden' });
const termRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingY: 8,
  paddingX: 12,
  borderTopWidth: { default: 0, ':nth-child(n+2)': 1 },
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: { default: 'transparent', ':hover': 'gray-50' },
});
const termOpen = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderTopWidth: { default: 0, ':nth-child(n+2)': 1 },
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
});
const termText = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const termHead = style({ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, minWidth: 0 });
const termMain = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere' });
const termTarget = style({ font: 'ui', color: 'gray-900', overflowWrap: 'anywhere' });
const termSub = style({ font: 'ui-xs', color: 'gray-700', overflowWrap: 'anywhere' });
const termNote = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const emptyText = style({ paddingY: 24, paddingX: 12, font: 'ui-sm', color: 'gray-600' });
const more = style({ paddingY: 8, paddingX: 12, font: 'ui-xs', color: 'gray-600' });
const hint = style({ font: 'ui-xs', color: 'gray-600' });

const enter = (event: KeyboardEvent, run: () => void) => {
  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
    event.preventDefault();
    run();
  }
};

/** 加词：常驻一行两格，回车就进表（设计稿 `QuickAdd`）。表里已有的词由调用方并进去，这里只挡自身的问题。 */
export function QuickAdd({ kind, isDisabled, onAdd }: { kind: GlossaryKind; isDisabled: boolean; onAdd(terms: GlossaryTerm[]): Promise<boolean> }) {
  const names = GLOSSARY_KINDS[kind];
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const first = useRef<TextFieldRef>(null);
  const term: GlossaryTerm =
    kind === 'translation' ? { source: a, target: b, note: null } : { canonical: a, misheard: splitMisheard(b) };
  const problems = a.trim() || b.trim() ? problemsOf(term, []) : [];
  const ready = !!a.trim() && !problems.length && !isDisabled;
  const submit = () => {
    if (!ready) return;
    void onAdd([tidy(term)]).then((ok) => {
      if (!ok) return;
      setA('');
      setB('');
      first.current?.focus();
    });
  };
  return (
    <div className={addBox}>
      <div className={addRow}>
        <TextField
          ref={first}
          aria-label={names.a}
          size="S"
          styles={grow}
          value={a}
          onChange={setA}
          placeholder={kind === 'translation' ? T().sourcePlaceholder : T().canonicalPlaceholder}
          onKeyDown={(event) => enter(event, submit)}
        />
        <span className={arrow} aria-hidden>
          {kind === 'translation' ? '→' : '←'}
        </span>
        <TextField
          aria-label={names.b}
          size="S"
          styles={grow}
          value={b}
          onChange={setB}
          placeholder={kind === 'translation' ? T().targetPlaceholder : T().misheardPlaceholder}
          onKeyDown={(event) => enter(event, submit)}
        />
        <Button variant="accent" size="S" isDisabled={!ready} onPress={submit}>
          {T().add}
        </Button>
      </div>
      {problems.length && a.trim() ? (
        <div className={bad} role="alert">
          {T().problems(problems)}
        </div>
      ) : null}
    </div>
  );
}

/** 一次粘一批：一行一条，解析不了的行原样退回来、不悄悄丢（设计稿 `BulkAdd`）。 */
export function BulkAdd({ kind, isDisabled, onAdd }: { kind: GlossaryKind; isDisabled: boolean; onAdd(terms: GlossaryTerm[]): Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open)
    return (
      <div>
        <ActionButton isQuiet size="S" onPress={() => setOpen(true)}>
          <ChevronRight />
          <Text>{T().bulkOpen}</Text>
        </ActionButton>
      </div>
    );
  const parsed = kind === 'translation' ? parseTranslationLines(text) : parseTranscriptionLines(text);
  const sample = kind === 'translation' ? T().translationSample : T().transcriptionSample;
  const close = () => {
    setOpen(false);
    setText('');
  };
  return (
    <div className={bulk}>
      <TextArea aria-label={T().bulkLabel} size="S" styles={full} value={text} onChange={setText} placeholder={sample} autoFocus />
      <div className={how}>{T().bulkHow(kind === 'translation', <span className={mono}>=</span>, <span className={mono}>→</span>)}</div>
      {parsed.skipped.length ? (
        <div className={skipList} role="status">
          {parsed.skipped.slice(0, 4).map((s, i) => (
            <span key={i}>
              <span className={mono}>{s.line}</span> · {s.why}
            </span>
          ))}
          {parsed.skipped.length > 4 ? <span>{T().moreSkipped(parsed.skipped.length - 4)}</span> : null}
        </div>
      ) : null}
      <div className={acts}>
        <Button
          variant="accent"
          size="S"
          isDisabled={!parsed.terms.length || isDisabled}
          onPress={() => void onAdd(parsed.terms).then((ok) => ok && close())}>
          {T().addBatch(parsed.terms.length)}
        </Button>
        <Button variant="secondary" size="S" onPress={close}>
          {T().cancel}
        </Button>
      </div>
    </div>
  );
}

/**
 * 条目列表：一行读完，点「编辑」就地展开（设计稿 `TermRow` / `TermEditor`）。条数多时有搜索；
 * 打开的那一条按身份（规范写法）记，表在别处改了也不会错位。
 */
export function TermList({
  content,
  isDisabled,
  onSave,
  onDelete,
}: {
  content: GlossaryContent;
  isDisabled: boolean;
  onSave(key: string, term: GlossaryTerm): Promise<boolean>;
  onDelete(key: string): Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const all: GlossaryTerm[] = content.terms;
  const hits = searchTerms(content, query);
  const shown = hits.slice(0, MAX_ROWS);
  return (
    <>
      {all.length > 8 ? (
        <SearchField
          aria-label={T().search}
          size="S"
          styles={full}
          value={query}
          onChange={setQuery}
          placeholder={content.kind === 'translation' ? T().searchTranslation : T().searchTranscription}
        />
      ) : null}
      <div className={terms}>
        {shown.length ? (
          shown.map((index) => {
            const term = all[index]!;
            const key = termKey(term);
            return key === openKey ? (
              <div key={key} className={termOpen}>
                <TermEditor
                  term={term}
                  others={all.filter((t) => termKey(t) !== key)}
                  isDisabled={isDisabled}
                  onCancel={() => setOpenKey(null)}
                  onSave={(next) => onSave(key, next).then((ok) => ok && setOpenKey(null))}
                  onDelete={() => onDelete(key).then((ok) => ok && setOpenKey(null))}
                />
              </div>
            ) : (
              <TermRow key={key} term={term} isDisabled={isDisabled} onOpen={() => setOpenKey(key)} />
            );
          })
        ) : (
          <div className={emptyText}>
            {query.trim()
              ? T().noMatch(query.trim())
              : content.kind === 'translation'
                ? T().emptyTranslation
                : T().emptyTranscription}
          </div>
        )}
        {hits.length > shown.length ? (
          <div className={more}>{T().moreHidden(hits.length - shown.length)}</div>
        ) : null}
      </div>
    </>
  );
}

function TermRow({ term, isDisabled, onOpen }: { term: GlossaryTerm; isDisabled: boolean; onOpen(): void }) {
  const main = 'canonical' in term ? term.canonical : term.source;
  return (
    <div className={termRow}>
      <div className={termText}>
        <div className={termHead}>
          <span className={termMain}>{main}</span>
          {'target' in term ? (
            <>
              <span className={arrow} aria-hidden>
                →
              </span>
              <span className={termTarget}>{term.target}</span>
            </>
          ) : term.misheard.length ? (
            <span className={termSub}>{T().misheardAs(term.misheard)}</span>
          ) : null}
        </div>
        {'note' in term && term.note ? <div className={termNote}>{term.note}</div> : null}
      </div>
      <TooltipTrigger>
        <ActionButton isQuiet size="S" aria-label={T().editLabel(main)} isDisabled={isDisabled} onPress={onOpen}>
          <Edit />
        </ActionButton>
        <Tooltip>{T().edit}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}

function TermEditor({
  term,
  others,
  isDisabled,
  onSave,
  onCancel,
  onDelete,
}: {
  term: GlossaryTerm;
  others: GlossaryTerm[];
  isDisabled: boolean;
  onSave(term: GlossaryTerm): Promise<unknown>;
  onCancel(): void;
  onDelete(): Promise<unknown>;
}) {
  const translation = 'target' in term;
  const names = GLOSSARY_KINDS[translation ? 'translation' : 'transcription'];
  const [a, setA] = useState(translation ? term.source : term.canonical);
  const [b, setB] = useState(translation ? term.target : joinMisheard(term.misheard));
  const [note, setNote] = useState(translation ? (term.note ?? '') : '');
  const [showNote, setShowNote] = useState(translation && !!term.note);
  const draft: GlossaryTerm = translation ? { source: a, target: b, note } : { canonical: a, misheard: splitMisheard(b) };
  const problems = problemsOf(draft, others);
  const ready = !problems.length && !isDisabled;
  const save = () => {
    if (ready) void onSave(tidy(draft));
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onCancel();
    else enter(event, save);
  };
  return (
    <>
      <div className={addRow}>
        <TextField aria-label={names.a} size="S" styles={grow} value={a} onChange={setA} autoFocus onKeyDown={keys} />
        <span className={arrow} aria-hidden>
          {translation ? '→' : '←'}
        </span>
        <TextField
          aria-label={names.b}
          size="S"
          styles={grow}
          value={b}
          onChange={setB}
          placeholder={translation ? undefined : T().misheardHint}
          onKeyDown={keys}
        />
      </div>
      {!translation ? (
        <div className={hint}>{T().misheardTip}</div>
      ) : showNote ? (
        <>
          <TextField
            aria-label={T().note}
            size="S"
            styles={full}
            value={note}
            onChange={setNote}
            placeholder={T().notePlaceholder}
            onKeyDown={keys}
          />
          {/* 设计稿的「可变通」：术语表格式（library.ts 的 TranslationGlossary）没有这一项，如实置灰。 */}
          <div className={addRow}>
            <Switch size="S" isDisabled>
              {T().flexible}
            </Switch>
            <span className={hint}>{T().flexibleHint}</span>
          </div>
        </>
      ) : (
        <div>
          <ActionButton isQuiet size="S" onPress={() => setShowNote(true)}>
            <ChevronDown />
            <Text>{T().more}</Text>
          </ActionButton>
        </div>
      )}
      {problems.length ? (
        <div className={bad} role="alert">
          {T().problems(problems)}
        </div>
      ) : null}
      <div className={acts}>
        <Button variant="accent" size="S" isDisabled={!ready} onPress={save}>
          {T().save}
        </Button>
        <Button variant="secondary" size="S" onPress={onCancel}>
          {T().cancel}
        </Button>
        <span className={spacer} />
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={T().deleteEntry} isDisabled={isDisabled} onPress={() => void onDelete()}>
            <Delete />
          </ActionButton>
          <Tooltip>{T().deleteEntry}</Tooltip>
        </TooltipTrigger>
      </div>
    </>
  );
}

function problemsOf(term: GlossaryTerm, others: GlossaryTerm[]): string[] {
  return 'canonical' in term
    ? transcriptionTermProblems(term, others as TranscriptionTerm[])
    : translationTermProblems(term, others as TranslationTerm[]);
}

function tidy(term: GlossaryTerm): GlossaryTerm {
  return 'canonical' in term ? tidyTranscriptionTerm(term) : tidyTranslationTerm(term);
}
