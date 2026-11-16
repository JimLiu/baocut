import { useEffect, useState } from 'react';
import type { RecordingSources } from '@baocut/protocol';
import { canPreview } from '../../model/recording.ts';
import { meterLevel } from '../../model/voice-capture.ts';

/*
 * 录制小窗里的摄像头画面与麦克风电平（屏幕录制设计 §11）：只在系统已经允许时才打开设备（`canPreview`），免得替 Worker 弹出授权窗口；
 * 浏览器的设备按名字对上 Worker 报的设备。
 */

const DEFAULT = 'default';

/** Worker 报的设备名（`default` 是系统缺省的麦克风）。 */
export function deviceName(sources: RecordingSources | null, kind: 'camera' | 'microphone', id: string | null): string | null {
  if (!id) return null;
  if (id === DEFAULT) return DEFAULT;
  const list = kind === 'camera' ? sources?.cameras : sources?.microphones;
  return list?.find((d) => d.id === id)?.name ?? null;
}

/** 浏览器的设备与 Worker 报的设备按名字对上（Chromium 在 USB 设备名后面加「 (vid:pid)」）。 */
async function findDevice(kind: MediaDeviceKind, name: string): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (name === DEFAULT) return devices.some((d) => d.kind === kind && d.deviceId === DEFAULT) ? DEFAULT : null;
  const hit = devices.find((d) => d.kind === kind && (d.label === name || d.label.startsWith(`${name} (`)));
  return hit?.deviceId ?? null;
}

/** 摄像头画面：`failed` 时只显示设备名。 */
export function useCameraStream(name: string | null, sources: RecordingSources | null): { stream: MediaStream | null; failed: boolean } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  const allowed = !!name && canPreview(sources?.permissions.camera);
  useEffect(() => {
    if (!allowed || !name) return;
    let s: MediaStream | null = null;
    let gone = false;
    setFailed(false);
    void (async () => {
      try {
        const deviceId = await findDevice('videoinput', name);
        if (!deviceId) return void (!gone && setFailed(true));
        s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
        if (gone) return s.getTracks().forEach((t) => t.stop());
        setStream(s);
      } catch {
        if (!gone) setFailed(true);
      }
    })();
    return () => {
      gone = true;
      s?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [allowed, name]);
  return { stream: allowed ? stream : null, failed: !allowed || failed };
}

/** 麦克风电平（0–1）：取不到设备时一直是 0。 */
export function useMicLevel(name: string | null, sources: RecordingSources | null): number {
  const [level, setLevel] = useState(0);
  const allowed = !!name && canPreview(sources?.permissions.microphone);
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
        /* 取不到设备：电平留空 */
      }
    })();
    return () => {
      gone = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setLevel(0);
    };
  }, [allowed, name]);
  return allowed ? level : 0;
}
