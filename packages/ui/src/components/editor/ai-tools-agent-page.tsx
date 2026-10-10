import { useMemo, useRef, useState, type ReactNode } from 'react';
import { getLocale, type DocumentRecord, type Id, type Sequence } from '@baocut/protocol';
import { Checkbox, NumberField, Picker, PickerItem, TextField, ToastQueue } from '@react-spectrum/s2';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  aiTool,
  canvasRatio,
  CLEANUP_OPTIONS,
  cleanupExtra,
  COVER_COUNT,
  COVER_RATIOS,
  COVER_TEXT,
  hasScope,
  intentPrompt,
  isWritingTool,
  TITLE_COUNT,
  toolEffect,
  toolTemplate,
  writingExtra,
  type AgentToolId,
  type CleanupKey,
  type CoverRatio,
  type CoverText,
} from '../../model/ai-tools.ts';
import { chapterPieces } from '../../model/export-range.ts';
import { bundleName } from '../../model/models-local.ts';
import { readSpeechWords } from '../../model/speech-cues.ts';
import { transcriptParagraphs, transcriptWords } from '../../model/transcript-cut.ts';
import { transcribeModelInfo } from '../../model/transcribe-speakers.ts';
import { useAiToolRunner, type AiToolRunner } from '../../state/ai-tool-runner-store.ts';
import { useModels } from '../../state/models-store.ts';
import { AsrMoreOptions, useSpeakerState } from '../tools/asr-more-options.tsx';
import { directHasScope, directParams, directTool, scopedParagraphs } from './ai-tool-direct.ts';
import { DirectModelGate, DirectModelPicker, DirectProblem, DirectReceiptView, DirectResultView, DirectRunView, useDirectModel } from './ai-tool-direct-view.tsx';
import { AgentUseRow, AiToolPrompt, SessionRow, useToolHandoff, type DirectPrompt } from './ai-tool-prompt.tsx';
import { runKey, startAiTool, useAiToolRun } from './ai-tool-run.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import type { AiToolPreset } from './ai-tools-nav.ts';
import { PanelHead } from './panel-head.tsx';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { useDocumentBody } from './use-document-body.ts';

const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 16 });
/** 工具页顶上那张说明卡（原型 .aicard）。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'ui-sm',
  color: 'gray-800',
  lineHeight: '[1.5]',
});
const problemBox = style({ marginBottom: 12 });
const cardTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const secHead = style({ marginTop: 16, marginBottom: 8, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
/** 设置态里的一行（原型 .tsetup__row）：左边标签、右边控件。 */
const rows = style({ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 });
const row = style({ display: 'flex', alignItems: 'start', gap: 8 });
const rowLabel = style({ flexShrink: 0, width: 56, paddingTop: 4, font: 'ui-sm', color: 'gray-700' });
const rowBody = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const options = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const option = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const optionSub = style({ paddingStart: 24, font: 'ui-xs', color: 'gray-600' });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const field = style({ width: 'full' });
/** 说明卡最后一行：按下去会不会改视频（原型 .ail__effect）。 */
const effect = style({ display: 'flex', alignItems: 'start', gap: '[6px]', marginTop: 4, color: 'gray-700' });
const effectIcon = iconStyle({ size: 'S' });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={row}>
      <span className={rowLabel}>{label}</span>
      <div className={rowBody}>{children}</div>
    </div>
  );
}

function Option({
  label,
  sub,
  isSelected,
  isDisabled,
  onChange,
}: {
  label: string;
  sub: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <div className={option}>
      <Checkbox size="S" isSelected={isSelected} isDisabled={isDisabled} onChange={onChange}>
        {label}
      </Checkbox>
      <span className={optionSub}>{sub}</span>
    </div>
  );
}

/**
 * 交给 Agent 的工具页（原型 panel-aitools.jsx `DocFlow`、panel-aitools-write.jsx、panel-aitools-cover.jsx 的设置态，产品设计 §5.10「参数页」）：
 * 说明卡（名字、说明、会不会改视频），设置行（「用」、范围、会话，再接工具自己的勾选项与数字），提示词框（预填模板、挂着这个工具的
 * skill），主按钮与一行去向。语言、风格、篇幅、视角写在提示词里，不再是下拉。按下就发出去，工具页回到列表。
 */
export function AiAgentToolPage({
  videoId,
  tool,
  preset,
  sequence,
  documents,
  onBack,
}: {
  videoId: Id;
  tool: AgentToolId;
  preset: AiToolPreset | null;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  onBack(): void;
}) {
  const handoff = useToolHandoff();
  const ref = handoff.ref;
  const info = aiTool(tool);
  const writing = isWritingTool(tool);

  const chapters = useMemo(() => chapterPieces(sequence), [sequence]);
  const [scopeKey, setScopeKey] = useState<string>('all');
  const scopeIndex = chapters.findIndex((c) => c.id === scopeKey);
  const scope = scopeIndex >= 0 ? C.scopeChapter(scopeIndex + 1, chapters[scopeIndex]!.label) : null;

  // 「用」：按工具记住交给 Agent 还是直接调模型（直接调模型做不了的工具总是交给 Agent）。
  const kind = directTool(tool);
  const savedRunner = useAiToolRunner((s) => s.runners[tool]);
  const setRunner = useAiToolRunner((s) => s.setRunner);
  const runner: AiToolRunner = kind && savedRunner === 'model' ? 'model' : 'agent';
  const viaModel = runner === 'model' && kind ? kind : null;
  const model = useDirectModel(kind ?? 'summary');
  const key = kind ? runKey(videoId, kind) : '';
  const run = useAiToolRun((s) => s.runs[key] ?? null);
  const result = useAiToolRun((s) => s.results[key] ?? null);
  const receipt = useAiToolRun((s) => s.receipts[key] ?? null);
  const problem = useAiToolRun((s) => s.problems[key] ?? null);
  const modelSection = useRef<HTMLDivElement>(null);

  const [pre, setPre] = useState(true);
  const [cleanup, setCleanup] = useState<Record<CleanupKey, boolean>>({ fillers: true, pauses: true, repeats: true });
  const [stale, setStale] = useState({ edited: true, cut: true });

  const [platform, setPlatform] = useState('');
  // 写博客的「添加关键帧插图」：默认不加；画面只有 Agent 取得到，直接调模型时置灰、也不进模板。
  const [frames, setFrames] = useState(false);
  const framesOn = tool === 'blog' && frames && !viaModel;
  const [count, setCount] = useState<number>(tool === 'cover' ? COVER_COUNT.initial : TITLE_COUNT.initial);
  const [idea, setIdea] = useState('');
  const [ratio, setRatio] = useState<CoverRatio>('project');
  const [coverText, setCoverText] = useState<CoverText>('phrase');
  const projectRatio = canvasRatio(sequence.canvas.width, sequence.canvas.height);

  // 重新转录的「更多选项 › 识别说话人」（设计稿 panel-aitools.jsx）：按生效的默认语音模型说；只改提示词，
  // 「说话人区分」没装也不拦「交给 Agent」。
  const asrView = useModels((s) => s.capabilities);
  const asrRef = tool === 'retranscribe' ? (asrView?.transcribe.effective ?? null) : null;
  const asrInfo = asrView && asrRef ? transcribeModelInfo(asrView, asrRef) : null;
  const asrBundle = useModels((s) => (asrRef?.providerId === 'local' ? s.bundles.find((b) => b.bundleId === asrRef.modelId) : undefined));
  const [speakerPick, setSpeakerPick] = useState<boolean | null>(null);
  const speakers = useSpeakerState(asrInfo, speakerPick);

  const extra: (string | null)[] = writing
    ? writingExtra(tool, {
        scope,
        platform,
        idea,
        ratio: ratio === 'project' ? projectRatio : ratio,
        coverText,
        frames: framesOn,
      })
    : [
        tool === 'chapters' && pre && !viaModel ? C.chaptersPolishFirst : null,
        ...(tool === 'cleanup' ? cleanupExtra(cleanup) : []),
        tool === 'stale' && preset?.language ? C.staleOnly(preset.language) : null,
        tool === 'retranscribe' && speakers.s.step ? C.retranscribeSpeakers : null,
      ];
  const intent = intentPrompt({
    tool,
    title: ref?.name ?? null,
    scope: writing ? null : scope,
    edited: tool === 'stale' ? stale.edited : undefined,
    cut: tool === 'stale' ? stale.cut : undefined,
    count: tool === 'title' || tool === 'cover' ? count : null,
    extra,
  });
  // 语言写在模板里：跟文稿（用户要别的语言就改这一句）。
  const template = toolTemplate(tool, intent);
  const staleEmpty = tool === 'stale' && !stale.edited && !stale.cut;

  // 直接调模型：发给模型的是哪份转写、范围里几段（口径同文稿面板）。
  const speech = useMemo(() => Object.values(documents).find((d) => d.kind === 'speech' && !!d.sourceAssetId) ?? null, [documents]);
  const speechBody = useDocumentBody(viaModel && speech ? speech : undefined);
  const range = viaModel && directHasScope(viaModel) && scopeIndex >= 0 ? chapters[scopeIndex]! : null;
  const paragraphs = useMemo(() => {
    const assetId = speech?.sourceAssetId;
    const read = speechBody === undefined || !assetId ? null : readSpeechWords(speechBody);
    return read && assetId ? transcriptParagraphs(transcriptWords(sequence, assetId, read.words)) : [];
  }, [speechBody, speech, sequence]);
  const direct: DirectPrompt | null = viaModel
    ? {
        context: {
          tool: viaModel,
          paragraphs: scopedParagraphs(paragraphs, range),
          scope: range ? scope : null,
          chapters: chapters.length,
        },
        model: { name: model.name, local: model.local, ready: model.ready },
        picker: <DirectModelPicker model={model} />,
        gate: (
          <div ref={modelSection}>
            <DirectModelGate model={model} />
          </div>
        ),
        onNotReady: () => {
          // 不灰掉按钮：说清楚差什么，把门卡带到眼前（同翻译页）。
          modelSection.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          ToastQueue.neutral(model.selected?.why ?? C.noTextModel, { timeout: 4000 });
        },
        onStart: (prompt, attachments, skills) =>
          startAiTool(
            directParams({
              videoId,
              tool: viaModel,
              prompt,
              range: range ? { start: range.start, end: range.end } : null,
              documentId: speech?.id ?? null,
              attachments,
              skills,
              model: model.ref,
              uiLanguage: getLocale(),
            }),
            model.name ?? '',
          ),
      }
    : null;

  // 直接调模型跑着、出了结果或收据：这一页换成那一态（同识别说话人的四态页），「完成」回到设置态。
  if (kind && (run || result || receipt)) {
    return (
      <>
        <PanelHead title={info.name} back={{ label: C.back, onPress: onBack }} />
        <div className={`${body} bc-scroll`}>
          {run ? (
            <DirectRunView run={run} />
          ) : result ? (
            <DirectResultView runKey={key} result={result} model={result.summary.modelId} />
          ) : receipt ? (
            <DirectReceiptView runKey={key} receipt={receipt} />
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHead title={info.name} back={{ label: C.back, onPress: onBack }} />
      <div className={`${body} bc-scroll`}>
        {problem ? (
          <div className={problemBox}>
            <DirectProblem runKey={key} problem={problem} />
          </div>
        ) : null}
        <div className={card}>
          <span className={cardTitle}>{info.name}</span>
          {(info.setup ?? [info.desc]).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span className={effect}>
            <InfoCircle styles={effectIcon} />
            {toolEffect(tool)}
          </span>
        </div>

        {tool === 'cover' ? (
          <>
            <h3 className={secHead}>{C.coverIdea}</h3>
            <TextField aria-label={C.coverIdea} size="S" styles={field} placeholder={C.coverIdeaPlaceholder} value={idea} onChange={setIdea} />
          </>
        ) : null}

        <div className={rows}>
          <AgentUseRow
            handoff={handoff}
            tool={tool}
            runner={runner}
            onRunner={(next) => setRunner(tool, next)}
            modelName={model.name}
          />

          {(viaModel ? directHasScope(viaModel) : hasScope(tool)) ? (
            <Row label={C.scope}>
              <Picker
                aria-label={C.scope}
                size="S"
                styles={field}
                isDisabled={!chapters.length}
                selectedKey={scopeIndex >= 0 ? scopeKey : 'all'}
                onSelectionChange={(key) => setScopeKey(String(key ?? 'all'))}>
                {[
                  <PickerItem key="all" id="all">
                    {C.scopeAll}
                  </PickerItem>,
                  ...chapters.map((c, i) => (
                    <PickerItem key={c.id} id={c.id}>
                      {C.scopeChapter(i + 1, c.label)}
                    </PickerItem>
                  )),
                ]}
              </Picker>
              {chapters.length ? null : <p className={hint}>{C.scopeNoChapters}</p>}
            </Row>
          ) : null}

          {tool === 'blog' ? (
            <Option
              label={C.framesLabel}
              sub={viaModel ? C.framesSubModel : C.framesSub}
              isSelected={framesOn}
              isDisabled={!!viaModel}
              onChange={setFrames}
            />
          ) : null}
          {viaModel ? null : <SessionRow handoff={handoff} />}

          {tool === 'chapters' && !viaModel ? <Option label={C.prePolish} sub={pre ? C.prePolishOn : C.prePolishOff} isSelected={pre} onChange={setPre} /> : null}
          {tool === 'cleanup' ? (
            <div className={options}>
              {CLEANUP_OPTIONS.map((o) => (
                <Option key={o.key} label={o.label} sub={o.sub} isSelected={cleanup[o.key]} onChange={(on) => setCleanup((c) => ({ ...c, [o.key]: on }))} />
              ))}
            </div>
          ) : null}
          {tool === 'stale' ? (
            <div className={options}>
              <Option label={C.staleEdited} sub={C.staleEditedSub} isSelected={stale.edited} onChange={(on) => setStale((s) => ({ ...s, edited: on }))} />
              <Option label={C.staleCut} sub={C.staleCutSub} isSelected={stale.cut} onChange={(on) => setStale((s) => ({ ...s, cut: on }))} />
              {staleEmpty ? <p className={hint}>{C.staleNone}</p> : null}
            </div>
          ) : null}
          {tool === 'retranscribe' ? <p className={hint}>{C.retranscribeModel}</p> : null}
          {asrInfo ? (
            <AsrMoreOptions state={speakers} name={asrBundle ? bundleName(asrBundle) : asrInfo.label} onPick={setSpeakerPick} />
          ) : null}

          {tool === 'title' || tool === 'cover' ? (
            <Row label={tool === 'title' ? C.titleCount : C.coverCount}>
              <NumberField
                aria-label={tool === 'title' ? C.titleCount : C.coverCount}
                size="S"
                minValue={tool === 'title' ? TITLE_COUNT.min : COVER_COUNT.min}
                maxValue={tool === 'title' ? TITLE_COUNT.max : COVER_COUNT.max}
                step={1}
                value={count}
                onChange={(n) => Number.isFinite(n) && setCount(n)}
              />
              {tool === 'title' ? <p className={hint}>{C.titleCountNote(TITLE_COUNT.min, TITLE_COUNT.max)}</p> : null}
            </Row>
          ) : null}
          {tool === 'cover' ? (
            <>
              <Row label={C.coverRatio}>
                <Picker aria-label={C.coverRatio} size="S" styles={field} selectedKey={ratio} onSelectionChange={(key) => key && setRatio(key as CoverRatio)}>
                  {COVER_RATIOS.map((r) => (
                    <PickerItem key={r} id={r}>
                      {r === 'project' ? E.withNote(C.coverRatioProject, projectRatio) : r}
                    </PickerItem>
                  ))}
                </Picker>
              </Row>
              <Row label={C.coverText}>
                <Picker
                  aria-label={C.coverText}
                  size="S"
                  styles={field}
                  selectedKey={coverText}
                  onSelectionChange={(key) => key && setCoverText(key as CoverText)}>
                  {COVER_TEXT.map((m) => (
                    <PickerItem key={m.key} id={m.key}>
                      {m.label}
                    </PickerItem>
                  ))}
                </Picker>
              </Row>
            </>
          ) : null}
          {tool === 'title' || tool === 'desc' ? (
            <Row label={C.platform}>
              <TextField aria-label={C.platform} size="S" styles={field} placeholder={C.platformPlaceholder} value={platform} onChange={setPlatform} />
            </Row>
          ) : null}
        </div>

        <AiToolPrompt
          key={tool}
          videoId={videoId}
          tool={tool}
          template={template}
          handoff={handoff}
          isDisabled={staleEmpty}
          onDone={onBack}
          direct={direct}
        />
      </div>
    </>
  );
}
