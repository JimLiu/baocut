import type { RecordingSources } from '@baocut/protocol';
import { devicePill, type DevicePill, type RecordingChoice, type RecordingNotice } from '../../model/recording.ts';
import { RC } from './recording-copy.ts';
import { deviceName } from './recording-media.ts';
import { RS } from './recording-surface-copy.ts';

/** 摄像头或麦克风此刻的样子：选的设备（或上次选、现在不在的）、名字、药丸。启动器的设备行与录制卡的小控件共用。 */
export interface DeviceView {
  kind: 'camera' | 'microphone';
  /** 选的设备 ID；没选或不在了时 null。 */
  id: string | null;
  /** Worker 报的名字（给 `getUserMedia` 对设备）；没有时 null。 */
  name: string | null;
  label: string;
  pill: DevicePill;
  pillText: string;
}

export function deviceView(kind: 'camera' | 'microphone', choice: RecordingChoice, sources: RecordingSources | null, notices: readonly RecordingNotice[]): DeviceView {
  const id = kind === 'camera' ? choice.camera : choice.microphone;
  const gone = notices.find((n) => n.kind === (kind === 'camera' ? 'camera-gone' : 'microphone-gone')) as { name: string | null } | undefined;
  const name = deviceName(sources, kind, id);
  const permission = sources ? (kind === 'camera' ? sources.permissions.camera : sources.permissions.microphone) : null;
  // 选着系统缺省而这台电脑一个麦克风都没有：照样能录（Runtime 不录这一路），药丸说明没连上。
  const none = kind === 'microphone' && id === 'default' && !!sources?.available && sources.microphones.length === 0;
  const pill = devicePill({ permission, on: !!id || !!gone, connected: !none && (!gone || !!id) });
  const label = id
    ? name === 'default'
      ? RC.systemDefault
      : (name ?? (kind === 'camera' ? choice.cameraName : choice.microphoneName) ?? id)
    : gone?.name && pill.state === 'missing'
      ? gone.name
      : kind === 'camera'
        ? RS.noCamera
        : RS.noMicrophone;
  return { kind, id, name, label, pill, pillText: pillText(pill) };
}

export function pillText(p: DevicePill): string {
  return p.state === 'on' ? RS.pillOn : p.state === 'off' ? RS.pillOff : p.state === 'missing' ? RS.pillMissing : RS.pillAllow;
}

/** 设备列表（第一项「不用」；麦克风多一项系统缺省）。 */
export function deviceItems(kind: 'camera' | 'microphone', sources: RecordingSources | null): Array<{ id: string; label: string }> {
  const none = { id: 'none', label: kind === 'camera' ? RS.noCamera : RS.noMicrophone };
  if (kind === 'camera') return [none, ...(sources?.cameras ?? []).map((c) => ({ id: c.id, label: c.name }))];
  return [none, { id: 'default', label: RC.systemDefault }, ...(sources?.microphones ?? []).map((m) => ({ id: m.id, label: m.name }))];
}

/** 列表里选定一项换成选择的改动。 */
export function devicePatch(kind: 'camera' | 'microphone', id: string, sources: RecordingSources | null): Partial<RecordingChoice> {
  const real = id === 'none' ? null : id;
  const name = real && real !== 'default' ? deviceName(sources, kind, real) : null;
  return kind === 'camera' ? { camera: real, cameraName: name } : { microphone: real, microphoneName: name };
}

/** 设备不在了的提示（摄像头另有自己的一句）。 */
export function noticeText(n: RecordingNotice): string {
  switch (n.kind) {
    case 'camera-gone':
      return n.name ? RS.cameraMissing(n.name) : RC.cameraGone(null);
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

/** 拖动把手：两列三行的圆点（与原型的 drag 图形同一套几何）。 */
export function DragDots() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" role="img" aria-hidden="true" fill="currentColor">
      {[4.8, 10, 15.2].flatMap((y) => [6.6, 13.4].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.35} />))}
    </svg>
  );
}
