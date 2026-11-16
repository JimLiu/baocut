import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecordingPermissions, RecordingSources, RecordingTarget, SystemAccessState } from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  Picker,
  PickerItem,
  ProgressCircle,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  areaDisplay,
  choiceFromOptions,
  choiceOptions,
  COUNTDOWNS,
  lowDisk,
  permissionBlocked,
  resolveChoice,
  sourceBlocks,
  startBlock,
  type OptionBlock,
  type RecordingChoice,
  type RecordingNotice,
  unavailableCode,
} from '../../model/recording.ts';
import { formatBytes } from '../../model/space.ts';
import { meterLevel } from '../../model/voice-capture.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useRecordingPrefs, useRecordings, type RecordingPanelRequest } from '../../state/recordings-store.ts';
import { RC } from './recording-copy.ts';
import { loadSources, unsupportedText } from './recording-host.tsx';

/*
 * 录制面板（屏幕录制设计 §11）：Home、Space「新建」、编辑器素材面板与智能体的 `record` 打开同一个面板。
 * 八项：录什么、摄像头（带预览）、麦克风（带电平）、系统声音、鼠标、键盘、倒计时、开始。
 * - 每一路旁边是系统权限的状态；被拒的给「打开系统设置」，BaoCut 不替用户改。屏幕被拒时开始不可用；可选的一路被拒时去掉它才能开始。
 * - 「一个区域」由宿主的选框框出（桌面端主进程盖在所选屏幕上的透明窗口）；没有选框的宿主置灰。框好的区域记着，下次直接用。
 * - 整屏与区域有「把 BaoCut 也录进去」（`includeSelf`，缺省关）；录单个窗口时不显示（选的就是那个窗口）。
 * - 记住上次的选择（这台电脑的 localStorage）；设备不在时退回「不用」并提示。
 * - `sources` 给了剩余空间、不够录十分钟时提醒（只提醒，照样能开始）；录不了时按原因码说明。
 * - 智能体发起的（`recordingId`）预先填好它给的选项；关掉面板就是 `recordings.cancel`。
 * - 摄像头预览与电平条只在系统已经允许时才取设备（按名字对上 Worker 报的设备），不会因为打开面板弹出授权窗口。
 */

const body = style({ display: 'flex', flexDirection: 'column', gap: 16 });
const lead = style({ margin: 0, font: 'body-sm', color: 'gray-800' });
const field = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const label = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-800' });
const row = style({ display: 'flex', alignItems: 'start', gap: 12, minWidth: 0 });
const grow = style({ flexGrow: 1, minWidth: 0 });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const warn = style({ margin: 0, font: 'ui-sm', color: 'notice-900' });
const problem = style({ margin: 0, font: 'ui-sm', color: 'negative-900' });
const perm = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, font: 'ui-sm', color: 'gray-700' });
const waiting = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'body-sm', color: 'gray-700' });
const preview = style({
  flexShrink: 0,
  width: 144,
  height: 81,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  font: 'ui-xs',
  color: 'gray-600',
  textAlign: 'center',
  padding: 4,
  boxSizing: 'border-box',
});
const video = style({ width: 'full', height: 'full', objectFit: 'cover' });
const meter = style({ flexShrink: 0, width: 144, height: 8, marginTop: 16, borderRadius: 'full', backgroundColor: 'gray-200', overflow: 'hidden' });
const meterFill = style({ height: 'full', backgroundColor: 'positive-800', transition: 'none' });

const NONE = '__none';
const DEFAULT = 'default';

export function RecordingPanel({ request }: { request: RecordingPanelRequest }) {
  const runtime = useRuntime();
  const sourcesState = useRecordings((s) => s.sources);
  const waitingRec = useRecordings((s) => (request.recordingId ? (s.recordings.find((r) => r.recordingId === request.recordingId) ?? null) : null));
  const saved = useRecordingPrefs((s) => s.choice);
  // 帧率不在面板上：用户开始的用设置里的缺省，智能体发起的用它给的。
  const savedFps = useRecordingPrefs((s) => s.fps);
  const fps = waitingRec ? waitingRec.options.fps : savedFps;
  const [choice, setChoice] = useState<RecordingChoice | null>(null);
  const [notices, setNotices] = useState<RecordingNotice[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => void loadSources(runtime), [runtime]);

  const sources = sourcesState.status === 'ready' ? sourcesState.sources : sourcesState.status === 'loading' ? sourcesState.last : null;
  // 第一次拿到来源时把记下的（或智能体填好的）选择落到这台电脑的设备上。
  useEffect(() => {
    if (!sources || choice) return;
    const base = waitingRec ? choiceFromOptions(waitingRec.options, saved) : saved;
    const resolved = resolveChoice(base, sources, { areaPicker: !!runtime.host.recording?.pickArea });
    setChoice(resolved.choice);
    setNotices(resolved.notices);
  }, [sources, choice, waitingRec, saved, runtime]);

  // 智能体发起的那次被别处取消或开始了：面板跟着关。
  useEffect(() => {
    if (request.recordingId && waitingRec && waitingRec.state !== 'waiting' && !started.current) useRecordings.getState().closePanel();
  }, [request.recordingId, waitingRec]);

  const close = () => {
    useRecordings.getState().closePanel();
    if (!request.recordingId || started.current) return;
    useRecordings.getState().dismiss(request.recordingId);
    runtime.client.request('recordings.cancel', { recordingId: request.recordingId }).then(
      () => ToastQueue.neutral(RC.cancelled, { timeout: 4000 }),
      () => {},
    );
  };

  const start = async () => {
    if (!choice || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const options = choiceOptions(choice);
      if (request.recordingId) {
        await runtime.client.request('recordings.start', { recordingId: request.recordingId, options });
      } else {
        const target = await resolveTarget(runtime, request.target);
        await runtime.client.request('recordings.start', { options: { ...options, fps }, target });
      }
      started.current = true;
      useRecordingPrefs.getState().setChoice(choice);
      useRecordings.getState().closePanel();
    } catch (error) {
      setFailure(RC.startFailed(error instanceof Error ? error.message : String(error)));
      setBusy(false);
      void loadSources(runtime);
    }
  };

  const block = choice && sources ? startBlock(choice, sources) : null;
  const disk = choice && sources && sources.available ? lowDisk(choice, sources, fps) : null;
  const ready = !!choice && !!sources && block?.kind === 'ok';

  return (
    <DialogContainer onDismiss={close}>
      <Dialog size="L">
        <Heading slot="title">{request.recordingId ? RC.titleAgent : RC.title}</Heading>
        <Content>
          <div className={body}>
            {request.recordingId ? <p className={lead}>{RC.agentLead}</p> : null}
            {sourcesState.status === 'error' ? (
              <div className={perm}>
                <span className={problem}>{RC.loadFailed(sourcesState.message)}</span>
                <Button size="S" variant="secondary" onPress={() => void loadSources(runtime)}>
                  {RC.retry}
                </Button>
              </div>
            ) : null}
            {!sources && sourcesState.status !== 'error' ? (
              <div className={waiting}>
                <ProgressCircle size="S" isIndeterminate aria-label={RC.loading} />
                <span>{RC.loading}</span>
              </div>
            ) : null}
            {sources && !sources.available ? <p className={problem}>{unavailableLine(sources)}</p> : null}
            {notices.map((n) => (
              <p key={n.kind} className={warn}>
                {noticeText(n)}
              </p>
            ))}
            {sources && choice ? <RecordingFields sources={sources} choice={choice} onChange={setChoice} /> : null}
            {block && block.kind === 'permission' ? (
              <p className={problem}>{block.required ? RC.needScreen : RC.needOptional(block.missing.map(permName).join(', '))}</p>
            ) : null}
            {block && block.kind === 'unavailable' ? <p className={problem}>{RC.unavailable}</p> : null}
            {block && block.kind === 'no-area' ? <p className={note}>{RC.areaNeeded}</p> : null}
            {disk ? <p className={warn}>{RC.diskLow(formatBytes(disk.freeBytes), disk.minutes)}</p> : null}
            {failure ? <p className={problem}>{failure}</p> : null}
          </div>
        </Content>
        <ButtonGroup>
          <Button variant="secondary" onPress={close}>
            {RC.cancel}
          </Button>
          <Button variant="accent" isPending={busy} isDisabled={!ready} onPress={() => void start()}>
            {RC.start}
          </Button>
        </ButtonGroup>
      </Dialog>
    </DialogContainer>
  );
}

/** Home 的入口没选项目时先建一个「录制」项目，视频放进去（同新建空白视频）。 */
async function resolveTarget(runtime: RuntimeSession, target: RecordingPanelRequest['target']): Promise<RecordingTarget> {
  if (!('home' in target)) return target;
  const projectId = target.home.projectId ?? (await runtime.createProject(RC.defaultProject)).id;
  return { create: { projectId } };
}

export function RecordingFields({ sources, choice, onChange }: { sources: RecordingSources; choice: RecordingChoice; onChange(next: RecordingChoice): void }) {
  const runtime = useRuntime();
  const picker = runtime.host.recording?.pickArea;
  const [picking, setPicking] = useState(false);
  const set = (patch: Partial<RecordingChoice>) => onChange({ ...choice, ...patch });
  const blocks = sourceBlocks(sources, { areaPicker: !!picker });
  const sourceBlock = blocks[choice.source];
  const permissions = sources.permissions;
  const cameraName = choice.camera ? (sources.cameras.find((c) => c.id === choice.camera)?.name ?? null) : null;
  const micName =
    choice.microphone === DEFAULT
      ? DEFAULT
      : choice.microphone
        ? (sources.microphones.find((m) => m.id === choice.microphone)?.name ?? null)
        : null;
  const displays = useMemo(
    () =>
      sources.displays.map((d) => ({
        id: d.id,
        name: d.primary ? RC.displayMain(RC.displayName(d.name, d.width, d.height)) : RC.displayName(d.name, d.width, d.height),
      })),
    [sources.displays],
  );
  const primary = sources.displays.find((d) => d.primary)?.id ?? sources.displays[0]?.id ?? null;
  const unavailable = !sources.available;

  // 框一个区域：选框盖在所选屏幕上（应用窗口这时收起），框好了换成「一个区域」；取消时来源不变。
  // 主进程找不到这块屏幕时盖在主屏上，交回它自己的屏幕 ID；Worker 不认得那个 ID 时仍记成问的那块（见 host.ts）。
  const pickArea = async () => {
    if (!picker || picking) return;
    setPicking(true);
    try {
      const wanted = choice.displayId ?? primary;
      const result = await picker(wanted);
      if (!result) return;
      const known = sources.displays.some((d) => d.id === result.displayId);
      onChange({ ...choice, source: 'area', area: { displayId: known ? result.displayId : wanted, rect: result.rect } });
    } catch {
      /* 选框开不出来：来源不变 */
    } finally {
      setPicking(false);
    }
  };
  const areaShown = choice.source === 'area' && choice.area ? choice.area : null;
  const areaScreen = areaShown ? areaDisplay(areaShown, sources) : null;

  return (
    <>
      <div className={field}>
        <span className={label} id="rec-source">
          {RC.source}
        </span>
        <SegmentedControl
          aria-labelledby="rec-source"
          isDisabled={unavailable}
          selectedKey={choice.source}
          onSelectionChange={(key) => {
            if (key === 'area' && !choice.area) return void pickArea();
            set({ source: key as RecordingChoice['source'] });
          }}>
          <SegmentedControlItem id="display" isDisabled={!!blocks.display}>
            {RC.sourceDisplay}
          </SegmentedControlItem>
          <SegmentedControlItem id="window" isDisabled={!!blocks.window}>
            {RC.sourceWindow}
          </SegmentedControlItem>
          <SegmentedControlItem id="area" isDisabled={!!blocks.area}>
            {RC.sourceArea}
          </SegmentedControlItem>
        </SegmentedControl>
        {blocks.area ? <p className={note}>{blockOption(blocks.area)}</p> : null}
        {blocks.window && choice.source !== 'window' ? <p className={note}>{blockOption(blocks.window)}</p> : null}
        {sourceBlock ? <p className={warn}>{blockOption(sourceBlock)}</p> : null}
        {choice.source !== 'window' && displays.length > 1 ? (
          <Picker
            label={RC.display}
            items={displays}
            selectedKey={(choice.source === 'area' ? choice.area?.displayId : null) ?? choice.displayId ?? primary}
            // 区域换了屏幕要重新框。
            onSelectionChange={(key) => key !== null && set(choice.source === 'area' ? { displayId: String(key), area: null } : { displayId: String(key) })}>
            {(d) => <PickerItem id={d.id}>{d.name}</PickerItem>}
          </Picker>
        ) : null}
        {choice.source === 'area' ? (
          <div className={perm}>
            {areaShown ? (
              <span data-area>{RC.areaSummary(areaShown.rect.width, areaShown.rect.height, areaScreen?.name ?? '')}</span>
            ) : null}
            <Button size="S" variant="secondary" isPending={picking} isDisabled={unavailable || !picker} onPress={() => void pickArea()}>
              {areaShown ? RC.areaReselect : RC.areaSelect}
            </Button>
          </div>
        ) : null}
        {choice.source === 'window' && sources.windows.length ? (
          <Picker
            label={RC.window}
            items={sources.windows.map((w) => ({ id: w.id, name: RC.windowName(w.app, w.title) }))}
            selectedKey={choice.windowId}
            onSelectionChange={(key) => key !== null && set({ windowId: String(key) })}>
            {(w) => <PickerItem id={w.id}>{w.name}</PickerItem>}
          </Picker>
        ) : null}
        {choice.source !== 'window' ? (
          <>
            <Switch isDisabled={unavailable} isSelected={choice.includeSelf} onChange={(includeSelf) => set({ includeSelf })}>
              {RC.includeSelf}
            </Switch>
            <p className={note}>{RC.includeSelfHint}</p>
          </>
        ) : null}
        <PermissionLine permission="screen" state={permissions.screen} />
      </div>

      <div className={field}>
        <div className={row}>
          <div className={grow}>
            <Picker
              label={RC.camera}
              isDisabled={unavailable}
              items={[{ id: NONE, name: RC.none }, ...sources.cameras.map((c) => ({ id: c.id, name: c.name }))]}
              selectedKey={choice.camera ?? NONE}
              description={sources.cameras.length ? undefined : RC.noCamera}
              onSelectionChange={(key) => {
                if (key === null) return;
                const id = key === NONE ? null : String(key);
                set({ camera: id, cameraName: id ? (sources.cameras.find((c) => c.id === id)?.name ?? null) : null });
              }}>
              {(c) => <PickerItem id={c.id}>{c.name}</PickerItem>}
            </Picker>
          </div>
          {choice.camera ? <CameraPreview name={cameraName} state={permissions.camera} /> : null}
        </div>
        {choice.camera ? <PermissionLine permission="camera" state={permissions.camera} /> : null}
      </div>

      <div className={field}>
        <div className={row}>
          <div className={grow}>
            <Picker
              label={RC.microphone}
              isDisabled={unavailable}
              items={[
                { id: NONE, name: RC.none },
                { id: DEFAULT, name: RC.systemDefault },
                ...sources.microphones.map((m) => ({ id: m.id, name: m.name })),
              ]}
              selectedKey={choice.microphone ?? NONE}
              description={sources.microphones.length ? undefined : RC.noMicrophone}
              onSelectionChange={(key) => {
                if (key === null) return;
                const id = key === NONE ? null : String(key);
                set({ microphone: id, microphoneName: id && id !== DEFAULT ? (sources.microphones.find((m) => m.id === id)?.name ?? null) : null });
              }}>
              {(m) => <PickerItem id={m.id}>{m.name}</PickerItem>}
            </Picker>
          </div>
          {choice.microphone ? <MicLevel name={micName} state={permissions.microphone} /> : null}
        </div>
        {choice.microphone ? <PermissionLine permission="microphone" state={permissions.microphone} /> : null}
      </div>

      <div className={field}>
        <Switch isDisabled={unavailable} isSelected={choice.systemAudio} onChange={(systemAudio) => set({ systemAudio })}>
          {RC.systemAudio}
        </Switch>
        <p className={note}>{RC.systemAudioHint}</p>
      </div>

      <div className={field}>
        <Picker
          label={RC.cursor}
          isDisabled={unavailable}
          selectedKey={choice.cursor}
          description={choice.cursor === 'none' ? RC.cursorNoneNote : choice.cursor === 'separate' ? RC.cursorSeparateNote : undefined}
          onSelectionChange={(key) => key !== null && set({ cursor: key as RecordingChoice['cursor'] })}>
          <PickerItem id="separate">{RC.cursorSeparate}</PickerItem>
          <PickerItem id="baked">{RC.cursorBaked}</PickerItem>
          <PickerItem id="none">{RC.cursorNone}</PickerItem>
        </Picker>
      </div>

      <div className={field}>
        <Picker
          label={RC.keys}
          isDisabled={unavailable}
          selectedKey={choice.keys}
          description={choice.keys === 'all' ? RC.keysAllNote : undefined}
          onSelectionChange={(key) => key !== null && set({ keys: key as RecordingChoice['keys'] })}>
          <PickerItem id="off">{RC.keysOff}</PickerItem>
          <PickerItem id="shortcuts">{RC.keysShortcuts}</PickerItem>
          <PickerItem id="all">{RC.keysAll}</PickerItem>
        </Picker>
        {choice.keys !== 'off' ? <PermissionLine permission="inputMonitoring" state={permissions.inputMonitoring} /> : null}
      </div>

      <div className={field}>
        <Picker
          label={RC.countdown}
          isDisabled={unavailable}
          selectedKey={String(choice.countdown)}
          onSelectionChange={(key) => key !== null && set({ countdown: Number(key) })}>
          {COUNTDOWNS.map((n) => (
            <PickerItem key={n} id={String(n)}>
              {n ? RC.countdownSeconds(n) : RC.countdownNone}
            </PickerItem>
          ))}
        </Picker>
      </div>
    </>
  );
}

/** 录不了的原因：认得的原因码用自己的文字，否则用 Runtime 给的原因。 */
function unavailableLine(sources: RecordingSources): string {
  const code = unavailableCode(sources);
  return unsupportedText(code, code === sources.reason ? null : sources.reason);
}

function permName(p: keyof RecordingPermissions): string {
  return p === 'screen' ? RC.permScreen : p === 'camera' ? RC.permCamera : p === 'microphone' ? RC.permMicrophone : RC.permInput;
}

/** 一路的权限状态：允许了、开始时系统会问、被拒（给「打开系统设置」）。 */
function PermissionLine({ permission, state }: { permission: keyof RecordingPermissions; state: SystemAccessState }) {
  const runtime = useRuntime();
  const name = permName(permission);
  if (state === 'granted') return <span className={perm}>{RC.permStatus(name, RC.permGranted)}</span>;
  if (state === 'not-determined') return <span className={perm}>{RC.permStatus(name, RC.permAsk)}</span>;
  if (!permissionBlocked(state)) return <span className={perm}>{RC.permStatus(name, RC.permUnknown)}</span>;
  return (
    <span className={perm} data-permission={permission}>
      <span className={warn}>{RC.permDenied(name)}</span>
      {runtime.host.recording ? (
        <Button size="S" variant="secondary" onPress={() => void runtime.host.recording?.openSystemSettings(permission)}>
          {RC.openSettings}
        </Button>
      ) : null}
    </span>
  );
}

function blockOption(b: OptionBlock): string {
  switch (b.kind) {
    case 'no-display':
      return RC.noDisplay;
    case 'no-window':
      return RC.noWindow;
    case 'no-area-picker':
      return RC.noAreaPicker;
    case 'no-camera':
      return RC.noCamera;
    case 'no-microphone':
      return RC.noMicrophone;
  }
}

function noticeText(n: RecordingNotice): string {
  switch (n.kind) {
    case 'camera-gone':
      return RC.cameraGone(n.name);
    case 'microphone-gone':
      return RC.microphoneGone(n.name);
    case 'display-gone':
      return RC.displayGone;
    case 'window-gone':
      return RC.windowGone;
    case 'area-gone':
      return RC.areaGone;
  }
}

/** 浏览器的设备与 Worker 报的设备按名字对上（Chromium 在 USB 设备名后面加「 (vid:pid)」）。 */
async function findDevice(kind: MediaDeviceKind, name: string): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (name === DEFAULT) return devices.some((d) => d.kind === kind && d.deviceId === DEFAULT) ? DEFAULT : null;
  const hit = devices.find((d) => d.kind === kind && (d.label === name || d.label.startsWith(`${name} (`)));
  return hit?.deviceId ?? null;
}

/** 摄像头小预览：系统已经允许时才打开设备，不弹授权窗口。 */
function CameraPreview({ name, state }: { name: string | null; state: SystemAccessState }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const allowed = state === 'granted' && !!name;
  useEffect(() => {
    if (!allowed || !name) return;
    let stream: MediaStream | null = null;
    let gone = false;
    setFailed(false);
    void (async () => {
      try {
        const deviceId = await findDevice('videoinput', name);
        if (!deviceId || gone) return setFailed(!gone);
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
        if (gone) return stream.getTracks().forEach((t) => t.stop());
        if (ref.current) ref.current.srcObject = stream;
      } catch {
        if (!gone) setFailed(true);
      }
    })();
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [allowed, name]);
  return (
    <div className={preview} role="img" aria-label={RC.previewLabel}>
      {!allowed ? RC.previewUnavailable : failed ? RC.previewFailed : <video ref={ref} className={video} autoPlay muted playsInline />}
    </div>
  );
}

/** 麦克风电平条：系统已经允许时才打开设备，不弹授权窗口。 */
function MicLevel({ name, state }: { name: string | null; state: SystemAccessState }) {
  const [level, setLevel] = useState(0);
  const allowed = state === 'granted' && !!name;
  useEffect(() => {
    if (!allowed || !name) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;
    let gone = false;
    void (async () => {
      try {
        const deviceId = await findDevice('audioinput', name);
        if (!deviceId || gone) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
        if (gone) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const bytes = new Uint8Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(bytes);
          setLevel(meterLevel(bytes));
        }, 100);
      } catch {
        /* 取不到设备：电平条留空 */
      }
    })();
    return () => {
      gone = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [allowed, name]);
  return (
    <div
      className={meter}
      role="meter"
      aria-label={RC.levelLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      title={allowed ? RC.levelLabel : RC.levelUnavailable}>
      <div className={meterFill} style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}
