import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportSettings } from '@baocut/protocol';
import { useExportSubmit, type ExportEnv } from './use-export-submit.ts';

const mocks = vi.hoisted(() => ({
  pickSavePath: vi.fn(), pickDirectory: vi.fn(), createExport: vi.fn(), negative: vi.fn(),
}));
// 直接验证提交入口，状态渲染不属于这组测试的范围。
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock('@react-spectrum/s2', () => ({ ToastQueue: { negative: mocks.negative, neutral: vi.fn() } }));
vi.mock('../../runtime/context.tsx', () => ({ useRuntime: () => ({
  host: { platform: 'darwin', pickSavePath: mocks.pickSavePath, pickDirectory: mocks.pickDirectory },
  createExport: mocks.createExport,
}) }));
vi.mock('../../state/export-store.ts', () => ({ useExportPlaces: (select: (s: unknown) => unknown) => select({ dirs: {} }) }));

const env = { videoId: 'vid_test', videoName: '访谈', documents: {}, sequence: { tracks: {}, items: {} }, sourceDir: '/source' } as unknown as ExportEnv;
const settings: ExportSettings = { kind: 'video', format: 'mp4', burnCaptions: false };

describe('导出提交前确认文件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pickSavePath.mockResolvedValue('/chosen/改名.mp4');
    mocks.pickDirectory.mockResolvedValue('/chosen');
    mocks.createExport.mockResolvedValue('job_test');
  });
  it('保存窗口确认前不建任务；重复点击只打开一次窗口', async () => {
    let confirm!: (file: string | null) => void;
    mocks.pickSavePath.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    const started = vi.fn();
    const submitter = useExportSubmit(env, started);
    const first = submitter.submit(settings);
    await submitter.submit(settings);
    expect(mocks.pickSavePath).toHaveBeenCalledTimes(1);
    expect(mocks.createExport).not.toHaveBeenCalled();
    confirm('/chosen/改名.mp4');
    await first;
    expect(mocks.createExport).toHaveBeenCalledExactlyOnceWith({ videoId: env.videoId, settings,
      destination: { dir: '/chosen', fileName: '改名.mp4', overwrite: true } });
    expect(started).toHaveBeenCalledExactlyOnceWith('job_test', 'video');
  });
  it('取消或保存窗口失败不建任务，随后仍可再次导出', async () => {
    const submitter = useExportSubmit(env, vi.fn());
    mocks.pickSavePath.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('dialog failed'));
    await submitter.submit(settings);
    await submitter.submit(settings);
    expect(mocks.createExport).not.toHaveBeenCalled();
    expect(mocks.negative).toHaveBeenCalledTimes(1);
    await submitter.submit(settings);
    expect(mocks.createExport).toHaveBeenCalledTimes(1);
  });
  it('多任务共享选定目录，保留各文件名，取消目录选择时不建任务', async () => {
    const submitter = useExportSubmit(env, vi.fn());
    const parts = [{ settings, fileName: 'one.mp4' }, { settings, fileName: 'two.mp4' }];
    mocks.pickDirectory.mockResolvedValueOnce(null);
    await submitter.submitEach(parts);
    expect(mocks.createExport).not.toHaveBeenCalled();
    await submitter.submitEach(parts);
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
    expect(mocks.createExport.mock.calls.map(([request]) => request.destination)).toEqual([
      { dir: '/chosen', fileName: 'one.mp4' }, { dir: '/chosen', fileName: 'two.mp4' },
    ]);
  });
});
