import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { detectFilterScriptOption, ToolFailure, type runTool } from './audio-export.ts';

let id = 0;
const command = () => ({ command: `ffmpeg-probe-${++id}` });
const success = { stdout: '', stderr: '' };

describe('FFmpeg filter script capability probe', () => {
  it('executes the modern option without reading help; bounds synthesis and removes the graph', async () => {
    let file = '';
    const tool = command();
    const run = vi.fn<typeof runTool>(async (actual, args, signal) => {
      expect(actual).toBe(tool);
      expect(args).not.toContain('-h');
      expect(args).toContain('-nostdin');
      expect(args.slice(-6)).toEqual(['[out]', '-t', '0.001', '-f', 'null', '-']);
      expect(signal).toBeInstanceOf(AbortSignal);
      file = args[args.indexOf('-/filter_complex') + 1]!;
      expect(await fs.readFile(file, 'utf8')).toBe('anullsrc=r=8000:cl=mono[out]\n');
      return success;
    });
    expect(await detectFilterScriptOption(tool, run)).toBe('-/filter_complex');
    expect(run).toHaveBeenCalledTimes(1);
    await expect(fs.stat(path.dirname(file))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back only after executing the legacy option successfully', async () => {
    const tool = command();
    const run = vi.fn<typeof runTool>()
      .mockRejectedValueOnce(new ToolFailure('failed', 'Unknown modern option', 'ffmpeg'))
      .mockResolvedValueOnce(success);
    expect(await detectFilterScriptOption(tool, run)).toBe('-filter_complex_script');
    expect(run.mock.calls.map(([, args]) => args[4])).toEqual(['-/filter_complex', '-filter_complex_script']);
    expect(run.mock.calls[0]![1][5]).toBe(run.mock.calls[1]![1][5]);
  });

  it('shares an in-flight probe and caches a confirmed result', async () => {
    const tool = command();
    const run = vi.fn<typeof runTool>().mockResolvedValue(success);
    const first = detectFilterScriptOption(tool, run);
    expect(detectFilterScriptOption(tool, run)).toBe(first);
    await first;
    expect(await detectFilterScriptOption(tool, run)).toBe('-/filter_complex');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not guess or cache when both options fail, cleans up and permits a retry', async () => {
    const tool = command();
    const failure = new ToolFailure('failed', 'Both options rejected', 'ffmpeg');
    const run = vi.fn<typeof runTool>().mockRejectedValue(failure);
    await expect(detectFilterScriptOption(tool, run)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
    const file = run.mock.calls[0]![1][5]!;
    await expect(fs.stat(path.dirname(file))).rejects.toMatchObject({ code: 'ENOENT' });
    run.mockResolvedValue(success);
    expect(await detectFilterScriptOption(tool, run)).toBe('-/filter_complex');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each(['missing', 'aborted'] as const)('does not retry a %s process with another option', async (kind) => {
    const tool = command();
    const failure = new ToolFailure(kind, 'Probe unavailable', 'ffmpeg');
    const run = vi.fn<typeof runTool>().mockRejectedValue(failure);
    await expect(detectFilterScriptOption(tool, run)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(fs.stat(path.dirname(run.mock.calls[0]![1][5]!))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
