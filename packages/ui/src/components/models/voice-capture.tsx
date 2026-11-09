import { useEffect, useMemo, useRef, useState } from 'react';
import { intlLocale } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Checkbox,
  Picker,
  PickerItem,
  ProgressBar,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TextArea,
  TextField,
  ToastQueue,
  ToggleButton,
} from '@react-spectrum/s2';
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft';
import EditIcon from '@react-spectrum/s2/icons/Edit';
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone';
import PauseIcon from '@react-spectrum/s2/icons/Pause';
import PlayIcon from '@react-spectrum/s2/icons/Play';
import RefreshIcon from '@react-spectrum/s2/icons/Refresh';
import UploadIcon from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  CAPTURE_SAMPLE_RATE,
  CONSENT_COMMON,
  CONSENT_DEFAULT,
  CONSENT_REC,
  SAMPLE,
  VOICE_CONSENT_CUSTOM,
  clock,
  cloneSteps,
  consentLanguageName,
  consentMore,
  consentPhrase,
  consentTooShort,
  defaultPicked,
  defaultScriptLanguage,
  defaultVoiceName,
  downmix,
  encodeWav,
  firstSecondsUsed,
  initialCloneStep,
  initialSeeds,
  limitUnit,
  meterLevel,
  randomSeed,
  recordingNote,
  recordingProgress,
  sampleScript,
  sampleTooShortFor,
  sampleVerdict,
  scriptLanguages,
  uploadPlan,
  uploadTargets,
  type CloneStep,
  type CloneTarget,
  type RecordingSpec,
  type UploadRow,
} from '../../model/voice-capture.ts';
import { rpcErrorText, voiceConsentStatement, VOICE_NAME_MAX, type VoiceEntry } from '../../model/voices-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useVoices } from '../../state/voices-store.ts';
import { createCapturedVoice, saveConsentClip, uploadClone } from './voice-actions.ts';
import { CAPTURE_COPY as CC, MY_VOICES_COPY as COPY } from './voices-copy.ts';

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
const negative = style({ margin: 0, font: 'ui-xs', color: 'negative-900', overflowWrap: 'anywhere' });
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
const recLine = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, minWidth: 0 });
const timer = style({ font: 'code-lg', color: { default: 'gray-800', isLive: 'negative-900' }, fontVariantNumeric: 'tabular-nums' });
const grow = style({ flexGrow: 1, flexBasis: 0, minWidth: 160 });
const meter = style({ display: 'inline-flex', alignItems: 'end', gap: 2, height: 16 });
const bar = style({ width: 4, height: 'full', borderRadius: 'sm', backgroundColor: { default: 'gray-200', isLit: 'positive' } });
const seedValue = style({ font: 'code-sm', color: 'gray-900', userSelect: 'text' });
const field = style({ width: 'full', maxWidth: 400 });
const acts = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 12 });
const footText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });

/** 一段录好（或解码好）的音频：单声道 16 位 WAV。 */
export interface Clip {
  bytes: Uint8Array;
  seconds: number;
  via: 'mic' | 'upload';
  /** 上传的文件名。 */
  name: string | null;
  /** 上传的比上限长，只取了前面。 */
  trimmed: boolean;
}

/** 上限写成「3 分钟」「15 秒」。 */
function limitText(seconds: number): string {
  const { unit, value } = limitUnit(seconds);
  return unit === 'minutes' ? CC.limitMinutes(value) : CC.limitSeconds(value);
}

const names = (list: readonly Pick<CloneTarget, 'name'>[]) => list.map((t) => t.name).join(' / ');

/** 解码一段音频（麦克风录的 WebM / 上传的 WAV、MP3、M4A、FLAC），混成单声道、重采样到 48 kHz、截到上限，写成 WAV。 */
async function toWav(data: ArrayBuffer, maxSeconds: number): Promise<Omit<Clip, 'via' | 'name'>> {
  const ctx = new OfflineAudioContext(1, 1, CAPTURE_SAMPLE_RATE);
  const audio = await ctx.decodeAudioData(data);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const mono = downmix(channels, audio.sampleRate, maxSeconds);
  return { bytes: encodeWav(mono, audio.sampleRate), seconds: mono.length / audio.sampleRate, trimmed: audio.duration > maxSeconds + 0.05 };
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Meter({ level, on }: { level: number; on: boolean }) {
  return (
    <span className={meter} role="meter" aria-label={CC.level} aria-valuemin={0} aria-valuemax={1} aria-valuenow={on ? level : 0}>
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className={bar({ isLit: on && level * 14 > i })} />
      ))}
    </span>
  );
}

/** 试听一段录音（同一时间只放一段）。 */
function usePlayback() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const stop = () => {
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPlaying(false);
  };
  useEffect(() => stop, []);
  const toggle = (clip: Clip) => {
    if (playing) return stop();
    const el = audio.current ?? (audio.current = new Audio());
    url.current = URL.createObjectURL(new Blob([clip.bytes.slice()], { type: 'audio/wav' }));
    el.src = url.current;
    el.onended = stop;
    setPlaying(true);
    void el.play().catch(stop);
  };
  return { playing, toggle, stop };
}

/** 录音时计时旁边的一句。 */
function noteText(seconds: number, spec: RecordingSpec): string {
  const note = recordingNote(seconds, spec);
  switch (note.kind) {
    case 'need':
      return CC.needMore(note.seconds.toFixed(1));
    case 'enough':
      return CC.enoughBest(clock(spec.target));
    case 'plenty':
      return CC.plenty;
    case 'left':
      return CC.left(note.seconds.toFixed(1));
    case 'stop':
      return CC.autoStop;
  }
}

/**
 * 一段录音：麦克风（选输入设备、电平、计时 `mm:ss.s / 00:30.0`，进度条朝目标走；到目标后想多说可以接着说，最后几秒倒数，
 * 到上限自动停；听一遍、重录）或上传一个音频文件（超过上限取前面）。
 * 停下或选好文件后 `onClip(clip)`，重录 / 换文件时 `onClip(null)`；`clip` 是父级已经拿着的那段（换步回来照它恢复）。
 */
function ClipRecorder({ spec, clip, onClip, hint }: { spec: RecordingSpec; clip: Clip | null; onClip: (clip: Clip | null) => void; hint: string }) {
  const [via, setVia] = useState<'mic' | 'upload'>(clip?.via ?? 'mic');
  const [phase, setPhase] = useState<'idle' | 'rec' | 'reading'>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState('default');
  const live = useRef<{ stream: MediaStream; recorder: MediaRecorder; ctx: AudioContext; timer: number } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const playback = usePlayback();

  const listDevices = async () => {
    const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
    setDevices(
      (all ?? [])
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.label)
        .map((d) => ({ id: d.deviceId, label: d.label })),
    );
  };

  const release = () => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    window.clearInterval(l.timer);
    for (const track of l.stream.getTracks()) track.stop();
    void l.ctx.close().catch(() => undefined);
  };

  useEffect(() => {
    void listDevices();
    return () => {
      const l = live.current;
      if (l && l.recorder.state !== 'inactive') {
        l.recorder.ondataavailable = null;
        l.recorder.onstop = null;
        l.recorder.stop();
      }
      release();
    };
  }, []);

  const finish = async (data: ArrayBuffer, from: Clip['via'], name: string | null) => {
    try {
      const wav = await toWav(data, spec.max);
      onClip({ ...wav, via: from, name });
      setSecs(wav.seconds);
    } catch (e) {
      setError(CC.readFailed(errorMessage(e)));
    } finally {
      setPhase('idle');
    }
  };

  const stop = () => {
    const l = live.current;
    if (!l) return;
    window.clearInterval(l.timer);
    setLevel(0);
    setPhase('reading');
    if (l.recorder.state !== 'inactive') l.recorder.stop();
  };

  const start = async () => {
    playback.stop();
    setError(null);
    onClip(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? CC.micDenied : CC.micFailed(errorMessage(e)));
      return;
    }
    void listDevices();
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      release();
      void new Blob(chunks, { type: recorder.mimeType })
        .arrayBuffer()
        .then((data) => finish(data, 'mic', null))
        .catch((e: unknown) => {
          setError(CC.readFailed(errorMessage(e)));
          setPhase('idle');
        });
    };
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const frame = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const s = (performance.now() - startedAt) / 1000;
      setSecs(Math.min(s, spec.max));
      analyser.getByteTimeDomainData(frame);
      setLevel(meterLevel(frame));
      if (s >= spec.max) stop();
    }, 100);
    live.current = { stream, recorder, ctx, timer };
    setSecs(0);
    setPhase('rec');
    recorder.start(250);
  };

  const switchVia = (key: string) => {
    if (phase !== 'idle') return;
    playback.stop();
    setVia(key as Clip['via']);
    setError(null);
    setSecs(0);
    onClip(null);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    playback.stop();
    setError(null);
    onClip(null);
    setPhase('reading');
    await finish(await file.arrayBuffer(), 'upload', file.name);
  };

  const recNote = noteText(secs, spec);
  // 到目标之前写「已录 / 目标」；过了目标只写已录的（上限在说明与最后几秒的倒数里）。
  const timeText = (s: number) => (s < spec.target ? `${clock(s)} / ${clock(spec.target)}` : clock(s));
  const limit = limitText(spec.max);
  const playButton = clip ? (
    <ActionButton size="S" aria-label={playback.playing ? CC.stopPlay : CC.play} onPress={() => playback.toggle(clip)}>
      {playback.playing ? <PauseIcon /> : <PlayIcon />}
    </ActionButton>
  ) : null;

  return (
    <div className={clipBox}>
      <div className={row}>
        <span className={lab}>{CC.source}</span>
        <div className={chips}>
          <SegmentedControl aria-label={CC.source} selectedKey={via} onSelectionChange={(key) => switchVia(String(key))}>
            <SegmentedControlItem id="mic">
              <MicrophoneIcon />
              <Text>{CC.mic}</Text>
            </SegmentedControlItem>
            <SegmentedControlItem id="upload">
              <UploadIcon />
              <Text>{CC.upload}</Text>
            </SegmentedControlItem>
          </SegmentedControl>
          {via === 'mic' ? (
            <>
              <Picker
                aria-label={CC.device}
                size="S"
                menuWidth={260}
                isDisabled={phase !== 'idle'}
                selectedKey={deviceId}
                onSelectionChange={(key) => setDeviceId(key === null ? 'default' : String(key))}
              >
                {[{ id: 'default', label: CC.defaultDevice }, ...devices].map((d) => (
                  <PickerItem key={d.id} id={d.id} textValue={d.label}>
                    {d.label}
                  </PickerItem>
                ))}
              </Picker>
              <Meter level={level} on={phase === 'rec'} />
            </>
          ) : null}
        </div>
      </div>

      {via === 'mic' ? (
        <div className={recLine}>
          {phase === 'rec' ? (
            <>
              <Button variant="negative" onPress={stop}>
                {CC.stop}
              </Button>
              <span className={timer({ isLive: true })} role="timer" aria-live="off">
                {timeText(secs)}
              </span>
              <ProgressBar
                size="S"
                aria-label={CC.progress}
                value={recordingProgress(secs, spec)}
                styles={style({ flexGrow: 1, minWidth: 120 })}
              />
              <span className={recordingNote(secs, spec).kind === 'left' ? warn : detail}>{recNote}</span>
            </>
          ) : phase === 'reading' ? (
            <span className={detail}>{CC.reading}</span>
          ) : clip ? (
            <>
              {playButton}
              <span className={timer({})}>{clock(clip.seconds)}</span>
              <span className={`${grow} ${detail}`}>{clip.seconds >= spec.max - 0.05 ? CC.stoppedAtMax(limit) : hint}</span>
              <Button variant="secondary" size="S" onPress={() => void start()}>
                <RefreshIcon />
                <Text>{CC.again}</Text>
              </Button>
            </>
          ) : (
            <>
              <Button variant="accent" onPress={() => void start()}>
                <MicrophoneIcon />
                <Text>{CC.start}</Text>
              </Button>
              <span className={timer({})}>{timeText(0)}</span>
              <span className={`${grow} ${detail}`}>{hint}</span>
            </>
          )}
        </div>
      ) : (
        <div className={recLine}>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.flac"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void pickFile(file);
            }}
          />
          {phase === 'reading' ? (
            <span className={detail}>{CC.reading}</span>
          ) : clip ? (
            <>
              {playButton}
              <span className={timer({})}>{clock(clip.seconds)}</span>
              <span className={`${grow} ${detail}`}>
                {[clip.name, clip.trimmed ? CC.trimmed(limit) : null, hint].filter(Boolean).join(' · ')}
              </span>
              <Button variant="secondary" size="S" onPress={() => fileInput.current?.click()}>
                <RefreshIcon />
                <Text>{CC.otherFile}</Text>
              </Button>
            </>
          ) : (
            <>
              <Button variant="accent" onPress={() => fileInput.current?.click()}>
                <UploadIcon />
                <Text>{CC.pickFile}</Text>
              </Button>
              <span className={`${grow} ${detail}`}>{CC.uploadHint(spec.min, spec.target, limit)}</span>
            </>
          )}
        </div>
      )}
      {error ? <p className={negative}>{error}</p> : null}
    </div>
  );
}

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
}: {
  chosen: readonly CloneTarget[];
  lang: string;
  setLang: (code: string) => void;
  clip: Clip | null;
  onClip: (c: Clip | null) => void;
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
      <ClipRecorder spec={SAMPLE} clip={clip} onClip={onClip} hint={hint} />
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
}: {
  needed: readonly string[];
  draft: ConsentDraft;
  setDraft: (d: ConsentDraft) => void;
  clip: Clip | null;
  onClip: (c: Clip | null) => void;
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
        />
      ) : null}
      {step.key === 'consent' ? (
        <ConsentStep needed={step.needed} draft={consentDraft} setDraft={setConsentDraft} clip={consentClip} onClip={setConsentClip} />
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
        </>
      ) : null}
      <div className={acts}>
        {index > 0 ? (
          <Button variant="secondary" size="S" isDisabled={saving} onPress={() => setCur(index - 1)}>
            {CC.prev}
          </Button>
        ) : null}
        {!last ? (
          <Button variant="accent" size="S" isDisabled={!canNext} onPress={() => setCur(index + 1)}>
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
              setCur(index + 1);
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
