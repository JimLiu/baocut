// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExternalToolStatus, JobRecord } from '@baocut/protocol';
import { useJobs } from '../../state/jobs-store.ts';
import { useEsrgan, type EsrganState } from './use-esrgan.ts';

const { runtime, invalidateToolStatus } = vi.hoisted(() => ({
  runtime: { detectExternalTool: vi.fn(), installExternalTool: vi.fn() },
  invalidateToolStatus: vi.fn(),
}));
vi.mock('../../runtime/context.tsx', () => ({ useRuntime: () => runtime }));
vi.mock('./use-tool-status.ts', () => ({ invalidateToolStatus }));
vi.mock('@react-spectrum/s2', () => ({ ToastQueue: { neutral: vi.fn(), negative: vi.fn() } }));

const status = (partial: Partial<ExternalToolStatus>) => ({ name: 'realesrgan-ncnn-vulkan', state: 'missing', installJobId: null, ...partial }) as ExternalToolStatus;

let container: HTMLDivElement;
let root: Root;
let latest: EsrganState;
const initialJobs = useJobs.getState();

function Harness() {
  latest = useEsrgan(true);
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
  await act(async () => root.render(createElement(Harness)));
  expect(latest.state).toBe('missing');
  expect(invalidateToolStatus).not.toHaveBeenCalled();

  runtime.installExternalTool.mockResolvedValueOnce({ tool: status({ installJobId: 'job_install' }), jobId: 'job_install' });
  await act(async () => latest.install());
  expect(latest.installing).toBe(true);
  expect(latest.state).toBe('missing');

  runtime.detectExternalTool.mockResolvedValueOnce(status({ state: 'installed' }));
  await act(async () => {
    useJobs.setState({ jobs: [{ jobId: 'job_install', endedAt: '2026-10-27T09:00:00.000Z' } as JobRecord] });
  });
  expect(latest.state).toBe('ready');
  expect(invalidateToolStatus).toHaveBeenCalledTimes(1);
  expect(invalidateToolStatus).toHaveBeenCalledWith(runtime);
});

it('一打开就装好了：不多读一次工具目录', async () => {
  runtime.detectExternalTool.mockResolvedValueOnce(status({ state: 'installed' }));
  await act(async () => root.render(createElement(Harness)));
  expect(latest.state).toBe('ready');
  expect(invalidateToolStatus).not.toHaveBeenCalled();
});
