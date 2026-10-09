import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_SELECTED_GLOSSARIES, type DocumentRecord, type Id, type LibrarySelection, type TextModelInfo } from '@baocut/protocol';
import {
  Button,
  Checkbox,
  Content,
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  Switch,
  Text,
  TextArea,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { languageName } from '../../model/caption-tracks.ts';
import { guessLanguage } from '../../model/cue-edit.ts';
import { textModelLine } from '../../model/models-text.ts';
import { cloudModelOptions, findOption, initialModelKey, langName, parseModelKey, type ToolModelOption } from '../../model/tools-models.ts';
import {
  defaultTarget,
  existingTranslations,
  glossaryRows,
  targetOptions,
  toggleGlossary,
  type GlossaryCandidate,
} from '../../model/translate-setup.ts';
import { speechSentences } from '../../model/translation-doc.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { onLibraryEntries } from '../../state/library-feed.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { ModelGate, ModelLine } from '../tools/tool-model.tsx';
import { SectionLink } from '../tools/tool-parts.tsx';
import { GATE_COPY } from '../tools/tools-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { PanelHead } from './panel-head.tsx';
import { useDocumentBody } from './use-document-body.ts';
import { TRANSLATE_COPY as C } from './translate-copy.ts';
import { startTranslate, useTranslateRun } from './translate-run.ts';

const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 4, paddingBottom: 16 });
/** 一节的小标题（原型 SecHead）。 */
const secHead = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 });
const secTitle = style({ flexGrow: 1, margin: 0, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const hint = style({ margin: 0, marginTop: '[6px]', font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const field = style({ width: 'full' });
const glossaryList = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const glossaryRow = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const glossaryMeta = style({ paddingStart: 24, font: 'ui-xs', color: { default: 'gray-600', isOff: 'orange-1000' } });
const footer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '[6px]',
  flexShrink: 0,
  paddingX: 12,
  paddingY: 12,
  borderTopWidth: 1,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const alertActions = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 });

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 文本模型：翻译要结构化输出，不支持的那只列着但标明用不了（Runtime 也会拒）。 */
function translateModelOptions(options: ToolModelOption<TextModelInfo>[]): ToolModelOption<TextModelInfo>[] {
  return options.map((o) => (o.usable && o.info.structuredOutput === false ? { ...o, usable: false, why: C.noStructured } : o));
}

/** 库里的翻译用术语表（`library` 主题的摘要，再按版本读内容拿方向与词条）。 */
function useTranslationGlossaries(runtime: RuntimeSession): { ready: boolean; candidates: GlossaryCandidate[] } {
  const [summaries, setSummaries] = useState<{ id: Id; name: string; version: number }[] | null>(null);
  const [contents, setContents] = useState<Record<string, GlossaryCandidate['content']>>({});
  useEffect(
    () =>
      onLibraryEntries((entries) =>
        setSummaries(
          entries.filter((e) => e.library === 'glossaries' && e.kind === 'translation').map((e) => ({ id: e.id, name: e.name, version: e.version })),
        ),
      ),
    [],
  );
  // 读过（或正在读）的版本记一笔：换了摘要时只读新的；在读的不会因为重排被丢下。
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!summaries) return;
    for (const summary of summaries) {
      const key = `${summary.id}@${summary.version}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      runtime.getLibraryEntry({ library: 'glossaries', id: summary.id, version: summary.version }).then(
        (entry) => {
          if (!mounted.current) return;
          const content = entry.content as GlossaryCandidate['content'] & { kind?: string };
          setContents((c) => ({ ...c, [key]: content && content.kind === 'translation' ? content : null }));
        },
        () => mounted.current && setContents((c) => ({ ...c, [key]: null })),
      );
    }
  }, [runtime, summaries]);
  const candidates = useMemo(
    () => (summaries ?? []).map((s) => ({ id: s.id, name: s.name, content: contents[`${s.id}@${s.version}`] })),
    [summaries, contents],
  );
  return { ready: summaries !== null, candidates };
}

/**
 * 视频里启用的条目（`library.getVideoSelection`）：跟着视频里那份 `library-selection` 文档的版本重读，
 * 撤销、别处改了都跟得上；界面不另存一份。
 */
export function useVideoSelection(runtime: RuntimeSession, videoId: Id, documents: Record<Id, DocumentRecord>) {
  const doc = Object.values(documents).find((d) => d.kind === 'library-selection');
  const key = `${videoId}:${doc?.id ?? ''}:${doc?.currentRevision ?? ''}`;
  const [state, setState] = useState<{ key: string; selection: LibrarySelection | null; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    runtime.getVideoSelection(videoId).then(
      (result) => alive && setState({ key, selection: result.selection, error: null }),
      (error) => alive && setState({ key, selection: null, error: messageOf(error) }),
    );
    return () => {
      alive = false;
    };
  }, [runtime, videoId, key]);
  // 换了版本、新的还没读回来时先用上一份，免得勾选框闪一下。
  return state;
}

/**
 * 翻译设置页（原型 panel-aitools-flows.jsx `TranslateFlow`）：目标语言、原文、文本模型、风格提示、视频启用的术语表、
 * 双语显示，「翻译成 X」提交 `pipelines.start`。自成一页：从字幕轨条的「＋ 翻译成…」推进来，工具页的「翻译字幕」也挂它。
 * 文本模型没配置时就地说明、给去「模型 › 文本生成」的路，开始按钮不灰掉。
 */
export function TranslateFlow({
  videoId,
  documents,
  onBack,
  onStarted,
  backLabel = C.back,
}: {
  videoId: Id;
  documents: Record<Id, DocumentRecord>;
  onBack(): void;
  /** 提交成功：字幕面板收起这一页回到列表（进度在轨条与列表上）。 */
  onStarted(): void;
  /** 页头返回钮的说明；从工具页推进来时是工具页的「返回」。 */
  backLabel?: string;
}) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const busy = useTranslateRun((s) => !!s.runs[videoId]);
  const editable = useVideo((s) => canEdit(s.video));

  const speeches = useMemo(
    () => Object.values(documents).filter((d) => d.kind === 'speech' && !!d.sourceAssetId),
    [documents],
  );
  const [speechId, setSpeechId] = useState<Id | null>(null);
  const speech = speeches.find((d) => d.id === speechId) ?? speeches[0] ?? null;
  const speechBody = useDocumentBody(speech ?? undefined);
  const sentences = useMemo(() => (speechBody === undefined ? undefined : speechSentences(speechBody)), [speechBody]);
  const text = useMemo(() => (sentences ?? []).map((s) => s.text).join('\n'), [sentences]);
  const sourceLanguage = speech?.language ?? (text ? (guessLanguage(text.slice(0, 2000)) ?? null) : null);

  const targets = useMemo(
    () => targetOptions(sourceLanguage, speech ? existingTranslations(documents, speech.id) : []),
    [sourceLanguage, speech, documents],
  );
  const [targetPick, setTargetPick] = useState<string | null>(null);
  const target = targets.find((o) => o.tag === targetPick && !o.disabled)?.tag ?? defaultTarget(targets, sourceLanguage);

  const view = useModels((s) => s.capabilities);
  const options = useMemo(() => (view ? translateModelOptions(cloudModelOptions(view, 'generateText')) : []), [view]);
  const [modelKey, setModelKey] = useState<string | null>(null);
  const option = findOption(options, initialModelKey(options, modelKey, view?.generateText.effective ?? null));
  const ready = !!option?.usable;
  const toModels = () => go({ tab: 'models', category: 'llm', page: 'cloud' });
  const modelSection = useRef<HTMLDivElement>(null);

  const [styleHint, setStyleHint] = useState('');
  const [bilingual, setBilingual] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!speech) {
    return (
      <>
        <PanelHead title={C.title} back={{ label: backLabel, onPress: onBack }} />
        <div className={body}>
          <div className={style({ marginTop: 12 })}>
            <InlineAlert variant="informative">
              <Heading>{C.noSpeechTitle}</Heading>
              <Content>{C.noSpeech}</Content>
            </InlineAlert>
          </div>
        </div>
      </>
    );
  }

  const targetLabel = target ? languageName(target) : null;
  const start = async () => {
    if (!target || busy || submitting) return;
    if (!ready) {
      // 不灰掉按钮：说清楚差什么，把模型那一节带到眼前。
      modelSection.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      ToastQueue.neutral(options.length ? (option?.why ?? C.notConfiguredTitle) : C.notConfiguredTitle, { timeout: 4000 });
      return;
    }
    setSubmitting(true);
    const model = option ? parseModelKey(option.key) : null;
    const ok = await startTranslate({
      videoId,
      speechDocumentId: speech.id,
      targetLanguage: target,
      style: styleHint,
      model: model ? { providerId: model.providerId, modelId: model.modelId } : null,
      bilingual,
    });
    setSubmitting(false);
    // 被拒时问题卡挂在字幕面板上（带原因与去处）；这一页照样收起，免得盖住它。
    if (ok || useTranslateRun.getState().problems[videoId]) onStarted();
  };

  return (
    <>
      <PanelHead title={C.title} back={{ label: backLabel, onPress: onBack }} />
      <div className={`${body} bc-scroll`}>
        <div className={secHead}>
          <h3 className={secTitle}>{C.target}</h3>
        </div>
        <Picker
          aria-label={C.targetPicker}
          size="S"
          styles={field}
          selectedKey={target}
          disabledKeys={targets.filter((o) => o.disabled).map((o) => o.tag)}
          onSelectionChange={(key) => setTargetPick(String(key))}>
          {targets.map((o) => (
            <PickerItem key={o.tag} id={o.tag} textValue={o.label}>
              <Text slot="label">{o.label}</Text>
              <Text slot="description">{o.disabled ? `${o.description} · ${o.disabled}` : o.description}</Text>
            </PickerItem>
          ))}
        </Picker>
        {target ? null : <p className={hint}>{C.allTaken}</p>}

        <div className={secHead}>
          <h3 className={secTitle}>{C.source}</h3>
        </div>
        {speeches.length > 1 ? (
          <Picker
            aria-label={C.sourcePicker}
            size="S"
            styles={field}
            selectedKey={speech.id}
            onSelectionChange={(key) => {
              setSpeechId(String(key));
              setTargetPick(null);
            }}>
            {speeches.map((d) => (
              <PickerItem key={d.id} id={d.id} textValue={d.name}>
                <Text slot="label">{d.name}</Text>
                {d.language ? <Text slot="description">{langName(d.language)}</Text> : null}
              </PickerItem>
            ))}
          </Picker>
        ) : null}
        <p className={hint}>
          {C.sourceLine(sourceLanguage ? langName(sourceLanguage) : C.unknownLanguage, sentences ? sentences.length : null)}
          {speeches.length > 1 ? null : ` · ${speech.name}`}
        </p>

        <div ref={modelSection} className={secHead}>
          <h3 className={secTitle}>{C.model}</h3>
          <SectionLink onPress={toModels}>{C.manage}</SectionLink>
        </div>
        {!view ? (
          <p className={hint}>{C.modelsLoading}</p>
        ) : options.length ? (
          <>
            <ModelLine
              label={C.modelPicker}
              options={options}
              selected={option}
              disableUnusable
              onSelect={(o) => setModelKey(o.key)}
              factsOf={(o) => textModelLine(o.info)}
            />
            <ModelGate selected={option} options={options} body={GATE_COPY.textBody} onConnect={toModels} onSwitch={(o) => setModelKey(o.key)} />
          </>
        ) : (
          <InlineAlert variant="notice">
            <Heading>{C.notConfiguredTitle}</Heading>
            <Content>
              {C.notConfiguredBody}
              <div className={alertActions}>
                <Button size="S" variant="accent" onPress={toModels}>
                  {C.goModels}
                </Button>
              </div>
            </Content>
          </InlineAlert>
        )}

        <div className={secHead}>
          <h3 className={secTitle}>{C.style}</h3>
        </div>
        <TextArea
          aria-label={C.style}
          size="S"
          styles={field}
          placeholder={C.stylePlaceholder}
          value={styleHint}
          maxLength={500}
          onChange={setStyleHint}
        />
        <p className={hint}>{C.styleHint}</p>

        <GlossarySection
          runtime={runtime}
          videoId={videoId}
          documents={documents}
          sourceLanguage={sourceLanguage}
          target={target}
          text={text}
          editable={editable}
        />

        <div className={secHead}>
          <h3 className={secTitle}>{C.bilingual}</h3>
        </div>
        <Switch isSelected={bilingual} onChange={setBilingual}>
          {C.bilingual}
        </Switch>
        <p className={hint}>{C.bilingualHint}</p>
      </div>
      <div className={footer}>
        <Button variant="accent" styles={field} isDisabled={!target || busy || !editable} isPending={submitting} onPress={() => void start()}>
          {targetLabel ? C.cta(targetLabel) : C.cta('…')}
        </Button>
        <p className={hint}>{busy ? C.busy : !editable ? C.readOnly : C.ctaHint}</p>
      </div>
    </>
  );
}

/** 术语表一节：勾选 = 在这个视频启用（`library.setVideoSelection`，一笔能撤销的编辑）；启用了但这次用不上的写原因。 */
export function GlossarySection({
  runtime,
  videoId,
  documents,
  sourceLanguage,
  target,
  text,
  editable,
}: {
  runtime: RuntimeSession;
  videoId: Id;
  documents: Record<Id, DocumentRecord>;
  sourceLanguage: string | null;
  target: string | null;
  text: string;
  editable: boolean;
}) {
  const go = useShell((s) => s.go);
  const { undo } = useEditorActions();
  const library = useTranslationGlossaries(runtime);
  const selection = useVideoSelection(runtime, videoId, documents);
  const [writing, setWriting] = useState(false);
  const enabled = selection?.selection?.glossaries.translate ?? [];
  const rows = target ? glossaryRows(library.candidates, enabled, sourceLanguage, target, text) : [];

  const toggle = async (id: Id, name: string, on: boolean) => {
    const next = toggleGlossary(enabled, id, on);
    if (!next) {
      if (on && enabled.length >= MAX_SELECTED_GLOSSARIES) ToastQueue.neutral(C.glossaryLimit(MAX_SELECTED_GLOSSARIES), { timeout: 4000 });
      return;
    }
    setWriting(true);
    try {
      const result = await runtime.setVideoSelection({ videoId, glossaries: { translate: next } });
      ToastQueue.positive(on ? C.glossaryOn(name) : C.glossaryOff(name), {
        timeout: 5000,
        actionLabel: C.undo,
        onAction: () => void undo({ transaction: result.receipt.transactionId }),
        shouldCloseOnAction: true,
      });
    } catch (error) {
      ToastQueue.negative(C.glossaryWriteFailed(messageOf(error)), { timeout: 5000 });
    } finally {
      setWriting(false);
    }
  };

  return (
    <>
      <div className={secHead}>
        <h3 className={secTitle}>{C.glossary}</h3>
        <SectionLink onPress={() => go({ tab: 'settings', section: 'glossary' })}>{C.glossaryManage}</SectionLink>
      </div>
      {selection?.error ? (
        <p className={hint}>{C.glossaryFailed(selection.error)}</p>
      ) : !library.ready || !selection ? (
        <p className={hint}>{C.glossaryLoading}</p>
      ) : !rows.length ? (
        <p className={hint}>{C.glossaryEmpty(target ? langName(target) : C.targetLanguage)}</p>
      ) : (
        <div className={glossaryList}>
          {rows.map((row) => (
            <div key={row.id} className={glossaryRow}>
              <Checkbox
                size="S"
                isSelected={row.enabled}
                isDisabled={!editable || writing || (!row.enabled && row.terms === null)}
                onChange={(on) => void toggle(row.id, row.name, on)}>
                {row.name}
              </Checkbox>
              <span className={glossaryMeta({ isOff: row.enabled && !row.used })}>
                {row.note ?? (row.terms === null ? '' : C.glossaryCount(row.terms, row.hits ?? 0))}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className={hint}>{editable ? C.glossaryNote : C.glossaryReadOnly}</p>
    </>
  );
}
