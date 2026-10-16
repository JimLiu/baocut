import { spawn } from 'node:child_process';
import { ToolError } from '../agent-tools/tool-catalog.ts';

/**
 * 接触表（代码包规范 §6 的 `compositions_preview` 的 `sheet`）：把取到的几帧按行优先排成一张 PNG，一眼看完排版、空画面与残留。
 * 每格按同一宽度缩小、铺在中灰底上（透明的叠加层浅色深色都看得见），格间留 4 像素缝；宽高比不同的图（网上素材的缩略图）
 * 等比缩进格子、居中留灰边。格子里不写字（ffmpeg 的 drawtext 依赖平台字体）：哪格是哪个时刻由返回的 `cells` 给出。
 */

export interface ContactSheetCell {
  index: number;
  row: number;
  column: number;
  at: string;
}

export interface ContactSheet {
  file: string;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  cells: ContactSheetCell[];
}

const MAX_CELL_WIDTH = 480;
const GAP = 4;
const BACKGROUND = '0x808080';

/** 列数：不超过 6，接近正方形的格阵。 */
export function sheetColumns(count: number): number {
  return Math.max(1, Math.min(6, Math.ceil(Math.sqrt(count))));
}

/** ffmpeg 的参数：N 张同尺寸的 PNG → 一张接触表。 */
export function contactSheetArgs(
  frames: ReadonlyArray<{ file: string }>,
  size: { width: number; height: number },
  output: string,
): { args: string[]; columns: number; rows: number; cellWidth: number; cellHeight: number } {
  const columns = sheetColumns(frames.length);
  const rows = Math.ceil(frames.length / columns);
  const cellWidth = even(Math.min(MAX_CELL_WIDTH, size.width));
  const cellHeight = even((size.height * cellWidth) / size.width);
  const sheetWidth = columns * cellWidth + (columns + 1) * GAP;
  const sheetHeight = rows * cellHeight + (rows + 1) * GAP;
  const filters = [`color=c=${BACKGROUND}:s=${sheetWidth}x${sheetHeight}:d=1,format=rgba[bg0]`];
  frames.forEach((_, i) =>
    filters.push(`[${i}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,format=rgba[c${i}]`),
  );
  frames.forEach((_, i) => {
    const x = GAP + (i % columns) * (cellWidth + GAP);
    const y = GAP + Math.floor(i / columns) * (cellHeight + GAP);
    // 缩小后不满一格的居中。
    filters.push(`[bg${i}][c${i}]overlay=${x}+(${cellWidth}-w)/2:${y}+(${cellHeight}-h)/2:format=auto[bg${i + 1}]`);
  });
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const frame of frames) args.push('-i', frame.file);
  args.push('-filter_complex', filters.join(';'), '-map', `[bg${frames.length}]`, '-frames:v', '1', '-c:v', 'png', output);
  return { args, columns, rows, cellWidth, cellHeight };
}

/** 拼一张接触表，写到 `output`。 */
export async function writeContactSheet<F extends { file: string; at: string }>(
  ffmpeg: string,
  frames: ReadonlyArray<F>,
  size: { width: number; height: number },
  output: string,
): Promise<ContactSheet> {
  const plan = contactSheetArgs(frames, size, output);
  const { code, stderr } = await run(ffmpeg, plan.args);
  if (code !== 0) {
    throw new ToolError(
      'COMPOSITION_SHEET_FAILED',
      `Failed to build the contact sheet (ffmpeg exit code ${code}): ${stderr.trim().slice(-400)}`,
      {
        next: 'The single-frame PNGs were written; view each file listed in frames. Check that ffmpeg is available (BAOCUT_FFMPEG or ffmpeg on PATH).',
      },
    );
  }
  return {
    file: output,
    columns: plan.columns,
    rows: plan.rows,
    cellWidth: plan.cellWidth,
    cellHeight: plan.cellHeight,
    cells: frames.map((frame, index) => ({ index, row: Math.floor(index / plan.columns), column: index % plan.columns, at: frame.at })),
  };
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function run(command: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}
