import { useEffect, useMemo, useState } from 'react';
import { intlLocale } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Checkbox,
  Picker,
  PickerItem,
  Text,
  TextArea,
  TextField,
  ToastQueue,
  ToggleButton,
} from '@react-spectrum/s2';
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft';
import EditIcon from '@react-spectrum/s2/icons/Edit';
import RefreshIcon from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  CONSENT_COMMON,
  CONSENT_DEFAULT,
  CONSENT_REC,
  SAMPLE,
  VOICE_CONSENT_CUSTOM,
  cloneSteps,
  consentLanguageName,
  consentMore,
  consentPhrase,
  consentTooShort,
  defaultPicked,
  defaultScriptLanguage,
  defaultVoiceName,
  firstSecondsUsed,
  initialCloneStep,
  initialSeeds,
  randomSeed,
  sampleScript,
  sampleTooShortFor,
  sampleVerdict,
  saveTakeWarnings,
  scriptLanguages,
  uploadPlan,
  uploadTargets,
  type CloneStep,
  type CloneTarget,
  type UploadRow,
} from '../../model/voice-capture.ts';
import { rpcErrorText, voiceConsentStatement, VOICE_NAME_MAX, type VoiceEntry } from '../../model/voices-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useVoices } from '../../state/voices-store.ts';
import { createCapturedVoice, saveConsentClip, uploadClone } from './voice-actions.ts';
import { CAPTURE_COPY as CC, MY_VOICES_COPY as COPY } from './voices-copy.ts';
import { ClipRecorder, TakeWarning, limitText, type Clip } from './voice-take.tsx';

/**
 * 我的声音 › 克隆新音色（设计稿 settings-voice-capture.jsx，架构设计 §5.9）：① 选这只音色给哪些模型用 → ② 录一段样本
 * （30 秒就够，想多说可以接着说，到 3 分钟自动停；麦克风或上传，上传的超过 3 分钟取前 3 分钟）→ ③ 授权声明（选中的云端里有要它的
 * 才有这一步）→ ④ 保存（名字、本人声明、每只收种子的本机引擎一颗种子）。保存后立即上传到选中的、连着且条件齐了的云端建克隆，
 * 进度与结果在我的声音那一行；不勾本人声明也能存，只留在本机、哪家都不传。从模型页某只模型过来时直接停在样本这一步。`ConsentCapture` 是行上 ⋯「补录 / 重录授权声明」的
 * 单步版，从克隆失败的补救过来时存好后自动重新上传。
 *
 * 录音在界面里解码、混成单声道、重采样到 48 kHz、截到上限，写成 WAV，经宿主（`writeRecording`）落到临时目录，
 * 再把路径交给 `library.put`。存下的是整段样本（≤ 3 分钟）当参考录音（云端收得更短时由 Runtime 截短再上传）；逐字稿留空
 * （样本后半段是随便说的），需要时在「编辑」里补。
 *
 * 一段录音（`ClipRecorder`，在 voice-take.tsx）录音中当场提示、停下后给判词。麦克风由这里统一拿着：进「授权声明」时还没录就换回
 * 录样本的那只，换了别的就提醒（要授权声明的提供方核对两段是不是同一个人）；保存时两段有爆音、底噪，或不是同一只麦克风录的，
 * 在保存按钮上面提醒一次，不拦。
 */

const wrap = style({ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 });
const title = style({ margin: 0, font: 'title', color: 'gray-900' });
const stepList = style({ display: 'flex', flexWrap: 'wrap', gap: 16, margin: 0, padding: 0, listStyleType: 'none' });
const stepItem = style({
  font: 'ui-sm',
  color: { default: 'gray-600', isCurrent: 'gray-900' },
  fontWeight: { default: 'normal', isCurrent: 'bold' },
});
const lede = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const row = style({ display: 'flex', alignItems: 'start', gap: 12, minWidth: 0 });
const lab = style({ flexShrink: 0, width: 112, paddingTop: 4, font: 'ui-sm', color: 'gray-700' });
const chips = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexGrow: 1, minWidth: 0 });
const detail = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const warn = style({ margin: 0, font: 'ui-xs', color: 'notice-900', overflowWrap: 'anywhere' });
const script = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'body',
  color: 'gray-900',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
const clipBox = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const stack = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const seedValue = style({ font: 'code-sm', color: 'gray-900', userSelect: 'text' });
const field = style({ width: 'full', maxWidth: 400 });
const acts = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 12 });
const footText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });

const names = (list: readonly Pick<CloneTarget, 'name'>[]) => list.map((t) => t.name).join(' / ');

function StepList({ steps, cur }: { steps: CloneStep[]; cur: number }) {
  const labels: Record<CloneStep['key'], string> = {
    models: CC.stepModels,
    sample: CC.stepSample,
    consent: CC.stepConsent,
    save: CC.stepSave,
  };
  return (
    <ol className={stepList} aria-label={CC.steps}>
      {steps.map((s, i) => (
        <li key={s.key} className={stepItem({ isCurrent: i === cur })} aria-current={i === cur ? 'step' : undefined}>
          {`${i + 1}. ${labels[s.key]}`}
        </li>
      ))}
    </ol>
  );
}

/** ① 选模型：本机能克隆的引擎 + 能克隆的云端（没连密钥的也能先选）。 */
function ModelsStep({
  targets,
  picked,
  onToggle,
}: {
  targets: readonly CloneTarget[];
  picked: readonly string[];
  onToggle: (id: string) => void;
}) {
  const local = targets.filter((t) => t.kind === 'local');
  const cloud = targets.filter((t) => t.kind === 'cloud');
  const chip = (t: CloneTarget) => {
    const extra = [t.consent ? CC.needsConsent : null, t.needsTranscript ? CC.needsTranscript : null, t.connected ? null : CC.notConnected]
      .filter(Boolean)
      .join(' · ');
    return (
      <ToggleButton key={t.id} size="S" isSelected={picked.includes(t.id)} onChange={() => onToggle(t.id)}>
        {extra ? `${t.name} · ${extra}` : t.name}
      </ToggleButton>
    );
  };
  return (
    <>
      <p className={lede}>{CC.modelsLede}</p>
      <div className={row}>
        <span className={lab}>{CC.local}</span>
        <div className={chips}>{local.length ? local.map(chip) : <span className={detail}>{CC.noLocal}</span>}</div>
      </div>
      <div className={row}>
        <span className={lab}>{CC.cloud}</span>
        <div className={chips}>{cloud.length ? cloud.map(chip) : <span className={detail}>{CC.noCloud}</span>}</div>
      </div>
      <p className={detail}>{CC.modelsNote}</p>
    </>
  );
}

/**
 * ② 样本：念哪门语言的台词，照着念或上传一段现成的。`chosen` 是选中的模型：选中的云端收得比上限短时先说一声
 * （「Google Gemini 只用前 30 秒」），样本比哪家收的最短还短时点名。
 */
function SampleStep({
  chosen,
  lang,
  setLang,
  clip,
  onClip,
  deviceId,
  onDeviceId,
}: {
  chosen: readonly CloneTarget[];
  lang: string;
  setLang: (code: string) => void;
  clip: Clip | null;
  onClip: (c: Clip | null) => void;
  deviceId?: string;
  onDeviceId?: (id: string) => void;
}) {
  const verdict = clip ? sampleVerdict(clip.seconds) : null;
  const shortFor = clip && verdict !== 'short' ? sampleTooShortFor(chosen, clip.seconds) : null;
  const hint =
    verdict === 'short'
      ? CC.sampleShort(clip!.seconds.toFixed(1), SAMPLE.min)
      : shortFor
        ? CC.sampleShortFor(shortFor.names.join(' / '), shortFor.min)
        : verdict === 'local'
          ? CC.sampleLocal
          : verdict === 'ok'
            ? CC.sampleOk(SAMPLE.target)
            : verdict === 'best'
              ? CC.sampleBest
              : CC.checkTake;
  // 选中的云端里收得比上限短的：录之前就说，免得录了 3 分钟才知道只用前 30 秒。
  const capped = firstSecondsUsed(chosen, SAMPLE.max).map((g) => CC.usesFirst(g.names.join(' / '), g.seconds));
  return (
    <>
      <p className={lede}>{CC.sampleLede(SAMPLE.min, SAMPLE.good, SAMPLE.target, limitText(SAMPLE.max))}</p>
      {capped.length ? <p className={detail}>{capped.join(' · ')}</p> : null}
      <div className={row}>
        <span className={lab}>{CC.language}</span>
        <div className={chips}>
          {scriptLanguages().map((l) => (
            <ToggleButton key={l.code} size="S" isSelected={lang === l.code} onChange={() => setLang(l.code)}>
              {l.label}
            </ToggleButton>
          ))}
        </div>
      </div>
      <blockquote className={script} lang={lang}>
        {sampleScript(lang).map((line, i) => (
          <span key={i}>{line}</span>
        ))}
        <span className={detail}>{CC.scriptTail(SAMPLE.target, limitText(SAMPLE.max))}</span>
      </blockquote>
      <ClipRecorder spec={SAMPLE} clip={clip} onClip={onClip} hint={hint} deviceId={deviceId} onDeviceId={onDeviceId} />
      {verdict === 'short' || shortFor ? <p className={warn}>{hint}</p> : null}
    </>
  );
}

interface ConsentDraft {
  language: string;
  custom: string;
}

/** ③ 授权声明：常用两种给芯片，其余 28 种在「更多语言」里，也能自定义一句（要授权声明的提供方只认官方原文）。 */
function ConsentStep({
  needed,
  draft,
  setDraft,
  clip,
  onClip,
  sample = null,
  deviceId,
  onDeviceId,
}: {
  needed: readonly string[];
  draft: ConsentDraft;
  setDraft: (d: ConsentDraft) => void;
  clip: Clip | null;
  onClip: (c: Clip | null) => void;
  /** 克隆新音色里录的样本：拿它比麦克风（单步补录时没有）。 */
  sample?: Clip | null;
  deviceId?: string;
  onDeviceId?: (id: string) => void;
}) {
  const locale = intlLocale();
  const phrase = consentPhrase(draft.language);
  const isCustom = draft.language === VOICE_CONSENT_CUSTOM;
  const more = consentMore();
  const moreOn = !isCustom && !CONSENT_COMMON.includes(draft.language) ? draft.language : null;
  const pick = (language: string) => {
    if (language === draft.language) return;
    setDraft({ ...draft, language });
    onClip(null);
  };
  const short = clip && consentTooShort(clip.seconds);
  return (
    <>
      <p className={lede}>{needed.length ? CC.consentLede(needed.join(' / ')) : CC.consentLedeAny}</p>
      <div className={row}>
        <span className={lab}>{CC.language}</span>
        <div className={chips}>
          {CONSENT_COMMON.map((code) => {
            const p = consentPhrase(code);
            const label = consentLanguageName(code, locale);
            return (
              <ToggleButton key={code} size="S" isSelected={draft.language === code} onChange={() => pick(code)}>
                {p?.recommended ? `${label} · ${CC.recommended}` : label}
              </ToggleButton>
            );
          })}
          <Picker
            aria-label={CC.moreLanguages}
            size="S"
            menuWidth={280}
            placeholder={CC.moreLanguages}
            selectedKey={moreOn}
            onSelectionChange={(key) => {
              if (key !== null) pick(String(key));
            }}
          >
            {more.map((p) => {
              const label = consentLanguageName(p.code, locale);
              return (
                <PickerItem key={p.code} id={p.code} textValue={label}>
                  <Text slot="label">{label}</Text>
                  <Text slot="description">{p.code}</Text>
                </PickerItem>
              );
            })}
          </Picker>
          <ToggleButton size="S" isSelected={isCustom} onChange={() => pick(VOICE_CONSENT_CUSTOM)}>
            <EditIcon />
            <Text>{CC.custom}</Text>
          </ToggleButton>
        </div>
      </div>
      {isCustom ? (
        <>
          <TextArea
            aria-label={CC.customLabel}
            placeholder={CC.customPlaceholder}
            value={draft.custom}
            maxLength={500}
            styles={field}
            onChange={(custom) => {
              setDraft({ ...draft, custom });
              onClip(null);
            }}
          />
          <p className={warn}>{CC.customWarning}</p>
        </>
      ) : phrase ? (
        <blockquote className={script} lang={phrase.code}>
          {phrase.text}
        </blockquote>
      ) : null}
      {phrase?.flaky ? <p className={warn}>{CC.flaky}</p> : null}
      {phrase && !phrase.flaky && !phrase.verified ? <p className={detail}>{CC.untested}</p> : null}
      <ClipRecorder
        spec={CONSENT_REC}
        clip={clip}
        onClip={onClip}
        hint={short ? CC.consentShort(clip.seconds.toFixed(1)) : clip ? CC.consentGood : CC.consentHint}
        deviceId={deviceId}
        onDeviceId={onDeviceId}
        sample={sample}
        needed={needed}
      />
      {short ? <p className={warn}>{CC.consentShort(clip.seconds.toFixed(1))}</p> : null}
    </>
  );
}

const consentReady = (draft: ConsentDraft, clip: Clip | null) =>
  !!clip && !consentTooShort(clip.seconds) && (draft.language !== VOICE_CONSENT_CUSTOM || !!draft.custom.trim());

/** 录音写进本机临时目录；宿主没有这项能力（浏览器）时抛错。 */
async function writeClip(write: ((data: Uint8Array) => Promise<string>) | undefined, clip: Clip): Promise<string> {
  if (!write) throw new Error('writeRecording');
  return write(clip.bytes);
}

/**
 * 克隆新音色的四步。`preselect` 是从模型页过来时那只模型（直接停在样本这一步）。存好后立即上传到 `uploadPlan` 里条件齐了的云端，
 * 再 `onSaved(id)`：上传的进度与结果在我的声音那一行，提交时就被拒的也留在那一行，存好的音色不受影响。
 */
export function VoiceCapture({
  targets,
  preselect,
  onCancel,
  onSaved,
}: {
  targets: readonly CloneTarget[];
  preselect: string | null;
  onCancel: () => void;
  onSaved: (voiceId: string) => void;
}) {
  const runtime = useRuntime();
  // 只记用户点过的；其余按当下的 targets 现算，晚到的模型（含从模型页过来的那一只）也照默认选上。
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const picked = useMemo(() => defaultPicked(targets, preselect, toggled), [targets, preselect, toggled]);
  const chosen = useMemo(() => targets.filter((t) => picked.includes(t.id)), [targets, picked]);
  const steps = cloneSteps(chosen);
  const [cur, setCur] = useState(() => initialCloneStep(preselect));
  const [lang, setLang] = useState(() => defaultScriptLanguage(intlLocale()));
  const [sample, setSample] = useState<Clip | null>(null);
  const [consentDraft, setConsentDraft] = useState<ConsentDraft>({ language: CONSENT_DEFAULT, custom: '' });
  const [consentClip, setConsentClip] = useState<Clip | null>(null);
  // 麦克风两步共用：进「授权声明」时还没录就换回录样本的那只（要它的提供方核对两段是不是同一个人，同一只麦克风最稳）。
  const [deviceId, setDeviceId] = useState('default');
  const [name, setName] = useState(() =>
    defaultVoiceName(
      CC.namePlaceholder,
      useVoices.getState().voices.map((v) => v.name),
    ),
  );
  const [consent, setConsent] = useState(false);
  const [seeds, setSeeds] = useState<Record<string, number>>(() => initialSeeds(targets));
  // 晚到的引擎也给一颗种子；已有的不动。
  useEffect(() => {
    setSeeds((s) => {
      const missing = targets.filter((t) => s[t.id] === undefined);
      return missing.some((t) => t.kind === 'local' && t.acceptsSeed) ? { ...initialSeeds(missing), ...s } : s;
    });
  }, [targets]);
  const [saving, setSaving] = useState(false);

  const index = Math.min(cur, steps.length - 1);
  const step = steps[index]!;
  const last = index === steps.length - 1;
  const seeded = chosen.filter((t) => t.kind === 'local' && t.acceptsSeed);
  const canNext =
    step.key === 'models'
      ? true
      : step.key === 'sample'
        ? !!sample && sampleVerdict(sample.seconds) !== 'short'
        : step.key === 'consent'
          ? consentReady(consentDraft, consentClip)
          : false;
  const keptConsent = consentReady(consentDraft, consentClip) ? consentClip : null;
  const plan = uploadPlan(chosen, { declared: consent, consentClip: !!keptConsent, sampleSeconds: sample?.seconds ?? null });
  const uploads = uploadTargets(plan);
  const consentTo = uploads.filter((t) => t.consent);
  // 保存前那条提醒：授权声明这次没传给要它的那家就不拿它说（本机引擎只用样本）。
  const takeWarnings = saveTakeWarnings({ sample, consent: consentTo.length ? keptConsent : null });
  const goTo = (i: number) => {
    const to = steps[Math.max(0, Math.min(i, steps.length - 1))];
    if (to?.key === 'consent' && !consentClip && sample?.via === 'mic' && sample.mic) setDeviceId(sample.mic.id);
    setCur(i);
  };
  const foot =
    step.key === 'models'
      ? chosen.length
        ? CC.footModels(names(chosen))
        : CC.footModelsNone
      : step.key === 'sample'
        ? sample
          ? CC.footSampleTaken(sample.seconds.toFixed(1))
          : CC.footSample
        : step.key === 'consent'
          ? CC.footConsent(step.needed.join(' / '))
          : uploads.length
            ? CC.outflow(names(uploads), consentTo.length ? names(consentTo) : null)
            : CC.outflowNone;

  const save = async () => {
    if (!sample) return;
    setSaving(true);
    try {
      const write = runtime.host.writeRecording?.bind(runtime.host);
      const samplePath = await writeClip(write, sample);
      const consentPath = keptConsent ? await writeClip(write, keptConsent) : null;
      const entry = await createCapturedVoice(runtime, {
        name: name.trim(),
        language: lang,
        transcript: '',
        origin: sample.via === 'mic' ? 'recorded' : 'imported',
        consent,
        seeds: Object.fromEntries(seeded.flatMap((t) => (seeds[t.id] !== undefined ? [[t.id, seeds[t.id]!]] : []))),
        samplePath,
        consentClip:
          keptConsent && consentPath
            ? {
                language: consentDraft.language,
                text: consentDraft.language === VOICE_CONSENT_CUSTOM ? consentDraft.custom.trim() : null,
                path: consentPath,
              }
            : null,
      });
      // 音色已经存好：上传各家互不影响，提交时被拒的留在那一行说原因，不当成保存失败。
      const sent = await Promise.all(uploads.map((t) => uploadClone(runtime, entry.id, t.id)));
      const started = uploads.filter((_, i) => sent[i]);
      ToastQueue.positive(started.length ? CC.savedUploading(entry.content.name, names(started)) : CC.saved(entry.content.name), {
        timeout: 5000,
      });
      for (const t of uploads.filter((_, i) => !sent[i])) ToastQueue.negative(COPY.cloneRejected(t.name), { timeout: 8000 });
      onSaved(entry.id);
    } catch (error) {
      ToastQueue.negative(CC.saveFailed(rpcErrorText(error)), { timeout: 8000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={wrap} aria-label={CC.newVoice}>
      <div>
        <ActionButton isQuiet size="S" onPress={onCancel}>
          <ChevronLeftIcon />
          <Text>{CC.back}</Text>
        </ActionButton>
      </div>
      <h2 className={title}>{CC.newVoice}</h2>
      <StepList steps={steps} cur={index} />
      {step.key === 'models' ? (
        <ModelsStep
          targets={targets}
          picked={picked}
          onToggle={(id) => setToggled((m) => ({ ...m, [id]: !picked.includes(id) }))}
        />
      ) : null}
      {step.key === 'sample' ? (
        <SampleStep
          chosen={chosen}
          lang={lang}
          setLang={(code) => {
            setLang(code);
          }}
          clip={sample}
          onClip={setSample}
          deviceId={deviceId}
          onDeviceId={setDeviceId}
        />
      ) : null}
      {step.key === 'consent' ? (
        <ConsentStep
          needed={step.needed}
          draft={consentDraft}
          setDraft={setConsentDraft}
          clip={consentClip}
          onClip={setConsentClip}
          sample={sample}
          deviceId={deviceId}
          onDeviceId={setDeviceId}
        />
      ) : null}
      {step.key === 'save' ? (
        <>
          <div className={row}>
            <span className={lab}>{CC.name}</span>
            <TextField
              aria-label={CC.name}
              placeholder={CC.namePlaceholder}
              value={name}
              maxLength={VOICE_NAME_MAX}
              onChange={setName}
              styles={field}
            />
          </div>
          {seeded.map((t) => (
            <div key={t.id} className={row}>
              <span className={lab}>{t.name}</span>
              <div className={chips}>
                <span className={detail}>{CC.seed}</span>
                <span className={seedValue}>{seeds[t.id]}</span>
                <ActionButton
                  isQuiet
                  size="S"
                  aria-label={CC.rerollLabel(t.name)}
                  onPress={() => setSeeds((s) => ({ ...s, [t.id]: randomSeed() }))}
                >
                  <RefreshIcon />
                  <Text>{CC.reroll}</Text>
                </ActionButton>
              </div>
            </div>
          ))}
          {seeded.length ? <p className={detail}>{CC.seedNote}</p> : null}
          <Checkbox isSelected={consent} onChange={setConsent}>
            {voiceConsentStatement()}
          </Checkbox>
          <Landing chosen={chosen} plan={plan} sampleSeconds={sample?.seconds ?? null} />
          <TakeWarning
            warnings={takeWarnings}
            uploadTo={names(uploads)}
            onRedo={(key) => goTo(steps.findIndex((s) => s.key === key))}
          />
        </>
      ) : null}
      <div className={acts}>
        {index > 0 ? (
          <Button variant="secondary" size="S" isDisabled={saving} onPress={() => goTo(index - 1)}>
            {CC.prev}
          </Button>
        ) : null}
        {!last ? (
          <Button variant="accent" size="S" isDisabled={!canNext} onPress={() => goTo(index + 1)}>
            {CC.next}
          </Button>
        ) : null}
        {step.key === 'consent' ? (
          <Button
            variant="secondary"
            fillStyle="outline"
            size="S"
            onPress={() => {
              setConsentClip(null);
              goTo(index + 1);
            }}
          >
            {CC.skipConsent}
          </Button>
        ) : null}
        {last ? (
          <Button variant="accent" size="S" isPending={saving} isDisabled={!sample || !name.trim()} onPress={() => void save()}>
            {uploads.length ? CC.saveUpload(names(uploads)) : CC.save}
          </Button>
        ) : null}
        <Button variant="secondary" size="S" isDisabled={saving} onPress={onCancel}>
          {CC.cancel}
        </Button>
        <span className={footText}>{foot}</span>
      </div>
    </section>
  );
}

/** 一家云端这次不上传的那一句（只写第一个原因：先写这一页上补不了的）。 */
function blockedText(r: UploadRow, sampleSeconds: number | null): string {
  switch (r.blockers[0]) {
    case 'offline':
      return CC.landingOffline;
    case 'undeclared':
      return CC.landingUndeclared;
    case 'too-short':
      return CC.landingTooShort((sampleSeconds ?? 0).toFixed(1), r.target.sourceSeconds?.min ?? SAMPLE.good);
    default:
      return CC.landingNoClip;
  }
}

/** 保存这一步的「会落到哪」：本机一行（要逐字稿的引擎另起一行），云端每家一行——保存后立即上传，或这次为什么不传。 */
function Landing({ chosen, plan, sampleSeconds }: { chosen: readonly CloneTarget[]; plan: readonly UploadRow[]; sampleSeconds: number | null }) {
  const local = chosen.filter((t) => t.kind === 'local');
  const transcript = local.filter((t) => t.needsTranscript);
  return (
    <div className={clipBox}>
      {local.length ? (
        <div className={row}>
          <span className={lab}>{CC.local}</span>
          <div className={stack}>
            <span className={detail}>{CC.landingLocal(names(local))}</span>
            {transcript.length ? <span className={warn}>{CC.landingTranscript(names(transcript))}</span> : null}
          </div>
        </div>
      ) : null}
      {plan.map((r) => (
        <div key={r.target.id} className={row}>
          <span className={lab}>{r.target.name}</span>
          {r.blockers.length ? (
            <span className={warn}>{blockedText(r, sampleSeconds)}</span>
          ) : (
            <span className={detail}>{[CC.landingUpload, r.usesFirst !== null ? CC.firstOnly(r.usesFirst) : null].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 给已有音色补录 / 重录授权声明（行上 ⋯）。`needed` 是要它的提供方名字。从克隆失败的补救过来时带 `resubmit`：存好后自动
 * 重新上传到那一家（按钮照实说），`tip` 是那次失败的「怎么办」。
 */
export function ConsentCapture({
  entry,
  needed,
  resubmit = null,
  tip = null,
  onCancel,
  onSaved,
}: {
  entry: VoiceEntry;
  needed: readonly string[];
  resubmit?: { providerId: string; label: string } | null;
  tip?: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const runtime = useRuntime();
  const previous = entry.content.consentClip ?? null;
  const [draft, setDraft] = useState<ConsentDraft>({ language: previous?.language ?? CONSENT_DEFAULT, custom: previous?.text ?? '' });
  const [clip, setClip] = useState<Clip | null>(null);
  const [saving, setSaving] = useState(false);
  const ok = consentReady(draft, clip);

  const save = async () => {
    if (!clip) return;
    setSaving(true);
    try {
      const path = await writeClip(runtime.host.writeRecording?.bind(runtime.host), clip);
      const text = draft.language === VOICE_CONSENT_CUSTOM ? draft.custom.trim() : null;
      await saveConsentClip(runtime, entry, { language: draft.language, text, path });
      if (!resubmit) ToastQueue.positive(CC.consentSaved(entry.content.name), { timeout: 4000 });
      else if (await uploadClone(runtime, entry.id, resubmit.providerId))
        ToastQueue.positive(CC.consentSavedUploading(entry.content.name, resubmit.label), { timeout: 5000 });
      else {
        ToastQueue.positive(CC.consentSaved(entry.content.name), { timeout: 4000 });
        ToastQueue.negative(COPY.cloneRejected(resubmit.label), { timeout: 8000 });
      }
      onSaved();
    } catch (error) {
      ToastQueue.negative(CC.saveFailed(rpcErrorText(error)), { timeout: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const heading = previous ? CC.consentTitleRedo(entry.content.name) : CC.consentTitle(entry.content.name);
  return (
    <section className={wrap} aria-label={heading}>
      <div>
        <ActionButton isQuiet size="S" onPress={onCancel}>
          <ChevronLeftIcon />
          <Text>{CC.back}</Text>
        </ActionButton>
      </div>
      <h2 className={title}>{heading}</h2>
      {tip ? <p className={warn}>{tip}</p> : null}
      <ConsentStep needed={needed} draft={draft} setDraft={setDraft} clip={clip} onClip={setClip} />
      {/* 只录授权声明：没有哪家要它就不提醒；样本早就存了，比不了麦克风。 */}
      <TakeWarning
        warnings={saveTakeWarnings({ sample: null, consent: needed.length || resubmit ? clip : null })}
        uploadTo={resubmit ? resubmit.label : needed.join(' / ')}
      />
      <div className={acts}>
        <Button variant="accent" size="S" isPending={saving} isDisabled={!ok} onPress={() => void save()}>
          {resubmit ? CC.saveClipUpload(resubmit.label) : CC.saveClip}
        </Button>
        <Button variant="secondary" size="S" isDisabled={saving} onPress={onCancel}>
          {CC.cancel}
        </Button>
        <span className={footText}>{needed.length ? CC.sameSpeaker(needed.join(' / ')) : CC.sameSpeakerAny}</span>
      </div>
    </section>
  );
}
