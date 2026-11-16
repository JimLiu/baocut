#!/usr/bin/env node
/**
 * Fake Recording Worker for tests: speaks the same JSON-line protocol as `crates/recording-worker` (see `worker-protocol.ts`)
 * and writes the same on-disk layout, but synthesizes tiny media files with ffmpeg (lavfi) instead of capturing anything.
 *
 * The scenario comes from `BAOCUT_FAKE_RECORDING` (JSON):
 * - `ffmpeg`: ffmpeg command (default `ffmpeg`);
 * - `supported`: false makes `hello` report that capture is unavailable;
 * - `permissions`: overrides of the permission states reported by `sources`;
 * - `cameraDelayMs`: the camera's first sample arrives this long after the segment starts;
 * - `loseCameraAfterMs`: the camera disconnects this long into the first segment;
 * - `crashAfterMs`: the worker writes the media of the open segment and exits with code 1 this long after `start`,
 *   leaving the journal without its end lines (like a crash with fragmented MP4 files on disk);
 * - `startError`: `start` answers with this error (`{code, message}`), like the system refusing a permission at start.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { WorkerStartParams } from '../worker-protocol.ts';

interface Scenario {
  ffmpeg?: string;
  supported?: boolean;
  permissions?: Record<string, string>;
  cameraDelayMs?: number;
  loseCameraAfterMs?: number;
  crashAfterMs?: number;
  startError?: { code: string; message: string };
  /** Write the params of every `start` call to this file (JSON), so tests can check what the Runtime sent. */
  startParamsFile?: string;
}

type Role = 'screen' | 'camera' | 'microphone' | 'system-audio';

interface OpenStream {
  role: Role;
  file: string;
  startNs: bigint;
  endNs: bigint | null;
  lost: boolean;
}

interface Segment {
  id: string;
  startNs: bigint;
  streams: OpenStream[];
}

const scenario: Scenario = JSON.parse(process.env.BAOCUT_FAKE_RECORDING || '{}');
const ffmpeg = scenario.ffmpeg ?? 'ffmpeg';
const now = () => process.hrtime.bigint();

let dir: string | null = null;
let config: { camera: string | null; microphone: string | null; systemAudio: boolean; cursor: string; keys: string; fps: number } | null = null;
let segment: Segment | null = null;
let segmentCount = 0;
let cameraLost = false;
const timers: NodeJS.Timeout[] = [];

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function journal(line: Record<string, unknown>): void {
  fs.appendFileSync(path.join(dir!, 'journal.jsonl'), `${JSON.stringify(line)}\n`);
}

function synthesize(stream: OpenStream, endNs: bigint): void {
  const seconds = Math.max(0.2, Number(endNs - stream.startNs) / 1e9).toFixed(3);
  const out = path.join(dir!, stream.file);
  const video = (size: string, rate: number) => [
    ...['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${rate}:duration=${seconds}`],
    // H.264 like the real Worker: Chromium cannot play MPEG-4 Part 2, so the editor would report the source as unplayable.
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-bf', '0'],
  ];
  const audio = (frequency: number) => [
    ...['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`],
    ...['-c:a', 'aac'],
  ];
  const args =
    stream.role === 'screen'
      ? video('320x180', config!.fps)
      : stream.role === 'camera'
        ? video('160x120', 30)
        : audio(stream.role === 'microphone' ? 440 : 880);
  // The title keeps segments of the same length from producing identical bytes (the engine imports by content).
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, '-metadata', `title=${stream.file}`, out], { stdio: 'ignore' });
}

/** Pointer events for a segment: a sweep from the top left towards the centre with one click halfway. */
function writePointer(seg: Segment, endNs: bigint): void {
  const file = `${seg.id}-pointer.jsonl`;
  const lines: string[] = [];
  const span = endNs - seg.startNs;
  const steps = 10;
  for (let n = 0; n <= steps; n++) {
    const t = seg.startNs + (span * BigInt(n)) / BigInt(steps);
    lines.push(JSON.stringify([t.toString(), 'm', 0.1 + (0.4 * n) / steps, 0.1 + (0.4 * n) / steps]));
    if (n === 0) lines.push(JSON.stringify([t.toString(), 'c', 'arrow']));
    if (n === steps / 2) {
      lines.push(JSON.stringify([t.toString(), 'b', 0, 1]));
      lines.push(JSON.stringify([(t + 1_000_000n).toString(), 'b', 0, 0]));
    }
  }
  fs.writeFileSync(path.join(dir!, file), `${lines.join('\n')}\n`);
  journal({ type: 'pointer', segmentId: seg.id, file });
}

function writeKeys(seg: Segment, endNs: bigint): void {
  const file = `${seg.id}-keys.jsonl`;
  const mid = seg.startNs + (endNs - seg.startNs) / 2n;
  const typed = config!.keys === 'all';
  const lines = [
    [mid.toString(), 'MetaLeft', 1, typed ? 'Meta' : ''],
    [(mid + 1_000_000n).toString(), 'KeyS', 1, typed ? 's' : ''],
    [(mid + 2_000_000n).toString(), 'KeyS', 0, typed ? 's' : ''],
    [(mid + 3_000_000n).toString(), 'MetaLeft', 0, typed ? 'Meta' : ''],
  ];
  fs.writeFileSync(path.join(dir!, file), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  journal({ type: 'keys', segmentId: seg.id, file });
}

function openSegment(): Segment {
  segmentCount += 1;
  const seg: Segment = { id: `s${segmentCount}`, startNs: now(), streams: [] };
  segment = seg;
  journal({ type: 'segment', id: seg.id, startNs: seg.startNs.toString() });
  const roles: Array<{ role: Role; delayMs: number; device?: { id: string; name: string } }> = [
    { role: 'screen', delayMs: 0, device: { id: 'display-1', name: 'Fake Display' } },
  ];
  if (config!.camera && !cameraLost) roles.push({ role: 'camera', delayMs: scenario.cameraDelayMs ?? 0, device: { id: config!.camera, name: 'Fake Camera' } });
  if (config!.microphone) roles.push({ role: 'microphone', delayMs: 0, device: { id: config!.microphone, name: 'Fake Microphone' } });
  if (config!.systemAudio) roles.push({ role: 'system-audio', delayMs: 0 });
  for (const { role, delayMs, device } of roles) {
    const begin = () => {
      if (segment !== seg) return;
      const stream: OpenStream = { role, file: `${seg.id}-${role}.${role === 'screen' || role === 'camera' ? 'mp4' : 'm4a'}`, startNs: now(), endNs: null, lost: false };
      seg.streams.push(stream);
      journal({ type: 'stream', role, segmentId: seg.id, file: stream.file, startNs: stream.startNs.toString(), ...(device ? { device } : {}) });
      send({ event: 'stream', params: { role, segmentId: seg.id, startNs: stream.startNs.toString() } });
    };
    if (delayMs > 0) timers.push(setTimeout(begin, delayMs));
    else begin();
  }
  if (segmentCount === 1 && scenario.loseCameraAfterMs !== undefined && config!.camera) {
    timers.push(
      setTimeout(() => {
        const camera = seg.streams.find((s) => s.role === 'camera');
        if (!camera || segment !== seg) return;
        const at = now();
        camera.endNs = at;
        camera.lost = true;
        cameraLost = true;
        synthesize(camera, at);
        journal({ type: 'stream-end', role: 'camera', segmentId: seg.id, endNs: at.toString(), lost: true });
        send({ event: 'device-lost', params: { role: 'camera', segmentId: seg.id, atNs: at.toString() } });
      }, scenario.loseCameraAfterMs),
    );
  }
  return seg;
}

function closeSegment(seg: Segment, writeEnds: boolean): bigint {
  const at = now();
  for (const stream of seg.streams) {
    if (stream.endNs !== null) continue;
    stream.endNs = at;
    synthesize(stream, at);
    if (writeEnds) journal({ type: 'stream-end', role: stream.role, segmentId: seg.id, endNs: at.toString() });
  }
  if (config!.cursor !== 'none') writePointer(seg, at);
  if (config!.keys !== 'off') writeKeys(seg, at);
  if (writeEnds) journal({ type: 'segment-end', id: seg.id, endNs: at.toString() });
  return at;
}

function handle(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'hello':
      return {
        protocol: 1,
        version: '0.0.0-fake',
        platform: 'fake',
        capture: scenario.supported === false ? { supported: false, reason: 'unsupported-platform' } : { supported: true },
      };
    case 'sources':
      return {
        permissions: { screen: 'granted', camera: 'granted', microphone: 'granted', inputMonitoring: 'not-determined', ...scenario.permissions },
        displays: [{ id: 'display-1', name: 'Fake Display', width: 320, height: 180, scale: 1, primary: true }],
        windows: [
          {
            id: 'window-7',
            title: 'Fake Window',
            app: 'Fake App',
            width: 200,
            height: 100,
            bounds: { displayId: 'display-1', x: 40, y: 30, width: 200, height: 100 },
            order: 0,
          },
          {
            id: 'window-8',
            title: 'Fake Editor',
            app: 'Fake App',
            width: 160,
            height: 120,
            bounds: { displayId: 'display-1', x: 200, y: 90, width: 160, height: 120 },
            order: 1,
          },
          {
            id: 'window-9',
            title: 'Fake Notes',
            app: 'Fake Notes',
            width: 120,
            height: 80,
            bounds: { displayId: 'display-1', x: -20, y: 10, width: 120, height: 80 },
            order: 2,
          },
        ],
        cameras: [{ id: 'cam-1', name: 'Fake Camera', default: true }],
        microphones: [{ id: 'mic-1', name: 'Fake Microphone', default: true }],
      };
    case 'start': {
      if (segment) throw { code: 'ALREADY_RECORDING', message: 'A recording is already running' };
      if (scenario.startParamsFile) fs.writeFileSync(scenario.startParamsFile, JSON.stringify(params));
      if (scenario.startError) throw scenario.startError;
      dir = String(params.dir);
      fs.mkdirSync(dir, { recursive: true });
      const p = params as unknown as WorkerStartParams;
      const started = { camera: p.camera ?? null, microphone: p.microphone ?? null, systemAudio: Boolean(p.systemAudio), cursor: p.cursor, keys: p.keys, fps: p.fps ?? 30 };
      config = started;
      const capture = { kind: p.source.kind, width: 320, height: 180, scale: 1 };
      journal({
        type: 'begin',
        recorder: { name: 'baocut', version: '0.0.0-fake' },
        platform: 'fake',
        startedAt: new Date().toISOString(),
        cursor: started.cursor,
        keyboard: started.keys === 'off' ? null : started.keys,
        capture,
      });
      if (started.cursor === 'separate') {
        const file = 'cursor-arrow.png';
        execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=16x16', '-frames:v', '1', path.join(dir, file)], { stdio: 'ignore' });
        journal({ type: 'cursor', id: 'arrow', file, hotspot: { x: 0.1, y: 0.1 }, scale: 1, shape: 'arrow' });
      }
      segment = openSegment();
      if (scenario.crashAfterMs !== undefined) {
        timers.push(
          setTimeout(() => {
            if (segment) closeSegment(segment, false);
            process.exit(1);
          }, scenario.crashAfterMs),
        );
      }
      return { segmentId: segment.id, atNs: segment.startNs.toString(), cursor: started.cursor, capture };
    }
    case 'pause': {
      if (!segment) throw { code: 'NOT_RECORDING', message: 'Not recording' };
      const seg = segment;
      segment = null;
      const at = closeSegment(seg, true);
      return { segmentId: seg.id, atNs: at.toString() };
    }
    case 'resume': {
      if (segment || !config) throw { code: 'NOT_PAUSED', message: 'Not paused' };
      segment = openSegment();
      return { segmentId: segment.id, atNs: segment.startNs.toString() };
    }
    case 'stop': {
      if (!config) throw { code: 'NOT_RECORDING', message: 'Not recording' };
      if (segment) closeSegment(segment, true);
      segment = null;
      for (const timer of timers) clearTimeout(timer);
      return { journal: path.join(dir!, 'journal.jsonl') };
    }
    default:
      throw { code: 'UNKNOWN_METHOD', message: `Unknown method ${method}` };
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let request: { id: number; method: string; params?: Record<string, unknown> };
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  try {
    send({ id: request.id, result: handle(request.method, request.params ?? {}) });
  } catch (error) {
    const body = error && typeof error === 'object' && 'code' in error ? error : { code: 'INTERNAL', message: String(error) };
    send({ id: request.id, error: body });
  }
});
lines.on('close', () => {
  for (const timer of timers) clearTimeout(timer);
  process.exit(0);
});
