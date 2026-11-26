import { describe, expect, it } from 'vitest';
import { exportCliCommand, shellArg } from './export-cli.ts';

describe('exportCliCommand', () => {
  it('writes only the fields the settings carry, in CLI flag spelling', () => {
    expect(exportCliCommand('vid_1', { kind: 'video', format: 'mp4', burnCaptions: true })).toBe('baocut export vid_1 --kind video --format mp4');
    expect(exportCliCommand('vid_1', { kind: 'video', format: 'mp4', height: 720, crf: 26, burnCaptions: false })).toBe(
      'baocut export vid_1 --kind video --format mp4 --height 720 --crf 26 --no-burn-captions',
    );
    expect(exportCliCommand('vid_1', { kind: 'video', format: 'mp4', width: 1080, height: 1920, onUnsupported: 'skip' })).toBe(
      'baocut export vid_1 --kind video --format mp4 --width 1080 --height 1920 --on-unsupported skip',
    );
  });

  it('quotes the source when it is a dub group', () => {
    expect(exportCliCommand('vid_1', { kind: 'video', format: 'mp4', source: 'original' })).toBe('baocut export vid_1 --kind video --format mp4 --source original');
    expect(exportCliCommand('vid_1', { kind: 'video', format: 'mp4', source: { dubGroupId: 'g1' } })).toBe(
      `baocut export vid_1 --kind video --format mp4 --source '{"dubGroupId":"g1"}'`,
    );
  });

  it('quotes shell-unsafe arguments', () => {
    expect(shellArg('vid_abc-1')).toBe('vid_abc-1');
    expect(shellArg('my video')).toBe(`'my video'`);
    expect(shellArg(`it's`)).toBe(`'it'\\''s'`);
  });
});
