import { useState } from 'react';
import type { SeparateModelInfo, ToolInputFacts } from '@baocut/protocol';
import { ActionButton, Button, NumberField, SegmentedControl, SegmentedControlItem, Slider, Text } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { formatClock } from '../../model/format.ts';
import type { FootageToolId } from '../../model/tool-catalog.ts';
import { M } from '../../model/tools-footage-copy.ts';
import {
  extensionsFor,
  FACTORS,
  footageOp,
  fpsText,
  MATTE_MODELS,
  MATTE_ISNET,
  METHODS,
  MODES,
  planOf,
  SCALES,
  sentences,
  STEMS,
  STRENGTHS,
  UPSCALE_MODELS,
  upscaleIsNative,
  type FootageForm,
  type FootageSource,
  type Stabilizer,
} from '../../model/tools-footage.ts';
import { downloadableBundle } from '../../model/models-install.ts';
import { modelKeyOf, type ToolModelOption } from '../../model/tools-models.ts';
import { fileName, spaceInput } from '../../model/tools-transcode.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { LocalDownloadGate } from './local-model-gate.tsx';
import { ModelRow } from './tool-frame.tsx';
import { detail, detailGrow, hintText, Row, Section, SectionLink } from './tool-parts.tsx';
import { SpacePicker } from './tool-video-picker.tsx';
import { useManagedTools } from './use-managed-tools.ts';

/*
 * 五种处理与分轨各自的参数（设计稿 tool-footage-form.jsx，协议 `FootageParams`、`SeparateAudioParams`）。卡片式单选同 services/service-parts.tsx
 * 的 `LevelChoice`：S2 的 SelectBoxGroup 横排放不下、竖排又不显示说明。
 */

const cards = style({ display: 'grid', gridTemplateColumns: { default: '1fr', sm: ['1fr', '1fr'] }, gap: 8 });
const cardsThree = style({ display: 'grid', gridTemplateColumns: { default: '1fr', sm: ['1fr', '1fr', '1fr'] }, gap: 8 });
const card = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 2,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-300', isHovered: 'gray-400', isSelected: 'blue-900' },
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isSelected: 'blue-100' },
  textAlign: 'start',
  cursor: 'default',
  transition: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const cardTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const cardDesc = style({ font: 'ui-xs', color: 'gray-600' });
const warn = style({ margin: 0, font: 'ui-sm', color: 'orange-1000' });
const slider = style({ flexGrow: 1, minWidth: 160 });
const numberField = style({ width: 120 });
const reference = style({ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 'default', backgroundColor: 'gray-25', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', minWidth: 0 });
const referenceText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const referenceName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const chips = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 });

function Cards<K extends string>({ label, items, value, onChange, three }: { label: string; items: readonly { key: K; name: string; sub: string }[]; value: K; onChange: (key: K) => void; three?: boolean }) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className={three ? cardsThree : cards}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next !== undefined && next !== value) onChange(next as K);
      }}>
      {items.map((x) => (
        <ToggleButton key={x.key} id={x.key} className={(rp) => card(rp)}>
          <span className={cardTitle}>{x.name}</span>
          <span className={cardDesc}>{x.sub}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

interface OptionProps {
  id: FootageToolId;
  form: FootageForm;
  setForm: (p: Partial<FootageForm>) => void;
  srcs: readonly FootageSource[];
}

function StabilizeOptions({ form, setForm, stabilizer }: OptionProps & { stabilizer: Stabilizer | undefined }) {
  return (
    <Section title={M.strengthTitle}>
      <Row label={M.strength}>
        <SegmentedControl aria-label={M.strength} selectedKey={form.strength} onSelectionChange={(k) => setForm({ strength: k as FootageForm['strength'] })}>
          {STRENGTHS.map((s) => (
            <SegmentedControlItem key={s} id={s}>
              {M.strengthLevel[s]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </Row>
      <p className={hintText}>{M.strengthNote}</p>
      {stabilizer === 'vidstab' ? <p className={hintText}>{M.vidstabNote}</p> : stabilizer === 'deshake' ? <p className={warn}>{M.deshakeNote}</p> : null}
    </Section>
  );
}

function UpscaleOptions({ id, form, setForm, srcs }: OptionProps) {
  const video = srcs.find((s) => s.facts.kind === 'video');
  const plan = video ? planOf(id, form, video.facts) : null;
  return (
    <Section title={M.upscaleTitle}>
      <Row label={M.scale}>
        <SegmentedControl aria-label={M.scale} selectedKey={String(form.scale)} onSelectionChange={(k) => setForm({ scale: Number(k) as FootageForm['scale'] })}>
          {SCALES.map((s) => (
            <SegmentedControlItem key={s} id={String(s)}>{`${s}×`}</SegmentedControlItem>
          ))}
        </SegmentedControl>
        {plan ? <span className={detailGrow}>{`${plan.outWidth}×${plan.outHeight}`}</span> : null}
      </Row>
      <Cards label={M.upscaleModelLabel} three items={UPSCALE_MODELS.map((key) => ({ key, ...M.upscaleModel[key] }))} value={form.model} onChange={(model) => setForm({ model })} />
      <p className={hintText}>{sentences(upscaleIsNative(form) ? M.nativeNote : M.resizeNote(form.scale), M.upscaleCaveat)}</p>
    </Section>
  );
}

function InterpolateOptions({ id, form, setForm, srcs }: OptionProps) {
  const video = srcs.find((s) => s.facts.kind === 'video');
  const plan = video ? planOf(id, form, video.facts) : null;
  return (
    <Section title={M.interpolateTitle}>
      <Cards label={M.modeLabel} items={MODES.map((key) => ({ key, ...M.mode[key] }))} value={form.mode} onChange={(mode) => setForm({ mode })} />
      <Row label={M.factor}>
        <SegmentedControl aria-label={M.factor} selectedKey={String(form.factor)} onSelectionChange={(k) => setForm({ factor: Number(k) as FootageForm['factor'] })}>
          {FACTORS.map((s) => (
            <SegmentedControlItem key={s} id={String(s)}>{`${s}×`}</SegmentedControlItem>
          ))}
        </SegmentedControl>
        {plan ? (
          <span className={detailGrow}>
            {form.mode === 'slowmo'
              ? M.slowmoLine(fpsText(plan.outFps ?? 0), formatClock(plan.seconds ?? 0), formatClock(plan.outSeconds ?? 0))
              : M.smoothLine(fpsText(plan.fps ?? 0), fpsText(plan.outFps ?? 0))}
          </span>
        ) : null}
      </Row>
      <p className={hintText}>{M.cutsNote}</p>
    </Section>
  );
}

function MatchColorOptions({ id, form, setForm, srcs, onReference, facts }: OptionProps & { onReference: (input: string) => void; facts: Record<string, ToolInputFacts> }) {
  const runtime = useRuntime();
  const [fromSpace, setFromSpace] = useState(false);
  const ref = form.reference;
  const refFacts = ref ? facts[ref] : undefined;
  const pick = () => {
    if (!runtime.host.pickFiles) return;
    void runtime.host.pickFiles({ title: M.referencePick, multiple: false, filters: [{ name: M.mediaFilter, extensions: extensionsFor(id) }] }).then((paths) => {
      if (paths[0]) onReference(paths[0]);
    });
  };
  const others = srcs.filter((s) => s.input !== ref).slice(0, 4);
  return (
    <>
      <Section title={M.referenceTitle} aside={<span className={detail}>{M.required}</span>}>
        {ref ? (
          <div className={reference}>
            <span className={referenceText}>
              <span className={referenceName}>{refFacts?.name ?? fileName(ref)}</span>
              {refFacts ? (
                <span className={detail}>
                  {refFacts.kind === 'image'
                    ? M.referenceImage(refFacts.width ?? 0, refFacts.height ?? 0)
                    : M.referenceVideo(formatClock(refFacts.durationSec ?? 0), refFacts.width ?? 0, refFacts.height ?? 0)}
                </span>
              ) : null}
            </span>
            <SectionLink onPress={pick}>{M.referenceReplace}</SectionLink>
            <ActionButton isQuiet size="S" aria-label={M.remove} onPress={() => setForm({ reference: null, referenceAt: null })}>
              <Close />
            </ActionButton>
          </div>
        ) : (
          <div className={chips}>
            <Button variant="secondary" size="S" onPress={pick}>
              {M.referencePick}
            </Button>
            <SectionLink onPress={() => setFromSpace((v) => !v)}>{fromSpace ? M.spaceDone : M.spaceAdd}</SectionLink>
          </div>
        )}
        {fromSpace && !ref ? (
          <SpacePicker
            tool={id}
            data={null}
            value={null}
            onChange={(entryId) => {
              setFromSpace(false);
              onReference(spaceInput(entryId));
            }}
          />
        ) : null}
        {!ref && others.length ? (
          <div className={chips}>
            <span className={detail}>{M.referenceFromInputs}</span>
            {others.map((s) => (
              <ActionButton key={s.input} size="S" onPress={() => onReference(s.input)}>
                <Text>{s.facts.name}</Text>
              </ActionButton>
            ))}
          </div>
        ) : null}
        {ref && refFacts?.kind === 'video' ? (
          <Row label={M.referenceAt}>
            <NumberField
              size="S"
              styles={numberField}
              aria-label={M.referenceAt}
              minValue={0}
              {...(refFacts.durationSec ? { maxValue: refFacts.durationSec } : {})}
              step={1}
              value={form.referenceAt ?? NaN}
              formatOptions={{ style: 'unit', unit: 'second', maximumFractionDigits: 1 }}
              onChange={(v) => setForm({ referenceAt: Number.isFinite(v) ? v : null })}
            />
            <span className={detailGrow}>{M.referenceAtNote}</span>
          </Row>
        ) : null}
      </Section>
      <Section title={M.methodTitle}>
        <Cards label={M.methodLabel} items={METHODS.map((key) => ({ key, ...M.method[key] }))} value={form.method} onChange={(method) => setForm({ method })} />
        <Row label={M.amount}>
          <Slider styles={slider} aria-label={M.amountLabel} size="S" minValue={0} maxValue={1} step={0.05} value={form.amount} formatOptions={{ style: 'percent' }} onChange={(amount) => setForm({ amount })} />
        </Row>
        <p className={hintText}>{M.amountNote}</p>
      </Section>
    </>
  );
}

function RemoveBackgroundOptions({ form, setForm, srcs }: OptionProps) {
  const hasVideo = srcs.some((s) => s.facts.kind === 'video') || !srcs.length;
  // 许可说明：还没下载时写在下载卡上，装好之后写在这里，不重复。
  const clean = form.matteModel === 'general';
  const web = useRuntime().host.platform === 'web';
  const managed = useManagedTools(clean ? [MATTE_ISNET] : [], clean && !web);
  return (
    <Section title={M.matteTitle}>
      <Cards label={M.matteLabel} items={MATTE_MODELS.map((key) => ({ key, ...M.matte[key] }))} value={form.matteModel} onChange={(matteModel) => setForm({ matteModel })} />
      {clean && managed.state === 'ready' ? <p className={warn}>{M.licenseNote}</p> : null}
      {hasVideo ? (
        <>
          <Row label={M.temporal}>
            <Slider styles={slider} aria-label={M.temporalLabel} size="S" minValue={0} maxValue={0.95} step={0.05} value={form.temporal} formatOptions={{ style: 'percent' }} onChange={(temporal) => setForm({ temporal })} />
          </Row>
          <p className={hintText}>{M.temporalNote}</p>
        </>
      ) : null}
      <p className={hintText}>{M.matteNote}</p>
    </Section>
  );
}

function SeparateOptions({ form, setForm, options, option }: OptionProps & { options: readonly ToolModelOption<SeparateModelInfo>[]; option: ToolModelOption<SeparateModelInfo> | null }) {
  const go = useShell((s) => s.go);
  const bundles = useModels((s) => s.bundles);
  const toSettings = () => go({ tab: 'models', category: 'sep' });
  const gateBundle = downloadableBundle(bundles, option);
  return (
    <>
      <ModelRow
        noun={M.modelNoun}
        manage={M.modelManage}
        onSettings={toSettings}
        options={options}
        selected={option}
        onSelect={(o) => setForm({ sepModel: modelKeyOf(o.providerId, o.modelId) })}
        factsOf={() => M.modelLocalNote}
        localGate={!!gateBundle}>
        {gateBundle && option ? <LocalDownloadGate bundle={gateBundle} name={option.label} category="sep" body={(paused) => (paused ? M.modelDownloadBodyPaused : M.modelDownloadBody)} /> : null}
      </ModelRow>
      <Section title={M.stemsTitle}>
        <Cards label={M.stemsLabel} items={STEMS.map((key) => ({ key, ...M.stems[key] }))} value={form.stems} onChange={(stems) => setForm({ stems })} />
        {form.stems === 'four' && option?.usable && !option.info.fourStems ? <p className={warn}>{M.stemsUnsupported(option.label)}</p> : null}
        <p className={hintText}>{M.separateNote}</p>
      </Section>
    </>
  );
}

export function FootageOptions({
  id,
  form,
  setForm,
  srcs,
  stabilizer,
  options,
  option,
  onReference,
  facts,
}: OptionProps & {
  stabilizer: Stabilizer | undefined;
  options: readonly ToolModelOption<SeparateModelInfo>[];
  option: ToolModelOption<SeparateModelInfo> | null;
  onReference: (input: string) => void;
  facts: Record<string, ToolInputFacts>;
}) {
  const common = { id, form, setForm, srcs };
  switch (footageOp(id)) {
    case 'stabilize':
      return <StabilizeOptions {...common} stabilizer={stabilizer} />;
    case 'upscale':
      return <UpscaleOptions {...common} />;
    case 'interpolate':
      return <InterpolateOptions {...common} />;
    case 'match-color':
      return <MatchColorOptions {...common} onReference={onReference} facts={facts} />;
    case 'remove-background':
      return <RemoveBackgroundOptions {...common} />;
    case 'separate':
      return <SeparateOptions {...common} options={options} option={option} />;
  }
}
