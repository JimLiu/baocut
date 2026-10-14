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

describe.skipIf(!tools)('media playback compatibility', () => {
  it.each([false, true])('prepares baked ProRes (alpha=%s), preserving transparency, timing, audio and original bytes', async (alpha) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-prores-playback-'));
    const tool = (command: string) => async () => ({ command, env: process.env });
    const analysis = new MediaAnalysis({ cacheDir: path.join(root, 'cache'), log: silentLogger, ffmpeg: tool(ffmpeg), ffprobe: tool(ffprobe) });
    const registry = new MediaRegistry({ log: silentLogger, originAllowed: () => true });
    registry.setBaseUrl('http://localhost:12345');
    try {
      const source = path.join(root, 'baked animation #.mov');
      execFileSync(ffmpeg, [
        '-v', 'error', '-y', '-f', 'lavfi', '-i',
        "nullsrc=size=162x90:rate=10:duration=1,format=rgba,geq=r='if(lt(T,0.5),255,0)':g=0:b='if(lt(T,0.5),0,255)':a='if(lt(X,W/2),0,128)'",
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'prores_ks', '-profile:v', alpha ? '4444' : '3', '-pix_fmt', alpha ? 'yuva444p10le' : 'yuv422p10le',
        '-threads', '2', '-c:a', 'pcm_s16le', source,
      ], { stdio: 'pipe' });
      const before = await fs.readFile(source);
      const raw = await registry.issue(root, source);
      expect(raw.mimeType).toBe('video/quicktime');
      const prepare = (file: string, mimeType: string) => analysis.playback(file, ['vp9', 'opus'], mimeType);
      expect(await registry.playback(raw.url, prepare)).toMatchObject({ status: 'pending' });
      const deadline = Date.now() + 15_000;
      let result = await registry.playback(raw.url, prepare);
      while (result.status === 'pending') {
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise(resolve => setTimeout(resolve, 20));
        result = await registry.playback(raw.url, prepare);
      }
      expect(result.media).toMatchObject({ fileName: raw.fileName, mimeType: alpha ? 'video/webm' : 'video/mp4' });
      const cached = await prepare(await fs.realpath(source), raw.mimeType);
      if (cached.status !== 'ready') throw new Error('not ready');
      const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', cached.file], { encoding: 'utf8' }));
      expect(probe.streams[0].codec_name).toBe(alpha ? 'vp9' : 'h264');
      expect(probe.streams[1].codec_name).toBe(alpha ? 'opus' : 'aac');
      expect(Math.abs(Number(probe.format.duration) - 1)).toBeLessThan(.15);
      // Seek both ways, decode real pixels, and check the two colors plus transparent / translucent regions.
      for (const at of [0.8, 0.2]) {
        const pixels = execFileSync(ffmpeg, [
          '-v', 'error', '-ss', String(at), ...(alpha ? ['-c:v', 'libvpx-vp9'] : []), '-i', cached.file,
          '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
        ]);
        const offset = (45 * 162 + 120) * 4;
        expect(pixels[offset + (at < .5 ? 0 : 2)]).toBeGreaterThan(220);
        expect(pixels[offset + (at < .5 ? 2 : 0)]).toBeLessThan(30);
        if (alpha) {
          expect(pixels[(45 * 162 + 20) * 4 + 3]).toBe(0);
          expect(pixels[offset + 3]).toBeGreaterThan(120);
          expect(pixels[offset + 3]).toBeLessThan(136);
        } else expect(pixels[offset + 3]).toBe(255);
      }
      const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', cached.file, '-vn', '-f', 'f32le', '-']);
      expect(Array.from({ length: pcm.length / 4 }, (_, i) => Math.abs(pcm.readFloatLE(i * 4))).some(v => v > .01)).toBe(true);
      expect(await fs.readFile(source)).toEqual(before);
      expect(await prepare(await fs.realpath(source), raw.mimeType)).toEqual(cached);
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('refuses unprobed QuickTime instead of silently discarding possible alpha', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-prores-unprobed-'));
    const analysis = new MediaAnalysis({ cacheDir: root, log: silentLogger, ffmpeg: async () => { throw new Error('must not encode'); } });
    try {
      const source = path.join(root, 'unknown.mov');
      await fs.writeFile(source, 'unknown');
      await expect(analysis.playback(source, [], 'video/quicktime')).rejects.toMatchObject({ code: 'internal' });
      expect(await fs.readdir(root)).toEqual(['unknown.mov']);
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  });

  it('preserves WebM alpha when an unsupported audio codec requires conversion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-webm-alpha-'));
    const tool = (command: string) => async () => ({ command, env: process.env });
    const analysis = new MediaAnalysis({ cacheDir: root, log: silentLogger, ffmpeg: tool(ffmpeg), ffprobe: tool(ffprobe) });
    try {
      const source = path.join(root, 'alpha.webm');
      execFileSync(ffmpeg, [
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red@0.5:size=162x90:rate=10:duration=1,format=rgba',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-threads', '2', '-c:a', 'libvorbis', source,
      ], { stdio: 'pipe' });
      const real = await fs.realpath(source);
      expect(await analysis.playback(real, ['vp9', 'vorbis'])).toEqual({ status: 'original' });
      let result = await analysis.playback(real, ['vp9', 'opus']);
      const deadline = Date.now() + 15_000;
      while (result.status === 'pending') {
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise(resolve => setTimeout(resolve, 20));
        result = await analysis.playback(real, ['vp9', 'opus']);
      }
      if (result.status !== 'ready') throw new Error('not ready');
      expect(result.file).toMatch(/\.webm$/);
      const pixels = execFileSync(ffmpeg, ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', result.file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
      expect(pixels[3]).toBeGreaterThan(120);
      expect(pixels[3]).toBeLessThan(136);
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 20_000);

  it('rejects a playlist renamed to MOV without following its file references', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-mov-whitelist-'));
    const analysis = new MediaAnalysis({ cacheDir: root, log: silentLogger,
      ffmpeg: async () => { throw new Error('must not encode'); }, ffprobe: async () => ({ command: ffprobe, env: process.env }) });
    try {
      const source = path.join(root, 'playlist.mov');
      await fs.writeFile(source, "ffconcat version 1.0\nfile 'outside.mov'\n");
      await expect(analysis.playback(source, [], 'video/quicktime')).rejects.toMatchObject({ code: 'internal' });
      expect(await fs.readdir(root)).toEqual(['playlist.mov']);
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  });

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

  it('plays the original when the client decodes its codecs and prepares a copy otherwise', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-playback-native-'));
    const tool = (command: string) => async () => ({ command, env: process.env });
    const analysis = new MediaAnalysis({ cacheDir: path.join(root, 'cache'), log: silentLogger, ffmpeg: tool(ffmpeg), ffprobe: tool(ffprobe) });
    const blind = new MediaAnalysis({ cacheDir: path.join(root, 'blind'), log: silentLogger, ffmpeg: tool(ffmpeg) });
    const registry = new MediaRegistry({ log: silentLogger, originAllowed: () => true });
    registry.setBaseUrl('http://localhost:12345');
    try {
      const source = path.join(root, 'clip.webm');
      execFileSync(ffmpeg, [
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=162x90:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libvpx-vp9', '-threads', '2', '-c:a', 'libopus', source,
      ], { stdio: 'pipe' });
      const raw = await registry.issue(root, source);
      const playable = (codecs: string[]) => (file: string) => analysis.playback(file, codecs);
      expect(await registry.playback(raw.url, playable(['vp9', 'opus']))).toEqual({ status: 'ready', media: raw });
      // 声音的编码不在里面：照旧做兼容副本。
      expect(await registry.playback(raw.url, playable(['vp9']))).toMatchObject({ status: 'pending' });
      const deadline = Date.now() + 15_000;
      let result = await registry.playback(raw.url, playable(['vp9']));
      while (result.status === 'pending') {
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise(resolve => setTimeout(resolve, 20));
        result = await registry.playback(raw.url, playable(['vp9']));
      }
      expect(result.media.mimeType).toBe('video/mp4');
      // 有了兼容副本，能直接放的客户端仍拿原文件。
      expect(await registry.playback(raw.url, playable(['vp8', 'vp9', 'opus']))).toEqual({ status: 'ready', media: raw });
      // 没有 ffprobe 认不出编码：一律做兼容副本。
      const real = await fs.realpath(source);
      let blindResult = await blind.playback(real, ['vp9', 'opus']);
      expect(blindResult).toMatchObject({ status: 'pending' });
      // 等副本发布后再清理夹具，避免后台建缓存目录与 fs.rm 竞争。
      const blindDeadline = Date.now() + 15_000;
      while (blindResult.status === 'pending') {
        expect(Date.now()).toBeLessThan(blindDeadline);
        await new Promise(resolve => setTimeout(resolve, 20));
        blindResult = await blind.playback(real, ['vp9', 'opus']);
      }
      if (blindResult.status !== 'ready') throw new Error('not ready');
      const blindProbe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', blindResult.file], { encoding: 'utf8' }));
      expect(blindProbe.streams.map((stream: { codec_name: string }) => stream.codec_name)).toEqual(['h264', 'aac']);
    } finally { analysis.close(); blind.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 60_000); // Two 15 s conversion budgets, plus fixture creation, probing and cleanup.

  it.skipIf(process.platform === 'win32')('reports the copy\'s encode progress against the probed duration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-playback-progress-'));
    // 假的 ffmpeg：报一次编到 1 秒，然后一直编下去（关掉时被杀）。
    const fake = path.join(root, 'ffmpeg');
    await fs.writeFile(fake, "#!/bin/sh\nprintf 'frame=10\\nout_time_us=1000000\\nprogress=continue\\n'\nexec sleep 30\n", { mode: 0o755 });
    const analysis = new MediaAnalysis({
      cacheDir: path.join(root, 'cache'),
      log: silentLogger,
      ffmpeg: async () => ({ command: fake, env: process.env }),
      ffprobe: async () => ({ command: ffprobe, env: process.env }),
    });
    try {
      const source = path.join(root, 'clip.webm');
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=162x90:rate=10:duration=2', '-c:v', 'libvpx', source], { stdio: 'pipe' });
      const real = await fs.realpath(source);
      expect(await analysis.playback(real)).toMatchObject({ status: 'pending', retryAfterMs: 250 });
      const deadline = Date.now() + 10_000;
      let result = await analysis.playback(real);
      while (result.status === 'pending' && result.progress === undefined) {
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise(resolve => setTimeout(resolve, 20));
        result = await analysis.playback(real);
      }
      expect(result).toMatchObject({ status: 'pending' });
      if (result.status !== 'pending') throw new Error('not pending');
      expect(result.progress).toBeCloseTo(0.5, 1);
    } finally { analysis.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 20_000);

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
