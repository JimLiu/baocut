// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExternalToolStatus, JobRecord } from '@baocut/protocol';
import { useJobs } from '../../state/jobs-store.ts';
import { useManagedTools, type ManagedToolsState } from './use-managed-tools.ts';

const { runtime, invalidateToolStatus } = vi.hoisted(() => ({
  runtime: { detectExternalTool: vi.fn(), installExternalTool: vi.fn() },
  invalidateToolStatus: vi.fn(),
}));
vi.mock('../../runtime/context.tsx', () => ({ useRuntime: () => runtime }));
vi.mock('./use-tool-status.ts', () => ({ invalidateToolStatus }));
vi.mock('@react-spectrum/s2', () => ({ ToastQueue: { neutral: vi.fn(), negative: vi.fn() } }));

const ESRGAN = 'realesrgan-ncnn-vulkan';
const PACK = 'upscayl-models';
const status = (partial: Partial<ExternalToolStatus>) => ({ name: ESRGAN, label: 'Real-ESRGAN', state: 'missing', installJobId: null, ...partial }) as ExternalToolStatus;

let container: HTMLDivElement;
let root: Root;
let latest: ManagedToolsState;
const initialJobs = useJobs.getState();

function Harness({ names }: { names: string[] }) {
  latest = useManagedTools(names, true);
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  useJobs.setState(initialJobs, true);
  vi.clearAllMocks();
});

it('没装 → 下载 → 安装任务结束 → 装好：不用刷新页面，重读一次工具目录（解开页头的拦截与提交按钮）', async () => {
  runtime.detectExternalTool.mockResolvedValueOnce(status({}));
  await act(async () => root.render(createElement(Harness, { names: [ESRGAN] })));
  expect(latest.state).toBe('missing');
  expect(latest.missing).toBe(ESRGAN);
  expect(invalidateToolStatus).not.toHaveBeenCalled();

  runtime.installExternalTool.mockResolvedValueOnce({ tool: status({ installJobId: 'job_install' }), jobId: 'job_install' });
  await act(async () => latest.install());
  expect(runtime.installExternalTool).toHaveBeenCalledWith(ESRGAN);
  expect(latest.installing).toBe(true);
  expect(latest.state).toBe('missing');

  runtime.detectExternalTool.mockResolvedValueOnce(status({ state: 'installed' }));
  await act(async () => {
    useJobs.setState({ jobs: [{ jobId: 'job_install', endedAt: '2026-10-27T09:00:00.000Z' } as JobRecord] });
  });
  expect(latest.state).toBe('ready');
  expect(latest.missing).toBeNull();
  expect(invalidateToolStatus).toHaveBeenCalledTimes(1);
  expect(invalidateToolStatus).toHaveBeenCalledWith(runtime);
});

it('一打开就装好了：不多读一次工具目录', async () => {
  runtime.detectExternalTool.mockResolvedValueOnce(status({ state: 'installed' }));
  await act(async () => root.render(createElement(Harness, { names: [ESRGAN] })));
  expect(latest.state).toBe('ready');
  expect(invalidateToolStatus).not.toHaveBeenCalled();
});

it('程序装好、权重包没装：下载卡给权重包；换成不要工具的模型马上就绪，晚到的旧结果不算', async () => {
  runtime.detectExternalTool.mockImplementation(async (name: string) =>
    name === ESRGAN ? status({ state: 'installed' }) : status({ name: PACK, label: 'Upscayl weights' }),
  );
  await act(async () => root.render(createElement(Harness, { names: [ESRGAN, PACK] })));
  expect(latest.state).toBe('missing');
  expect(latest.missing).toBe(PACK);
  expect(latest.tool?.label).toBe('Upscayl weights');

  let release!: (s: ExternalToolStatus) => void;
  runtime.detectExternalTool.mockImplementationOnce(() => new Promise((r) => (release = r)));
  await act(async () => root.render(createElement(Harness, { names: ['waifu2x-ncnn-vulkan'] })));
  expect(latest.state).toBe('checking');
  await act(async () => root.render(createElement(Harness, { names: [] })));
  expect(latest.state).toBe('ready');
  await act(async () => release(status({ name: 'waifu2x-ncnn-vulkan' })));
  expect(latest.state).toBe('ready');
  expect(invalidateToolStatus).not.toHaveBeenCalled();
});
