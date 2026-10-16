import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contactSheetArgs, sheetColumns, writeContactSheet } from './contact-sheet.ts';

const ffmpeg = process.env.BAOCUT_FFMPEG ?? 'ffmpeg';
const hasFfmpeg = spawnSync(ffmpeg, ['-version']).status === 0;

describe('contact sheet', () => {
  it('lays cells out row-major in a near-square grid', () => {
    expect([1, 2, 4, 5, 9, 10, 24].map(sheetColumns)).toEqual([1, 2, 2, 3, 3, 4, 5]);
    const frames = Array.from({ length: 5 }, (_, i) => ({ file: `f${i}.png` }));
    const plan = contactSheetArgs(frames, { width: 1920, height: 1080 }, 'out.png');
    expect(plan).toMatchObject({ columns: 3, rows: 2, cellWidth: 480, cellHeight: 270 });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('color=c=0x808080:s=1456x552');
    // 第 5 格（index 4）在第二行第二列。
    expect(graph).toContain('[bg4][c4]overlay=488+(480-w)/2:278+(270-h)/2');
  });

  it('keeps small canvases at their own width', () => {
    const plan = contactSheetArgs([{ file: 'a.png' }], { width: 321, height: 99 }, 'out.png');
    expect(plan.cellWidth).toBe(322);
    expect(plan.cellHeight).toBe(100);
  });

  it.runIf(hasFfmpeg)('writes one PNG from transparent frames', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-sheet-'));
    try {
      const frames = [];
      for (const [i, color] of ['red@0.5', 'blue', 'green'].entries()) {
        const file = path.join(dir, `f${i}.png`);
        const made = spawnSync(ffmpeg, [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=${color}:s=64x36,format=rgba`,
          '-frames:v',
          '1',
          file,
        ]);
        expect(made.status).toBe(0);
        frames.push({ file, at: String(i) });
      }
      const sheet = await writeContactSheet(ffmpeg, frames, { width: 64, height: 36 }, path.join(dir, 'sheet.png'));
      expect(sheet.cells.map((cell) => [cell.row, cell.column, cell.at])).toEqual([
        [0, 0, '0'],
        [0, 1, '1'],
        [1, 0, '2'],
      ]);
      const png = await fs.readFile(sheet.file);
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      // IHDR：宽 2×64 + 3×4，高 2×36 + 3×4。
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([140, 84]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
