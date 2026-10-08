import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { MediaRegistry } from './media.ts';
import { MediaAnalysis } from './media-analysis.ts';

const ffmpeg = process.env.BAOCUT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.BAOCUT_FFPROBE || 'ffprobe';
const tools = (() => { try { execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); execFileSync(ffprobe, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe.skipIf(!tools)('WebM playback compatibility', () => {
  it('publishes H.264/AAC, retains real sound, reuses cache and leaves the source bytes intact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-playback-'));
    const analysis = new MediaAnalysis({ cacheDir: path.join(root, 'cache'), log: silentLogger, ffmpeg: async () => ({ command: ffmpeg, env: process.env }) });
    const registry = new MediaRegistry({ log: silentLogger, originAllowed: () => true });
    registry.setBaseUrl('http://localhost:12345');
    try {
      for (const [video, audio] of [['libvpx', 'libvorbis'], ['libvpx-vp9', 'libopus'], ['libvpx-vp9', null], [null, 'libopus']]) {
        const source = path.join(root, `clip ${video ?? 'audio'} ${audio ?? 'silent'} #.WEBM`);
        const args = ['-v', 'error', '-y'];
        if (video) args.push('-f', 'lavfi', '-i', 'testsrc2=size=162x90:rate=10:duration=1');
        if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1');
        if (video) args.push('-c:v', video, '-threads', '2');
        if (audio) args.push('-c:a', audio);
        execFileSync(ffmpeg, [...args, source], { stdio: 'pipe' });
        const before = await fs.readFile(source);
        const raw = await registry.issue(root, source);
        const prepare = (file: string) => analysis.playback(file);
        expect(await registry.playback(raw.url, prepare)).toMatchObject({ status: 'pending' });
        const deadline = Date.now() + 15_000;
        let result = await registry.playback(raw.url, prepare);
        while (result.status === 'pending') {
          expect(Date.now()).toBeLessThan(deadline);
          await new Promise(resolve => setTimeout(resolve, 20));
          result = await registry.playback(raw.url, prepare);
        }
        expect(result.media.fileName).toBe(raw.fileName);
        expect(result.media.url).not.toContain(root);
        const cached = await analysis.playback(await fs.realpath(source));
        expect(cached.status).toBe('ready');
        if (cached.status !== 'ready') throw new Error('not ready');
        const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', cached.file], { encoding: 'utf8' }));
        expect(probe.streams.some((s: { codec_name: string }) => s.codec_name === 'h264')).toBe(Boolean(video));
        expect(probe.streams.some((s: { codec_name: string }) => s.codec_name === 'aac')).toBe(Boolean(audio));
        expect(Math.abs(Number(probe.format.duration) - 1)).toBeLessThan(.15);
        if (audio) {
          const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', cached.file, '-vn', '-f', 'f32le', '-']);
          let loud = false;
          for (let offset = 0; offset + 4 <= pcm.length; offset += 4) loud ||= Math.abs(pcm.readFloatLE(offset)) > .01;
          expect(loud).toBe(true);
        }
        expect(await fs.readFile(source)).toEqual(before);
        expect((await registry.playback(raw.url, prepare)).status).toBe('ready');
        const stamp = (await fs.stat(cached.file)).mtimeMs;
        const restarted = new MediaAnalysis({ cacheDir: path.join(root, 'cache'), log: silentLogger, ffmpeg: async () => { throw new Error('must reuse cache'); } });
        expect(await restarted.playback(await fs.realpath(source))).toEqual(cached);
        expect((await fs.stat(cached.file)).mtimeMs).toBe(stamp);
        restarted.close();
      }
      const original = await registry.issue(root, (await fs.readdir(root)).find(name => name.endsWith('.WEBM'))!);
      await expect(registry.playback(original.url.replace('localhost:12345', 'attacker.example'), async () => { throw new Error('must not start'); })).rejects.toMatchObject({ code: 'not-found' });
      await expect(registry.playback('http://localhost:12345/media/forged/x', async () => { throw new Error('must not start'); })).rejects.toMatchObject({ code: 'not-found' });
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('does not publish partial output on failure and detects replaced sources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-playback-fail-'));
    const analysis = new MediaAnalysis({ cacheDir: root, log: silentLogger, ffmpeg: async () => ({ command: ffmpeg, env: process.env }) });
    try {
      await expect(analysis.playback(path.join(root, 'missing.webm'))).rejects.toMatchObject({ code: 'not-found' });
      const file = path.join(root, 'corrupt.webm');
      await fs.writeFile(file, 'not a movie');
      expect((await analysis.playback(file)).status).toBe('pending');
      let error: unknown;
      for (let i = 0; i < 100 && !error; i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        try { await analysis.playback(file); } catch (caught) { error = caught; }
      }
      expect(error).toBeTruthy();
      expect(await fs.readdir(path.join(root, 'playback'))).toEqual([]);
      // A replacement gets a new identity instead of reusing the cached failure.
      await fs.writeFile(file, 'another invalid movie');
      expect((await analysis.playback(file)).status).toBe('pending');
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  });
});
