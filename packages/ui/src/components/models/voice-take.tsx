import { useEffect, useRef, useState } from 'react';
import {
  ActionButton,
  Button,
  Content,
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  ProgressBar,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from '@react-spectrum/s2';
import AlertTriangleIcon from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircleIcon from '@react-spectrum/s2/icons/CheckmarkCircle';
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone';
import PauseIcon from '@react-spectrum/s2/icons/Pause';
import PlayIcon from '@react-spectrum/s2/icons/Play';
import RefreshIcon from '@react-spectrum/s2/icons/Refresh';
import UploadIcon from '@react-spectrum/s2/icons/Upload';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  CAPTURE_SAMPLE_RATE,
  analyzeTake,
  clock,
  downmix,
  encodeWav,
  feedLiveTake,
  limitUnit,
  liveTakeHint,
  meterLevel,
  micMismatch,
  recordingNote,
  recordingProgress,
  redoSteps,
  startLiveTake,
  takeIssues,
  type LiveTake,
  type LiveTakeHint,
  type MicIdentity,
  type RecordingSpec,
  type SaveTakeWarning,
  type TakeAnalysis,
} from '../../model/voice-capture.ts';
import { CAPTURE_COPY as CC } from './voices-copy.ts';

/**
 * 克隆新音色里的一段录音（设计稿 settings-voice-take.jsx）：麦克风或上传，录音中电平下面一行当场提示（爆音、没声音、太小声、太吵），
 * 停下后一句判词带具体办法；麦克风可以由父级拿着（样本与授权声明共用一只，换了别的就提醒）。保存前那条提醒 `TakeWarning` 也在这里。
 * 门槛与判断在 model/voice-capture.ts（`analyzeTake` 一组）。
 */

const row = style({ display: 'flex', alignItems: 'start', gap: 12, minWidth: 0 });
const lab = style({ flexShrink: 0, width: 112, paddingTop: 4, font: 'ui-sm', color: 'gray-700' });
const chips = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexGrow: 1, minWidth: 0 });
const detail = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const warn = style({ margin: 0, font: 'ui-xs', color: 'notice-900', overflowWrap: 'anywhere' });
const negative = style({ margin: 0, font: 'ui-xs', color: 'negative-900', overflowWrap: 'anywhere' });
const clipBox = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const recLine = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, minWidth: 0 });
const timer = style({ font: 'code-lg', color: { default: 'gray-800', isLive: 'negative-900' }, fontVariantNumeric: 'tabular-nums' });
const grow = style({ flexGrow: 1, flexBasis: 0, minWidth: 160 });
const meter = style({ display: 'inline-flex', alignItems: 'end', gap: 2, height: 16 });
const bar = style({ width: 4, height: 'full', borderRadius: 'sm', backgroundColor: { default: 'gray-200', isLit: 'positive' } });
const takeLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  minHeight: 20,
  font: 'ui-sm',
  color: { default: 'gray-700', isPositive: 'positive-900', isNotice: 'notice-900' },
  overflowWrap: 'anywhere',
});
const takeTitle = style({ fontWeight: 'bold' });
const noticeIcon = iconStyle({ size: 'S', color: 'notice' });
const positiveIcon = iconStyle({ size: 'S', color: 'positive' });
const neutralIcon = iconStyle({ size: 'S', color: 'neutral' });
const warnList = style({ margin: 0, paddingStart: 20 });
const warnActs = style({ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 8 });

/** 一段录好（或解码好）的音频：单声道 16 位 WAV。 */
export interface Clip {
  bytes: Uint8Array;
  seconds: number;
  via: 'mic' | 'upload';
  /** 上传的文件名。 */
  name: string | null;
  /** 上传的比上限长，只取了前面。 */
  trimmed: boolean;
  /** 音质读数：停下后的判词、保存前的提醒。 */
  analysis: TakeAnalysis;
  /** 麦克风录的：用的那只（`label` 为 null 是系统默认）；上传的 null。 */
  mic: (MicIdentity & { label: string | null }) | null;
}

/** 上限写成「3 分钟」「15 秒」。 */
export function limitText(seconds: number): string {
  const { unit, value } = limitUnit(seconds);
  return unit === 'minutes' ? CC.limitMinutes(value) : CC.limitSeconds(value);
}

/** 解码一段音频（麦克风录的 WebM / 上传的 WAV、MP3、M4A、FLAC），混成单声道、重采样到 48 kHz、截到上限，写成 WAV，顺手量音质。 */
async function toWav(data: ArrayBuffer, maxSeconds: number): Promise<Omit<Clip, 'via' | 'name' | 'mic'>> {
  const ctx = new OfflineAudioContext(1, 1, CAPTURE_SAMPLE_RATE);
  const audio = await ctx.decodeAudioData(data);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const mono = downmix(channels, audio.sampleRate, maxSeconds);
  return {
    bytes: encodeWav(mono, audio.sampleRate),
    seconds: mono.length / audio.sampleRate,
    trimmed: audio.duration > maxSeconds + 0.05,
    analysis: analyzeTake(mono, audio.sampleRate),
  };
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

/** 录音中电平下面那一行：要改的用提醒色，合适的用正向色。 */
function LiveLine({ hint }: { hint: LiveTakeHint }) {
  const notice = hint !== 'ok' && hint !== 'waiting';
  return (
    <p className={takeLine({ isNotice: notice, isPositive: hint === 'ok' })} role="status">
      {notice ? <AlertTriangleIcon styles={noticeIcon} aria-hidden /> : hint === 'ok' ? <CheckmarkCircleIcon styles={positiveIcon} aria-hidden /> : <MicrophoneIcon styles={neutralIcon} aria-hidden />}
      <span>{CC.takeLive[hint]}</span>
    </p>
  );
}

/** 停下后的判词：一句原因 + 一句办法；干净的报好。只提醒，不拦。 */
function VerdictLine({ analysis }: { analysis: TakeAnalysis }) {
  const issues = takeIssues(analysis);
  const first = issues[0];
  return (
    <p className={takeLine({ isNotice: !!first, isPositive: !first })}>
      {first ? <AlertTriangleIcon styles={noticeIcon} aria-hidden /> : <CheckmarkCircleIcon styles={positiveIcon} aria-hidden />}
      <span>
        <span className={takeTitle}>{first ? CC.takeTitle(issues.map((k) => CC.takeIssue[k])) : CC.takeOk}</span>
        {` · ${first ? CC.takeFix[first] : CC.takeOkFix}`}
      </span>
    </p>
  );
}

interface InputDevice {
  id: string;
  label: string;
  group: string;
}

/**
 * 一段录音：麦克风（选输入设备、电平、计时 `mm:ss.s / 00:30.0`，进度条朝目标走；到目标后想多说可以接着说，最后几秒倒数，
 * 到上限自动停；听一遍、重录）或上传一个音频文件（超过上限取前面）。录音中一行当场提示，停下后一句判词。
 * 停下或选好文件后 `onClip(clip)`，重录 / 换文件时 `onClip(null)`；`clip` 是父级已经拿着的那段（换步回来照它恢复）。
 * `deviceId` / `onDeviceId` 给了就由父级拿着麦克风；`sample` 给了（授权声明这一步）就比它录时用的那只，不是同一只时提醒
 * `needed`（要授权声明的提供方）可能认不出是同一个人。
 */
export function ClipRecorder({
  spec,
  clip,
  onClip,
  hint,
  deviceId: heldDevice,
  onDeviceId,
  sample = null,
  needed = [],
}: {
  spec: RecordingSpec;
  clip: Clip | null;
  onClip: (clip: Clip | null) => void;
  hint: string;
  deviceId?: string;
  onDeviceId?: (id: string) => void;
  sample?: Clip | null;
  needed?: readonly string[];
}) {
  const [via, setVia] = useState<'mic' | 'upload'>(clip?.via ?? 'mic');
  const [phase, setPhase] = useState<'idle' | 'rec' | 'reading'>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [liveHint, setLiveHint] = useState<LiveTakeHint>('waiting');
  const [error, setError] = useState<string | null>(null);
  /** 带标签的输入设备（含系统默认那一项：靠它的 `groupId` 认出默认的是哪一只）；拿到麦克风权限前标签是空的，列不出来。 */
  const [inputs, setInputs] = useState<InputDevice[]>([]);
  const [ownDevice, setOwnDevice] = useState('default');
  const deviceId = heldDevice ?? ownDevice;
  const setDeviceId = onDeviceId ?? setOwnDevice;
  const live = useRef<{ stream: MediaStream; recorder: MediaRecorder; ctx: AudioContext; timer: number } | null>(null);
  const take = useRef<LiveTake | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const playback = usePlayback();

  const devices = inputs.filter((d) => d.id !== 'default');
  const identity = (id: string): MicIdentity => {
    const group = inputs.find((d) => d.id === id)?.group;
    return group ? { id, group } : { id };
  };
  const micLabel = (id: string, label: string | null = null) =>
    id === 'default' ? CC.defaultDevice : (label ?? devices.find((d) => d.id === id)?.label ?? CC.defaultDevice);

  const listDevices = async () => {
    const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
    setInputs(
      (all ?? []).filter((d) => d.kind === 'audioinput' && d.label).map((d) => ({ id: d.deviceId, label: d.label, group: d.groupId })),
    );
  };

  // 选的那只拔掉了（列得出设备、里面却没有它）：退回系统默认，免得开录时报错。
  useEffect(() => {
    if (devices.length && deviceId !== 'default' && !devices.some((d) => d.id === deviceId)) setDeviceId('default');
  }, [inputs, deviceId]);

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

  const finish = async (data: ArrayBuffer, from: Clip['via'], name: string | null, mic: Clip['mic']) => {
    try {
      const wav = await toWav(data, spec.max);
      onClip({ ...wav, via: from, name, mic });
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
    // 录的是哪一只：物理设备按音轨报的 groupId（系统默认也认得出），名字按选的那项。
    const group = stream.getAudioTracks()[0]?.getSettings().groupId;
    const mic: Clip['mic'] = {
      id: deviceId,
      ...(group ? { group } : {}),
      label: deviceId === 'default' ? null : (devices.find((d) => d.id === deviceId)?.label ?? null),
    };
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      release();
      void new Blob(chunks, { type: recorder.mimeType })
        .arrayBuffer()
        .then((data) => finish(data, 'mic', null, mic))
        .catch((e: unknown) => {
          setError(CC.readFailed(errorMessage(e)));
          setPhase('idle');
        });
    };
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    // 约 0.09 秒一帧，每 0.1 秒取一次：几乎每一段都量得到，录音中的提示不漏掉短促的爆音。
    analyser.fftSize = 4096;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const bytes = new Uint8Array(analyser.fftSize);
    const floats = new Float32Array(analyser.fftSize);
    take.current = startLiveTake(ctx.sampleRate);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const s = (performance.now() - startedAt) / 1000;
      setSecs(Math.min(s, spec.max));
      analyser.getByteTimeDomainData(bytes);
      setLevel(meterLevel(bytes));
      analyser.getFloatTimeDomainData(floats);
      const now = feedLiveTake(take.current ?? startLiveTake(ctx.sampleRate), floats, s);
      take.current = now;
      setLiveHint(liveTakeHint(now, s));
      if (s >= spec.max) stop();
    }, 100);
    live.current = { stream, recorder, ctx, timer };
    setSecs(0);
    setLiveHint('waiting');
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
    await finish(await file.arrayBuffer(), 'upload', file.name, null);
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
  // 授权声明这一步：和录样本的那只比（已录就看录时用的，没录就看现在选的）。
  const sampleMic = sample?.via === 'mic' ? sample.mic : null;
  const mismatch = via === 'mic' && !!sampleMic && micMismatch(sample, clip, identity(deviceId));
  const canSwitchBack =
    mismatch && phase === 'idle' && !!sampleMic && deviceId !== sampleMic.id && (sampleMic.id === 'default' || devices.some((d) => d.id === sampleMic.id));

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
                    <Text slot="label">{d.label}</Text>
                    {sampleMic?.id === d.id ? <Text slot="description">{CC.sampleMic}</Text> : null}
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
      {phase === 'rec' ? <LiveLine hint={liveHint} /> : phase === 'idle' && clip && clip.via === via ? <VerdictLine analysis={clip.analysis} /> : null}
      {mismatch && sampleMic ? (
        <div className={recLine}>
          <span className={`${grow} ${warn}`}>
            {clip?.mic
              ? CC.micTaken(micLabel(sampleMic.id, sampleMic.label), micLabel(clip.mic.id, clip.mic.label), needed.join(' / '))
              : CC.micNow(micLabel(sampleMic.id, sampleMic.label), micLabel(deviceId), needed.join(' / '))}
          </span>
          {canSwitchBack ? (
            <Button variant="secondary" size="S" onPress={() => setDeviceId(sampleMic.id)}>
              <MicrophoneIcon />
              <Text>{CC.switchMic(micLabel(sampleMic.id, sampleMic.label))}</Text>
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className={negative}>{error}</p> : null}
    </div>
  );
}

/**
 * 保存前那条提醒（只提醒，不拦，干净的不显示）：`uploadTo` 是这次要传的提供方名字（空就是只存本机）；`onRedo` 给了就带
 * 「重录样本」「重录授权声明」，回到那一步。
 */
export function TakeWarning({
  warnings,
  uploadTo,
  onRedo,
}: {
  warnings: readonly SaveTakeWarning[];
  uploadTo: string;
  onRedo?: (step: 'sample' | 'consent') => void;
}) {
  if (!warnings.length) return null;
  const issues = (step: SaveTakeWarning['step']) =>
    warnings.flatMap((w) => (w.step === step && w.kind !== 'mic' ? [CC.takeIssue[w.kind]] : []));
  const sampleIssues = issues('sample');
  const consentIssues = issues('consent');
  const items = [
    sampleIssues.length ? CC.warnSample(sampleIssues) : null,
    consentIssues.length ? CC.warnConsent(consentIssues) : null,
    warnings.some((w) => w.kind === 'mic') ? CC.warnMic : null,
  ].filter((t): t is string => !!t);
  return (
    <InlineAlert variant="notice">
      <Heading>{uploadTo ? CC.warnTitle(uploadTo) : CC.warnTitleLocal}</Heading>
      <Content>
        <ul className={warnList}>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {uploadTo ? CC.warnBody : CC.warnBodyLocal}
        {onRedo ? (
          <div className={warnActs}>
            {redoSteps(warnings).map((step) => (
              <Button key={step} variant="secondary" size="S" onPress={() => onRedo(step)}>
                <RefreshIcon />
                <Text>{step === 'sample' ? CC.redoSample : CC.redoConsent}</Text>
              </Button>
            ))}
          </div>
        ) : null}
      </Content>
    </InlineAlert>
  );
}
