import { useMemo, useState, type ReactNode } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import {
  Badge,
  Button,
  Checkbox,
  NumberField,
  Picker,
  PickerItem,
  Radio,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  TextArea,
  TextField,
} from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
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
  LENGTHS,
  STYLES,
  TITLE_COUNT,
  VIEWS,
  writingExtra,
  type AgentToolId,
  type CleanupKey,
  type CoverRatio,
  type CoverText,
  type WriteLength,
  type WriteStyle,
  type WriteView,
} from '../../model/ai-tools.ts';
import { chapterPieces } from '../../model/export-range.ts';
import { gateGuide, homeGate } from '../../model/home-brief.ts';
import { COMMON_LANGUAGES } from '../../model/library-glossary.ts';
import { bundleName } from '../../model/models-local.ts';
import { langName } from '../../model/tools-models.ts';
import { transcribeModelInfo } from '../../model/transcribe-speakers.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { AsrMoreOptions, useSpeakerState } from '../tools/asr-more-options.tsx';
import { AgentGateLine } from './agent-gate-line.tsx';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { handToAgent } from './ai-tools-handoff.ts';
import type { AiToolPreset } from './ai-tools-nav.ts';
import { PanelHead } from './panel-head.tsx';
import { EDITOR_COPY as E } from './editor-copy.ts';

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
const preview = style({
  margin: 0,
  padding: 12,
  borderRadius: 'default',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-sm',
  color: 'gray-900',
  lineHeight: '[1.6]',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
});
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
const badgeIcon = iconStyle({ size: 'XS' });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={row}>
      <span className={rowLabel}>{label}</span>
      <div className={rowBody}>{children}</div>
    </div>
  );
}

function Option({ label, sub, isSelected, onChange }: { label: string; sub: string; isSelected: boolean; onChange(on: boolean): void }) {
  return (
    <div className={option}>
      <Checkbox size="S" isSelected={isSelected} onChange={onChange}>
        {label}
      </Checkbox>
      <span className={optionSub}>{sub}</span>
    </div>
  );
}

/** 写作的语言：写作两件跟界面语言（中文），发布三件跟文稿；文稿是表外的语言时补进表里。 */
function useLanguages(tool: AgentToolId, documents: Record<Id, DocumentRecord>) {
  const speech = Object.values(documents).find((d) => d.kind === 'speech')?.language ?? null;
  const publish = tool === 'title' || tool === 'desc' || tool === 'cover';
  const initial = publish && speech ? speech : 'zh';
  const list = speech && !COMMON_LANGUAGES.includes(speech) ? [speech, ...COMMON_LANGUAGES] : [...COMMON_LANGUAGES];
  return { initial, list, why: publish && speech ? C.languagePublish : C.languageWrite };
}

/**
 * 交给 Agent 的工具页（原型 panel-aitools.jsx `DocFlow`、panel-aitools-write.jsx、panel-aitools-cover.jsx 的设置态）：
 * 说明卡、「用」（直接调模型置灰写原因）、范围、各工具的勾选项与要求，下面是会发给 Agent 的那句话。
 * 设置态就是确认：主按钮「交给 Agent」直接发到这个视频的会话、工具页回到来处；没有可用的 Agent 时「用」下面多一行去启用或连接。
 */
export function AiAgentToolPage({
  tool,
  preset,
  sequence,
  documents,
  onBack,
}: {
  tool: AgentToolId;
  preset: AiToolPreset | null;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  onBack(): void;
}) {
  const runtime = useRuntime();
  const ref = useVideo((s) => s.video?.ref ?? null);
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const guide = gateGuide(homeGate(drivers, checking));
  const info = aiTool(tool);
  const writing = isWritingTool(tool);

  const chapters = useMemo(() => chapterPieces(sequence), [sequence]);
  const [scopeKey, setScopeKey] = useState<string>('all');
  const scopeIndex = chapters.findIndex((c) => c.id === scopeKey);
  const scope = scopeIndex >= 0 ? C.scopeChapter(scopeIndex + 1, chapters[scopeIndex]!.label) : null;

  const [pre, setPre] = useState(true);
  const [note, setNote] = useState('');
  const [cleanup, setCleanup] = useState<Record<CleanupKey, boolean>>({ fillers: true, pauses: true, repeats: true });
  const [stale, setStale] = useState({ edited: true, cut: true });

  const languages = useLanguages(tool, documents);
  const [length, setLength] = useState<WriteLength>('medium');
  const [styleKey, setStyleKey] = useState<WriteStyle>('plain');
  const [customStyle, setCustomStyle] = useState('');
  const [view, setView] = useState<WriteView>('auto');
  const [language, setLanguage] = useState(languages.initial);
  const [platform, setPlatform] = useState('');
  const [count, setCount] = useState<number>(tool === 'cover' ? COVER_COUNT.initial : TITLE_COUNT.initial);
  const [idea, setIdea] = useState('');
  const [ratio, setRatio] = useState<CoverRatio>('project');
  const [coverText, setCoverText] = useState<CoverText>('phrase');
  const projectRatio = canvasRatio(sequence.canvas.width, sequence.canvas.height);

  // 重新转录的「更多选项 › 识别说话人」（设计稿 panel-aitools.jsx）：按生效的默认语音模型说；只改发给 Agent 的那句话，
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
        length,
        style: styleKey,
        customStyle,
        language: langName(language),
        view,
        platform,
        idea,
        ratio: ratio === 'project' ? projectRatio : ratio,
        coverText,
        note,
      })
    : [
        tool === 'chapters' && pre ? C.chaptersPolishFirst : null,
        ...(tool === 'cleanup' ? cleanupExtra(cleanup) : []),
        tool === 'stale' && preset?.language ? C.staleOnly(preset.language) : null,
        tool === 'retranscribe' && speakers.s.step ? C.retranscribeSpeakers : null,
        note,
      ];
  const text = intentPrompt({
    tool,
    title: ref?.name ?? null,
    scope: writing ? null : scope,
    edited: tool === 'stale' ? stale.edited : undefined,
    cut: tool === 'stale' ? stale.cut : undefined,
    count: tool === 'title' || tool === 'cover' ? count : null,
    extra,
  });
  const staleEmpty = tool === 'stale' && !stale.edited && !stale.cut;

  const [busy, setBusy] = useState(false);
  const blocked = !!guide || !ref || staleEmpty;
  const send = async () => {
    setBusy(true);
    try {
      if (await handToAgent(runtime, ref, text)) onBack();
    } finally {
      setBusy(false);
    }
  };

  const notePlaceholder =
    tool === 'title' ? C.titleNotePlaceholder : tool === 'cover' ? C.coverNotePlaceholder : writing ? C.writeNotePlaceholder : C.notePlaceholder;
  const noteTitle = tool === 'title' ? C.titleNote : writing ? C.writeNote : C.noteTitle;

  return (
    <>
      <PanelHead title={info.name} back={{ label: C.back, onPress: onBack }}>
        <Badge size="S" variant="neutral">
          <AIMark styles={badgeIcon} data-bc-icons="own" />
          {C.byAgent}
        </Badge>
      </PanelHead>
      <div className={`${body} bc-scroll`}>
        <div className={card}>
          <span className={cardTitle}>{info.name}</span>
          {(info.setup ?? [info.desc]).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>

        {tool === 'cover' ? (
          <>
            <h3 className={secHead}>{C.coverIdea}</h3>
            <TextField aria-label={C.coverIdea} size="S" styles={field} placeholder={C.coverIdeaPlaceholder} value={idea} onChange={setIdea} />
          </>
        ) : null}

        <div className={rows}>
          <Row label={C.who}>
            <RadioGroup aria-label={C.who} size="S" value="agent">
              <Radio value="agent">
                {C.whoAgent} · {C.whoAgentSub}
              </Radio>
              <Radio value="model" isDisabled>
                {C.whoModel}
              </Radio>
            </RadioGroup>
            <p className={hint}>{C.whoModelSub}</p>
            {guide ? <AgentGateLine guide={guide} /> : null}
          </Row>

          {hasScope(tool) ? (
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

          {tool === 'chapters' ? <Option label={C.prePolish} sub={pre ? C.prePolishOn : C.prePolishOff} isSelected={pre} onChange={setPre} /> : null}
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
          {tool === 'summary' || tool === 'blog' || tool === 'desc' ? (
            <Row label={C.length}>
              <SegmentedControl aria-label={C.length} selectedKey={length} onSelectionChange={(key) => setLength(key as WriteLength)}>
                {LENGTHS.map((l) => (
                  <SegmentedControlItem key={l.key} id={l.key}>
                    {l.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </Row>
          ) : null}
          {writing ? (
            <Row label={C.style}>
              <Picker aria-label={C.style} size="S" styles={field} selectedKey={styleKey} onSelectionChange={(key) => key && setStyleKey(key as WriteStyle)}>
                {STYLES.map((s) => (
                  <PickerItem key={s.key} id={s.key}>
                    {s.label}
                  </PickerItem>
                ))}
              </Picker>
              {styleKey === 'custom' ? (
                <TextField aria-label={C.styleCustom} size="S" styles={field} placeholder={C.styleCustom} value={customStyle} onChange={setCustomStyle} />
              ) : null}
            </Row>
          ) : null}
          {tool === 'blog' || tool === 'desc' ? (
            <Row label={C.view}>
              <SegmentedControl aria-label={C.view} selectedKey={view} onSelectionChange={(key) => setView(key as WriteView)}>
                {VIEWS.map((v) => (
                  <SegmentedControlItem key={v.key} id={v.key}>
                    {v.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              {view === 'auto' ? <p className={hint}>{C.viewAuto}</p> : null}
            </Row>
          ) : null}
          {writing && tool !== 'cover' ? (
            <Row label={C.language}>
              <Picker aria-label={C.language} size="S" styles={field} selectedKey={language} onSelectionChange={(key) => key && setLanguage(String(key))}>
                {languages.list.map((code) => (
                  <PickerItem key={code} id={code}>
                    {langName(code)}
                  </PickerItem>
                ))}
              </Picker>
              {language === languages.initial ? <p className={hint}>{languages.why}</p> : null}
            </Row>
          ) : null}
          {tool === 'title' || tool === 'desc' ? (
            <Row label={C.platform}>
              <TextField aria-label={C.platform} size="S" styles={field} placeholder={C.platformPlaceholder} value={platform} onChange={setPlatform} />
            </Row>
          ) : null}
        </div>

        {tool === 'polish' || tool === 'retranscribe' || writing ? (
          <>
            <h3 className={secHead}>{noteTitle}</h3>
            {tool === 'title' ? (
              <TextField aria-label={noteTitle} size="S" styles={field} placeholder={notePlaceholder} value={note} onChange={setNote} />
            ) : (
              <TextArea aria-label={noteTitle} size="S" styles={field} placeholder={notePlaceholder} value={note} maxLength={500} onChange={setNote} />
            )}
          </>
        ) : null}

        <h3 className={secHead}>{C.preview}</h3>
        <p className={preview}>{text}</p>
      </div>
      <div className={footer}>
        <Button variant="accent" styles={field} isDisabled={blocked} isPending={busy} onPress={() => void send()}>
          {C.cta}
        </Button>
        <p className={hint}>{ref ? C.ctaHint : C.ctaNoVideo}</p>
      </div>
    </>
  );
}
