import { describe, expect, it } from 'vitest';
import { FFMPEG_DOWNLOAD_URL, ffmpegInstallHint, ffmpegMissingRemedy } from './install-hint.ts';

describe('ffmpegInstallHint', () => {
  it('gives each platform its own package manager', () => {
    expect(ffmpegInstallHint('darwin')).toContain('brew install ffmpeg');
    expect(ffmpegInstallHint('win32')).toContain('winget install --id Gyan.FFmpeg -e');
    expect(ffmpegInstallHint('linux')).toContain('apt install ffmpeg');
  });

  it('tells Windows users to reopen the app, since PATH is read at start', () => {
    expect(ffmpegInstallHint('win32')).toContain('重新打开 BaoCut');
    expect(ffmpegInstallHint('darwin')).not.toContain('重新打开');
  });

  it('falls back to the download page where there is no command to give', () => {
    expect(ffmpegInstallHint('freebsd')).toContain(FFMPEG_DOWNLOAD_URL);
  });

  it('never mixes another platform in', () => {
    expect(ffmpegInstallHint('win32')).not.toContain('brew');
    expect(ffmpegInstallHint('linux')).not.toContain('brew');
    expect(ffmpegInstallHint('darwin')).not.toContain('winget');
  });
});

describe('ffmpegMissingRemedy', () => {
  it('names the override variables alongside the install hint', () => {
    expect(ffmpegMissingRemedy({ platform: 'darwin' })).toBe('安装 ffmpeg（例如 brew install ffmpeg），或用 BAOCUT_FFMPEG 指定路径');
    const withProbe = ffmpegMissingRemedy({ ffprobe: true, platform: 'win32' });
    expect(withProbe).toContain('含 ffprobe');
    expect(withProbe).toContain('winget');
    expect(withProbe).toContain('BAOCUT_FFMPEG / BAOCUT_FFPROBE');
  });

  it('defaults to the platform it runs on', () => {
    expect(ffmpegMissingRemedy()).toBe(ffmpegMissingRemedy({ platform: process.platform }));
  });
});
