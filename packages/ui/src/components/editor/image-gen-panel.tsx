import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssetRecord, Id, JobRecord, ModelCapabilitiesView, Sequence } from '@baocut/protocol';
import { ActionButton, ActionMenu, Button, MenuItem, NumberField, Text, TextField, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import ImageAdd from '@react-spectrum/s2/icons/ImageAdd';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { frameAt } from '../../model/editor.ts';
import { isPlaceable, placeAsset } from '../../model/editor-ops.ts';
import {
  editorImageRequest,
  effectiveImageDraft,
  fittedAspect,
  outputAsset,
  videoGenerationJobs,
  type EditorImageDraft,
} from '../../model/media-generation.ts';
import { cancellationCost } from '../../model/task-facts.ts';
import {
  againDraft,
  aspectOptions,
  countFor,
  IMAGE_SAMPLES,
  imageBatchMeta,
  imageFallback,
  imageModelLine,
  imageModelOptions,
  imageProblems,
  imagePrompt,
  imageResults,
  imageStatus,
  sizeKeyFor,
  stepsFor,
  switchImageModel,
  type ImageOption,
  type ImageResult,
} from '../../model/tools-image.ts';
import { codePoints, findOption, initialModelKey, providerName } from '../../model/tools-models.ts';
import { didNotFinish, listedRecords, recordStatus, stateLabel } from '../../model/tools-records.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { CancelledCard, ErrorCard, RunningCard } from '../tools/image-record.tsx';
import { LocalModelGate } from '../tools/local-model-gate.tsx';
import { ModelGate, ModelLine } from '../tools/tool-model.tsx';
import { Gate, recordHead, recordRow, SectionLink, submitOnModEnter, ToolTextArea } from '../tools/tool-parts.tsx';
import { GATE_COPY, IMAGE_COPY, RECORD_COPY } from '../tools/tools-copy.ts';
import { copyText, useArtifactUrl, useSubmitFailed } from '../tools/use-tool-records.ts';
import { useNow } from '../use-now.ts';
import { useEditorActions } from './editor-context.tsx';
import { IMAGE_GEN_COPY as C } from './media-gen-copy.ts';
import { useMediaGen, useMediaGenStore } from './media-gen-store.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

/*
 * 图片 Tab 的「AI 生成」段（设计稿 panel-image-gen.jsx `ImageGenPane`）：工具页那张表单压扁一点，多一颗「跟视频画布」画幅；
 * 下面是这个视频最近 3 批结果。生成走 `models.generateImage` 带 `videoId`：做完由 Runtime 直接收进这个视频的素材库
 * （设计稿里「收进素材库」那一步因此成了状态），「放到画布」放在播放头处。参考图这一版的接口不带，置灰写原因。
 */

const FIT = '__fit';

/** 放在图片页「AI 生成」那一段的页签面板里：撑满面板、自己滚动。 */
const body = style({ boxSizing: 'border-box', height: 'full', overflowY: 'auto', paddingX: 12, paddingTop: 4, paddingBottom: 16 });
const secHead = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 });
const secTitle = style({ flexGrow: 1, margin: 0, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const hint = style({ margin: 0, marginTop: '[6px]', font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]', overflowWrap: 'anywhere' });
const field = style({ width: 'full' });
const textFoot = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, minWidth: 0 });
const textStat = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: { default: 'gray-600', isOver: 'red-900' } });
const gateWrap = style({ marginTop: 12 });
const refs = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8, minWidth: 0 });
const refsNote = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-600' });
const aspects = style({ display: 'grid', gridTemplateColumns: '[repeat(auto-fill, minmax(72px, 1fr))]', gap: 8 });
const aspect = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  paddingX: 4,
  paddingY: 8,
  borderRadius: 'default',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-400', isSelected: 'blue-800' },
  backgroundColor: { default: 'gray-25', isSelected: 'blue-100' },
  color: 'gray-900',
  cursor: 'default',
  transition: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const aspectBox = style({ display: 'block', borderWidth: 2, borderStyle: { default: 'solid', isFit: 'dashed' }, borderColor: 'gray-600', borderRadius: 'sm' });
const aspectName = style({ font: 'ui-xs', fontWeight: 'bold', textAlign: 'center' });
const aspectSub = style({ font: 'ui-xs', color: 'gray-600', textAlign: 'center' });
const countRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const countField = style({ width: 112 });
const goRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 16,
  paddingTop: 12,
  borderTopWidth: 1,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const goStatus = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: { default: 'gray-700', isBad: 'orange-1000' }, overflowWrap: 'anywhere' });
const records = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const batch = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const batchMeta = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const batchState = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const grid = style({ display: 'grid', gridTemplateColumns: { default: '[repeat(2, minmax(0, 1fr))]', isOne: '[minmax(0, 1fr)]' }, gap: 8 });
const card = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, minWidth: 0 });
const thumb = style({
  display: 'grid',
  placeItems: 'center',
  width: 'full',
  overflow: 'hidden',
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const img = style({ display: 'block', width: 'full', height: 'full', objectFit: 'contain' });
const small = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const signpost = style({
  marginTop: 16,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'ui-xs',
  color: 'gray-700',
  lineHeight: '[1.5]',
});

/** 画幅示意框：长边 18px（设计稿 `AspectRow` 的 `box`）。 */
function boxSize(ratio: number): { width: number; height: number } {
  return ratio >= 1 ? { width: 18, height: Math.max(6, Math.round(18 / ratio)) } : { width: Math.max(6, Math.round(18 * ratio)), height: 18 };
}

export function ImageGenPane({ videoId, sequence, assets }: { videoId: Id; sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const runtime = useRuntime();
  const goTo = useShell((s) => s.go);
  const view = useModels((s) => s.capabilities);
  const state = useMediaGen(videoId);
  const patch = useMediaGenStore((s) => s.patch);
  const patchImage = useMediaGenStore((s) => s.patchImage);
  const ready = useJobs((s) => s.ready);
  const jobs = useJobs((s) => s.jobs);
  const hidden = useTools((s) => s.hidden);
  const editable = useVideo((s) => canEdit(s.video));
  const now = useNow(30_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sample, setSample] = useState(0);
  const submitFailed = useSubmitFailed('generateImage', IMAGE_COPY.submitFailed);
  const draft = state.img;
  const canvas = sequence.canvas;

  const options = useMemo(() => (view ? imageModelOptions(view) : []), [view]);
  const option = findOption(options, initialModelKey(options, draft.model, view?.generateImage.effective ?? null, imageFallback));
  const effective = option ? effectiveImageDraft(draft, option.info, canvas) : draft;
  const status = imageStatus(effective, option, tried);
  const toConnect = () => goTo({ tab: 'models', category: 'image', page: 'cloud' });
  const toLocal = () => goTo({ tab: 'models', category: 'image', page: 'local' });
  const listed = useMemo(() => listedRecords(videoGenerationJobs(jobs, videoId, 'generateImage', hidden)), [jobs, videoId, hidden]);
  const shown = state.allImages ? listed : listed.slice(0, 3);

  const generate = () => {
    setTried(true);
    if (!option || !option.usable || submitting || !editable) return;
    const problems = imageProblems(effective, option);
    if (problems.length) {
      ToastQueue.neutral(problems[0]!, { timeout: 4000 });
      return;
    }
    setSubmitting(true);
    runtime
      .generateImage(editorImageRequest(draft, option, videoId, canvas))
      .then(() => ToastQueue.positive(IMAGE_COPY.submitted, { timeout: 3000 }), submitFailed)
      .finally(() => setSubmitting(false));
  };

  // 「再来一版」：带回那一批的提示词与设置（画幅按那一批的，不再跟画布），种子留空。
  const again = (job: JobRecord) => {
    const next = againDraft(job);
    if (!next) return;
    patchImage(videoId, { ...next, fit: false });
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    ToastQueue.neutral(IMAGE_COPY.againDone, { timeout: 3000 });
  };

  const maxChars = option?.info.maxPromptChars ?? 0;
  const chars = codePoints(draft.prompt.trim());

  return (
    <div ref={scrollRef} className={`${body} bc-scroll`} onKeyDown={submitOnModEnter(generate)}>
      {view && !options.some((o) => o.usable) ? (
        <div className={gateWrap}>
          <Gate
            title={C.noModelTitle}
            body={C.noModelBody}
            actions={
              <>
                <Button variant="accent" size="S" onPress={toConnect}>
                  {C.connect}
                </Button>
                <Button variant="secondary" size="S" onPress={toLocal}>
                  {C.downloadLocal}
                </Button>
              </>
            }
          />
        </div>
      ) : null}

      <SubHead title={IMAGE_COPY.promptLabel} />
      <ToolTextArea
        compact
        label={IMAGE_COPY.promptLabel}
        value={draft.prompt}
        onChange={(prompt) => patchImage(videoId, { prompt })}
        placeholder={IMAGE_COPY.promptPlaceholder}
      />
      <div className={textFoot}>
        <span className={textStat({ isOver: maxChars > 0 && chars > maxChars })}>{maxChars ? C.charCount(chars, maxChars) : C.charCountPlain(chars)}</span>
        {draft.prompt ? (
          <SectionLink onPress={() => patchImage(videoId, { prompt: '' })}>{IMAGE_COPY.clear}</SectionLink>
        ) : (
          <SectionLink
            onPress={() => {
              patchImage(videoId, { prompt: IMAGE_SAMPLES[sample % IMAGE_SAMPLES.length]! });
              setSample(sample + 1);
            }}>
            {IMAGE_COPY.sample}
          </SectionLink>
        )}
      </div>
      <div className={refs}>
        <Button variant="secondary" size="S" isDisabled>
          <ImageAdd />
          <Text>{IMAGE_COPY.pickRefs}</Text>
        </Button>
        <span className={refsNote}>{IMAGE_COPY.refsNote}</span>
      </div>

      {options.length ? (
        <>
          <SubHead title={IMAGE_COPY.model} aside={<SectionLink onPress={toConnect}>{IMAGE_COPY.manage}</SectionLink>} />
          <ModelLine
            label={IMAGE_COPY.modelPicker}
            options={options}
            selected={option}
            disableUnusable
            onSelect={(o) => patchImage(videoId, switchImageModel(draft, o))}
            factsOf={(o) => imageModelLine(o.info)}
          />
          <ModelGate
            selected={option}
            options={options}
            body={GATE_COPY.imageBody}
            onConnect={toConnect}
            onSwitch={(o) => patchImage(videoId, switchImageModel(draft, o))}
          />
          <LocalModelGate selected={option} options={options} onSwitch={(o) => patchImage(videoId, switchImageModel(draft, o))} />
        </>
      ) : null}

      {option ? <ImageOptions key={option.key} videoId={videoId} draft={draft} option={option} canvas={canvas} /> : null}

      <div className={goRow}>
        <span className={goStatus({ isBad: status.bad })} role="status" aria-live="polite">
          {editable ? status.text : C.readOnly}
        </span>
        <Button variant="accent" size="S" isDisabled={!option?.usable || !editable} isPending={submitting} onPress={generate}>
          <ImageIcon />
          <Text>{IMAGE_COPY.submit}</Text>
        </Button>
      </div>

      <SubHead
        title={C.recent}
        aside={
          listed.length > 3 ? (
            <SectionLink onPress={() => patch(videoId, { allImages: !state.allImages })}>{state.allImages ? C.fewer : C.all(listed.length)}</SectionLink>
          ) : null
        }
      />
      {!ready ? (
        <p className={hint}>{RECORD_COPY.loadingMedia}</p>
      ) : shown.length ? (
        <div className={records}>
          {shown.map((job) => (
            <VideoImageRecord
              key={job.jobId}
              job={job}
              all={jobs}
              view={view}
              now={now}
              videoId={videoId}
              sequence={sequence}
              assets={assets}
              editable={editable}
              onAgain={again}
            />
          ))}
        </div>
      ) : (
        <p className={hint}>{C.empty}</p>
      )}
      <p className={signpost}>{C.foot}</p>
    </div>
  );
}

function SubHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className={secHead}>
      <h3 className={secTitle}>{title}</h3>
      {aside}
    </div>
  );
}

/** 画幅（「跟视频画布」在最前）、数量、高级（种子；本机模型另有步数）。 */
function ImageOptions({
  videoId,
  draft,
  option,
  canvas,
}: {
  videoId: Id;
  draft: EditorImageDraft;
  option: ImageOption;
  canvas: { width: number; height: number };
}) {
  const patchImage = useMediaGenStore((s) => s.patchImage);
  const patch = (p: Partial<EditorImageDraft>) => patchImage(videoId, p);
  const info = option.info;
  const sizes = aspectOptions(info);
  const fitted = fittedAspect(info, canvas);
  const selected = draft.fit && fitted ? FIT : sizeKeyFor(draft, info);
  const stepRange = info.local?.steps ?? null;
  return (
    <>
      <SubHead title={IMAGE_COPY.aspect} />
      {sizes.length ? (
        <ToggleButtonGroup
          aria-label={IMAGE_COPY.aspect}
          className={aspects}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selected ? [selected] : []}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next === undefined) return;
            if (next === FIT) patch({ fit: true });
            else patch({ fit: false, size: String(next) });
          }}>
          {fitted ? (
            <ToggleButton id={FIT} className={(rp) => aspect(rp)}>
              <span className={aspectBox({ isFit: true })} style={boxSize(canvas.width / canvas.height)} aria-hidden />
              <span className={aspectName}>{C.fit}</span>
              <span className={aspectSub}>{fitted.label}</span>
            </ToggleButton>
          ) : null}
          {sizes.map((a) => (
            <ToggleButton key={a.key} id={a.key} className={(rp) => aspect(rp)}>
              <span className={aspectBox({ isFit: false })} style={boxSize(a.ratio)} aria-hidden />
              <span className={aspectName}>{a.label}</span>
              {a.sub ? <span className={aspectSub}>{a.sub}</span> : null}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : (
        <p className={hint}>{IMAGE_COPY.aspectAuto}</p>
      )}

      {info.maxCount > 1 ? (
        <>
          <SubHead title={IMAGE_COPY.count} />
          <div className={countRow}>
            <NumberField
              aria-label={IMAGE_COPY.count}
              size="S"
              styles={countField}
              minValue={1}
              maxValue={info.maxCount}
              step={1}
              value={countFor(draft, info)}
              onChange={(count) => Number.isFinite(count) && patch({ count })}
            />
            <span className={refsNote}>{IMAGE_COPY.countNote(info.maxCount)}</span>
          </div>
        </>
      ) : null}

      {info.acceptsSeed || stepRange ? (
        <>
          <SubHead
            title={IMAGE_COPY.advanced}
            aside={<SectionLink onPress={() => patch({ advanced: !draft.advanced })}>{draft.advanced ? IMAGE_COPY.collapse : IMAGE_COPY.expand}</SectionLink>}
          />
          {draft.advanced ? (
            <>
              {info.acceptsSeed ? (
                <>
                  <TextField
                    label={IMAGE_COPY.seed}
                    size="S"
                    styles={field}
                    inputMode="numeric"
                    placeholder={IMAGE_COPY.seedPlaceholder}
                    value={draft.seed}
                    onChange={(seed) => patch({ seed: seed.replace(/[^\d]/g, '') })}
                  />
                  <p className={hint}>{option.local ? IMAGE_COPY.seedNoteLocal : IMAGE_COPY.seedNote}</p>
                </>
              ) : null}
              {stepRange ? (
                <>
                  <NumberField
                    label={IMAGE_COPY.steps}
                    size="S"
                    styles={countField}
                    minValue={stepRange.min}
                    maxValue={stepRange.max}
                    step={stepRange.step}
                    value={stepsFor(draft, info) ?? stepRange.default}
                    onChange={(steps) => Number.isFinite(steps) && patch({ steps })}
                  />
                  <p className={hint}>{IMAGE_COPY.stepsNote(stepRange.default)}</p>
                </>
              ) : null}
            </>
          ) : (
            <p className={hint}>
              {[info.acceptsSeed ? IMAGE_COPY.seed : null, stepRange ? IMAGE_COPY.steps : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </>
      ) : null}
    </>
  );
}

/** 一条生图记录：在跑、没做成、取消了但可能计费的卡与工具页同一套；做完的一批换成编辑器里的动作。 */
function VideoImageRecord({
  job,
  all,
  view,
  now,
  videoId,
  sequence,
  assets,
  editable,
  onAgain,
}: {
  job: JobRecord;
  all: readonly JobRecord[];
  view: ModelCapabilitiesView | null;
  now: number;
  videoId: Id;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  editable: boolean;
  onAgain: (job: JobRecord) => void;
}) {
  const provider = providerName(view, 'generateImage', job.providerId);
  if (job.state === 'cancelled') {
    const cost = job.cancellation ? cancellationCost(job.cancellation) : null;
    return cost ? <CancelledCard job={job} cost={cost} /> : null;
  }
  const status = recordStatus(job);
  if (status === 'queued' || status === 'running') return <RunningCard job={job} all={all} provider={provider} />;
  if (didNotFinish(job)) return <ErrorCard job={job} videoId={videoId} />;
  return <DoneBatch job={job} provider={provider} now={now} sequence={sequence} assets={assets} editable={editable} onAgain={onAgain} />;
}

function DoneBatch({
  job,
  provider,
  now,
  sequence,
  assets,
  editable,
  onAgain,
}: {
  job: JobRecord;
  provider: string;
  now: number;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  editable: boolean;
  onAgain: (job: JobRecord) => void;
}) {
  const goTo = useShell((s) => s.go);
  const hide = useTools((s) => s.hide);
  const results = imageResults(job);
  const meta = imageBatchMeta(job, provider);
  const act = (key: string) => {
    if (key === 'copy') copyText(imagePrompt(job));
    else if (key === 'task') goTo({ tab: 'tasks', taskId: job.jobId });
    else if (key === 'remove') {
      hide(job.jobId);
      ToastQueue.neutral(RECORD_COPY.removed(meta), { timeout: 4000 });
    }
  };
  return (
    <section className={batch} aria-label={meta}>
      <div className={recordHead}>
        <span className={batchMeta} title={`${meta}\n${imagePrompt(job)}`}>
          {meta}
        </span>
        <span className={batchState}>{stateLabel(job, now)}</span>
        <ActionMenu aria-label={RECORD_COPY.more} isQuiet size="S" onAction={(key) => act(String(key))}>
          <MenuItem id="copy" textValue={RECORD_COPY.copyPrompt}>
            <Copy />
            <Text slot="label">{RECORD_COPY.copyPrompt}</Text>
          </MenuItem>
          <MenuItem id="task" textValue={RECORD_COPY.task}>
            <OpenIn />
            <Text slot="label">{RECORD_COPY.task}</Text>
          </MenuItem>
          <MenuItem id="remove" textValue={RECORD_COPY.remove}>
            <Delete />
            <Text slot="label">{RECORD_COPY.remove}</Text>
            <Text slot="description">{RECORD_COPY.removeNote}</Text>
          </MenuItem>
        </ActionMenu>
      </div>
      {results.length ? (
        <div className={grid({ isOne: results.length === 1 })}>
          {results.map((r) => (
            <ImageCard key={r.artifactId} job={job} result={r} sequence={sequence} assets={assets} editable={editable} onAgain={onAgain} />
          ))}
        </div>
      ) : (
        <span className={small}>{RECORD_COPY.noFile}</span>
      )}
    </section>
  );
}

/** 一张结果（设计稿 `ImageCard` 的四个动作）：放到画布 · 已在素材库（状态）· 用作参考（置灰）· 再来一版。 */
function ImageCard({
  job,
  result,
  sequence,
  assets,
  editable,
  onAgain,
}: {
  job: JobRecord;
  result: ImageResult;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  editable: boolean;
  onAgain: (job: JobRecord) => void;
}) {
  const { apply } = useEditorActions();
  const media = useArtifactUrl(result.artifactId);
  const assetId = outputAsset(job, result.artifactId);
  const asset = assetId ? (assets[assetId] ?? null) : null;
  const placeable = asset && isPlaceable(asset) ? asset : null;
  const prompt = imagePrompt(job);
  const place = () => {
    if (!placeable) return;
    void apply(placeAsset(sequence, placeable, frameAt(useEditor.getState().playhead, sequence.fps)), E.addClip);
  };
  return (
    <figure className={card}>
      <div className={thumb} style={{ aspectRatio: `${result.width || 1} / ${result.height || 1}` }}>
        {media?.status === 'ready' ? (
          <img className={img} src={media.url} alt={E.labeled(asset?.name ?? result.name, prompt)} loading="lazy" />
        ) : (
          <span className={small}>{media?.status === 'failed' ? RECORD_COPY.openFailed(media.message) : RECORD_COPY.loadingMedia}</span>
        )}
      </div>
      <span className={small} title={asset?.name ?? result.meta}>
        {asset ? `${C.inLibrary} · ${result.meta}` : C.importing}
      </span>
      <div className={recordRow}>
        <TooltipTrigger>
          <ActionButton size="S" isDisabled={!placeable || !editable} onPress={place}>
            <Add />
            <Text>{C.place}</Text>
          </ActionButton>
          <Tooltip>{C.placeTip}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={IMAGE_COPY.again} onPress={() => onAgain(job)}>
            <Refresh />
          </ActionButton>
          <Tooltip>{IMAGE_COPY.again}</Tooltip>
        </TooltipTrigger>
        <ActionButton isQuiet size="S" aria-label={E.withNote(C.useAsRef, IMAGE_COPY.refsNote)} isDisabled>
          <ImageAdd />
        </ActionButton>
      </div>
    </figure>
  );
}
