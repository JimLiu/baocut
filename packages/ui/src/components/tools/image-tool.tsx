import { useMemo, useRef, useState } from 'react';
import type { JobRecord, SpaceEntry } from '@baocut/protocol';
import { ActionButton, Button, NumberField, Text, TextField, ToastQueue } from '@react-spectrum/s2';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import {
  againDraft,
  aspectOptions,
  countFor,
  IMAGE_SAMPLES,
  imageRefMode,
  imageHeaderChip,
  imageModelLine,
  imageProblems,
  imageRequest,
  imageFallback,
  imageGallery,
  imageModelOptions,
  imageStatus,
  sizeKeyFor,
  sizeTierOptions,
  tierFor,
  fixedSteps,
  stepsFor,
  switchImageModel,
  type ImageDraft,
  type ImageOption,
} from '../../model/tools-image.ts';
import { modelReason, saveTarget, withSaveDir } from '../../model/tool-frame.ts';
import { codePoints, findOption, initialModelKey } from '../../model/tools-models.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { ImageLightbox } from '../media/image-lightbox.tsx';
import { EmptyCard, PageStatus } from '../models/model-parts.tsx';
import { useNow } from '../use-now.ts';
import { ImageRecord } from './image-record.tsx';
import { ImageRefModeRow, ImageRefsRow, ImageRefsZone, imagePromptPlaceholder } from './image-refs.tsx';
import { M as IMG } from '../../model/tools-image-copy.ts';
import { LocalModelGate } from './local-model-gate.tsx';
import { ModelRow, SaveDirRow } from './tool-frame.tsx';
import {
  BarStatus,
  detail,
  detailGrow,
  detailOver,
  HeaderChip,
  hintText,
  Row,
  Section,
  SectionLink,
  SideFoot,
  SideHead,
  submitOnModEnter,
  ToolPage,
  ToolTextArea,
  Workbench,
} from './tool-parts.tsx';
import { FRAME_COPY, GALLERY_COPY, IMAGE_COPY, RECORD_COPY, SAVE_COPY } from './tools-copy.ts';
import { useSubmitFailed, useToolRecords } from './use-tool-records.ts';
import { useToolStatus } from './use-tool-status.ts';
import { useRerun } from './video-tool-parts.tsx';

/*
 * 设计稿 tool-image.jsx `ImageToolPage`（32-88）与 image-gen.jsx `ImageGenForm`（299-373）的云端与本机部分：
 * 提示词与参考图（从 Space 或文件选、拖进来；能以图为底重画的模型另有用法与改动幅度）、模型、画幅、数量、高级（种子；本机模型另有步数），
 * 右边生成记录。局域网节点这一版没有后端，置灰写原因。
 */

const textFoot = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const aspects = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
const aspect = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  minWidth: 72,
  paddingX: 8,
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
const aspectBox = style({ display: 'block', borderWidth: 2, borderStyle: 'solid', borderColor: 'gray-600', borderRadius: 'sm' });
const aspectName = style({ font: 'ui-sm', fontWeight: 'bold' });
const aspectSub = style({ font: 'ui-xs', color: 'gray-600' });
const countField = style({ width: 112 });
const seedField = style({ width: 140 });
const stepsField = style({ width: 112 });
const stepsFixed = style({ font: 'ui-sm', color: 'gray-800', flexShrink: 0 });

const SPACE_SOURCE = { kind: 'space' } as const;

/** 画幅示意框：长边 18px（设计稿 `AspectRow` 的 `box`）。 */
function boxSize(ratio: number): { width: number; height: number } {
  return ratio >= 1 ? { width: 18, height: Math.max(6, Math.round(18 / ratio)) } : { width: Math.max(6, Math.round(18 * ratio)), height: 18 };
}

/** 生成图片（云端与本机）。提交走 `models.generateImage`，记录是 `jobs` 主题里这类任务。 */
export function ImageTool() {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const view = useModels((s) => s.capabilities);
  const draft = useTools((s) => s.image);
  const patch = useTools((s) => s.patchImage);
  const records = useToolRecords('generateImage');
  const now = useNow(30_000);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitFailed = useSubmitFailed('generateImage', IMAGE_COPY.submitFailed);
  const [sample, setSample] = useState(0);
  const { saveDirectory } = useToolStatus();
  // 「更改…」选的目录只活在这一页（不写回设置）。
  const [saveOverride, setSaveOverride] = useState<string | null>(null);

  const options = useMemo(() => (view ? imageModelOptions(view) : []), [view]);
  const option = findOption(options, initialModelKey(options, draft.model, view?.generateImage.effective ?? null, imageFallback));
  // 本机模型没装好时照 `imageStatus` 说「先下载」，与就地的下载卡一致。
  const reason = view && !option?.local ? modelReason(options, option, FRAME_COPY.imageNoun) : null;
  const status = reason ? { text: reason, bad: true } : imageStatus(draft, option, tried);
  const toSettings = () => go({ tab: 'models', category: 'image' });
  const shown = records.list.filter((job) => job.state !== 'cancelled');
  // 点图放大：页上做完的图收进 Space 的那些一起进查看器，可以左右切换（设计稿 image-gen.jsx `ImageViewer`）。
  const entries = useSpace((s) => s.entries);
  const [viewing, setViewing] = useState<SpaceEntry | null>(null);
  const gallery = useMemo(() => (viewing ? imageGallery(shown, entries) : []), [viewing, shown, entries]);
  const initial = viewing ? (gallery.find((c) => 'entryId' in c.target && c.target.entryId === viewing.id) ?? null) : null;

  const generate = () => {
    setTried(true);
    if (!option || !option.usable || submitting) return;
    const problems = imageProblems(draft, option);
    if (problems.length) {
      ToastQueue.neutral(problems[0]!, { timeout: 4000 });
      return;
    }
    setSubmitting(true);
    runtime
      .generateImage(withSaveDir(imageRequest(draft, option), saveTarget(saveDirectory, saveOverride)))
      .then(
        () => {
          patch({ prompt: '', refs: [] });
          setTried(false);
          ToastQueue.positive(IMAGE_COPY.submitted, { timeout: 3000 });
        },
        submitFailed,
      )
      .finally(() => setSubmitting(false));
  };

  const again = (job: JobRecord) => {
    const next = againDraft(job);
    if (!next) return;
    const { dropped, ...rest } = next;
    patch(rest);
    promptRef.current?.focus();
    ToastQueue.neutral(dropped ? IMG.refsAssetsDropped(dropped) : IMAGE_COPY.againDone, { timeout: dropped ? 5000 : 3000 });
  };
  useRerun('generate-image', again);

  const bar = (
    <>
      <BarStatus text={status.text} bad={status.bad} />
      <Button variant="accent" isDisabled={!option?.usable} isPending={submitting} onPress={generate}>
        <ImageIcon />
        <Text>{IMAGE_COPY.submit}</Text>
      </Button>
    </>
  );
  const chip = imageHeaderChip(option);

  if (!view) {
    return (
      <ToolPage title={IMAGE_COPY.title}>
        <PageStatus>{GALLERY_COPY.loading}</PageStatus>
      </ToolPage>
    );
  }

  const maxChars = option?.info.maxPromptChars ?? 0;
  const chars = codePoints(draft.prompt.trim());

  const main = (
    <>
      <Section label={IMAGE_COPY.promptLabel}>
        <ImageRefsZone draft={draft} option={option} patch={patch} stack>
          <ToolTextArea
            label={IMAGE_COPY.promptLabel}
            inputRef={promptRef}
            value={draft.prompt}
            onChange={(prompt) => patch({ prompt })}
            placeholder={imagePromptPlaceholder(draft, option)}
          />
          <div className={textFoot}>
            <span className={maxChars && chars > maxChars ? detailOver : detailGrow}>{IMAGE_COPY.chars(chars, maxChars || null)}</span>
            {draft.prompt ? (
              <SectionLink onPress={() => patch({ prompt: '' })}>{IMAGE_COPY.clear}</SectionLink>
            ) : (
              <SectionLink
                onPress={() => {
                  patch({ prompt: IMAGE_SAMPLES[sample % IMAGE_SAMPLES.length]! });
                  setSample(sample + 1);
                }}>
                {IMAGE_COPY.sample}
              </SectionLink>
            )}
          </div>
          {option ? (
            <>
              <ImageRefsRow draft={draft} option={option} patch={patch} source={SPACE_SOURCE} />
              <ImageRefModeRow draft={draft} option={option} patch={patch} />
            </>
          ) : null}
        </ImageRefsZone>
      </Section>

      <ModelRow
        noun={FRAME_COPY.imageNoun}
        manage={IMAGE_COPY.manage}
        onSettings={toSettings}
        options={options}
        selected={option}
        disableUnusable
        localGate
        onSelect={(o) => patch(switchImageModel(draft, o))}
        factsOf={(o) => imageModelLine(o.info)}>
        <LocalModelGate selected={option} options={options} onSwitch={(o) => patch(switchImageModel(draft, o))} />
        <p className={hintText}>{IMAGE_COPY.localNote}</p>
      </ModelRow>

      {option ? <ImageOptions draft={draft} option={option} patch={patch} /> : null}
      <SaveDirRow saveDirectory={saveDirectory} override={saveOverride} onChange={setSaveOverride} />
    </>
  );

  const side = (
    <>
      <SideHead
        title={IMAGE_COPY.side}
        live={records.live ? RECORD_COPY.live(records.live) : null}
        count={RECORD_COPY.count(shown.length)}
        extra={
          <ActionButton isQuiet size="S" onPress={() => go({ tab: 'space', category: 'image', projectId: null })}>
            <Text>{SAVE_COPY.view}</Text>
          </ActionButton>
        }
      />
      {!records.ready ? (
        <PageStatus>{GALLERY_COPY.loading}</PageStatus>
      ) : shown.length ? (
        shown.map((job) => (
          <ImageRecord key={job.jobId} job={job} all={records.all} view={view} now={now} onAgain={again} onOpen={setViewing} />
        ))
      ) : (
        <EmptyCard icon={<ImageIcon />} title={IMAGE_COPY.empty} body={IMAGE_COPY.emptyBody} />
      )}
      <SideFoot>
        {IMAGE_COPY.sideFoot}
      </SideFoot>
    </>
  );

  return (
    <ToolPage title={IMAGE_COPY.title} bar={bar} chip={chip ? <HeaderChip text={chip} /> : null}>
      <Workbench main={main} side={side} sideLabel={IMAGE_COPY.side} onKeyDown={submitOnModEnter(generate)} />
      {initial ? <ImageLightbox files={gallery} initial={initial} onClose={() => setViewing(null)} /> : null}
    </ToolPage>
  );
}

/** 画幅、尺寸、数量、高级（设计稿 `AspectRow`、`SizeRow` 与 `ImageGenForm` 的后几节）。 */
function ImageOptions({ draft, option, patch }: { draft: ImageDraft; option: ImageOption; patch: (patch: Partial<ImageDraft>) => void }) {
  const info = option.info;
  const sizes = aspectOptions(info);
  const size = sizeKeyFor(draft, info);
  const tiers = sizeTierOptions(info, size);
  const tier = tierFor(draft, info, size);
  const stepRange = info.local?.steps ?? null;
  const fixed = fixedSteps(info);
  return (
    <>
      <Section title={IMAGE_COPY.aspect}>
        {sizes.length ? (
          <ToggleButtonGroup
            aria-label={IMAGE_COPY.aspect}
            className={aspects}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={size ? [size] : []}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next !== undefined) patch({ size: String(next) });
            }}>
            {sizes.map((a) => {
              // 画幅下面写所选那一档在这个画幅下的像素尺寸（设计稿 `sizeOf`）。
              const sub = tierFor(draft, info, a.key)?.sub ?? a.sub;
              return (
                <ToggleButton key={a.key} id={a.key} className={(rp) => aspect(rp)}>
                  <span className={aspectBox} style={boxSize(a.ratio)} aria-hidden />
                  <span className={aspectName}>{a.label}</span>
                  {sub ? <span className={aspectSub}>{sub}</span> : null}
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>
        ) : (
          <span className={detail}>{IMAGE_COPY.aspectAuto}</span>
        )}
      </Section>

      {tiers.length ? (
        <Section title={IMAGE_COPY.size}>
          <Row>
            <ToggleButtonGroup
              aria-label={IMAGE_COPY.size}
              className={aspects}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={tier ? [tier.key] : []}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next !== undefined) patch({ tier: String(next) });
              }}>
              {tiers.map((t) => (
                <ToggleButton key={t.key} id={t.key} className={(rp) => aspect(rp)}>
                  {t.label ? <span className={aspectName}>{t.label}</span> : null}
                  <span className={t.label ? aspectSub : aspectName}>{t.sub}</span>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <span className={detailGrow}>{tiers.length < 2 ? IMAGE_COPY.sizeSingle : option.local ? IMAGE_COPY.sizeNoteLocal : IMAGE_COPY.sizeNote}</span>
          </Row>
        </Section>
      ) : null}

      {info.maxCount > 1 && imageRefMode(draft, info) !== 'img2img' ? (
        <Section title={IMAGE_COPY.count}>
          <Row>
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
            <span className={detailGrow}>{IMAGE_COPY.countNote(info.maxCount)}</span>
          </Row>
        </Section>
      ) : null}

      {info.acceptsSeed || stepRange ? (
        <Section
          title={IMAGE_COPY.advanced}
          aside={<SectionLink onPress={() => patch({ advanced: !draft.advanced })}>{draft.advanced ? IMAGE_COPY.collapse : IMAGE_COPY.expand}</SectionLink>}>
          {draft.advanced ? (
            <>
              {info.acceptsSeed ? (
                <Row label={IMAGE_COPY.seed}>
                  <TextField
                    aria-label={IMAGE_COPY.seed}
                    size="S"
                    styles={seedField}
                    inputMode="numeric"
                    placeholder={IMAGE_COPY.seedPlaceholder}
                    value={draft.seed}
                    onChange={(seed) => patch({ seed: seed.replace(/[^\d]/g, '') })}
                  />
                  <span className={detailGrow}>{option.local ? IMAGE_COPY.seedNoteLocal : IMAGE_COPY.seedNote}</span>
                </Row>
              ) : null}
              {fixed !== null ? (
                <Row label={IMAGE_COPY.steps}>
                  <span className={stepsFixed}>{IMAGE_COPY.stepsFixed(fixed)}</span>
                  <span className={detailGrow}>{IMAGE_COPY.stepsFixedNote}</span>
                </Row>
              ) : stepRange ? (
                <Row label={IMAGE_COPY.steps}>
                  <NumberField
                    aria-label={IMAGE_COPY.steps}
                    size="S"
                    styles={stepsField}
                    minValue={stepRange.min}
                    maxValue={stepRange.max}
                    step={stepRange.step}
                    value={stepsFor(draft, info) ?? stepRange.default}
                    onChange={(steps) => Number.isFinite(steps) && patch({ steps })}
                  />
                  <span className={detailGrow}>{IMAGE_COPY.stepsNote(stepRange.default)}</span>
                </Row>
              ) : null}
            </>
          ) : (
            <span className={detail}>
              {[info.acceptsSeed ? IMAGE_COPY.seed : null, fixed !== null ? IMAGE_COPY.stepsFixed(fixed) : stepRange ? IMAGE_COPY.steps : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </Section>
      ) : null}
    </>
  );
}
