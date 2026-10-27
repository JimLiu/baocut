// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RpcError, type GrantRequestItem } from '@baocut/protocol';
import { useImageEditStart, type ImageEditStart } from './use-image-edit-start.ts';

const { runtime } = vi.hoisted(() => ({ runtime: { startPipelineWithCommand: vi.fn(), createGrant: vi.fn() } }));
vi.mock('../../runtime/context.tsx', () => ({ useRuntime: () => runtime }));

const item: GrantRequestItem = {
  capability: 'generateImage',
  dataKinds: ['document'],
  recipient: 'acme',
  videoId: null,
  purpose: 'remove-object',
  reason: 'none',
  cost: 'unknown',
  estimate: null,
  maxCalls: null,
};
const denied = () => new RpcError('forbidden', 'needs a grant', { code: 'GRANT_REQUIRED', pendingGrants: [item] });
const request = { pipeline: 'remove-object', params: { inputs: ['/a.png'], method: 'model', provider: 'acme' } };

let container: HTMLDivElement;
let root: Root;
let latest: ImageEditStart;
const started = vi.fn();
const failed = vi.fn();

function Harness({ formKey }: { formKey: string }) {
  latest = useImageEditStart(formKey, { started, failed });
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllMocks();
});

it('在线模型被当场授权拒绝：交回待批准项；同意后发放，再用同一个 commandId 重提', async () => {
  await act(async () => root.render(createElement(Harness, { formKey: 'a' })));
  runtime.startPipelineWithCommand.mockRejectedValueOnce(denied()).mockResolvedValueOnce('job_1');
  await act(async () => latest.start(request));
  expect(latest.asking).toEqual([item]);
  expect(started).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();

  await act(async () => latest.agree());
  expect(runtime.createGrant).toHaveBeenCalledTimes(1);
  const [first, second] = runtime.startPipelineWithCommand.mock.calls;
  expect(second).toEqual(first);
  expect(first![2]).toMatch(/^cmd/);
  expect(latest.asking).toBeNull();
  expect(started).toHaveBeenCalledTimes(1);
});

it('表单改了：在等的授权请求作废；别的拒绝照常报失败', async () => {
  await act(async () => root.render(createElement(Harness, { formKey: 'a' })));
  runtime.startPipelineWithCommand.mockRejectedValueOnce(denied());
  await act(async () => latest.start(request));
  expect(latest.asking).not.toBeNull();
  await act(async () => root.render(createElement(Harness, { formKey: 'b' })));
  expect(latest.asking).toBeNull();
  await act(async () => latest.agree());
  expect(runtime.createGrant).not.toHaveBeenCalled();

  runtime.startPipelineWithCommand.mockRejectedValueOnce(new Error('boom'));
  await act(async () => latest.start(request));
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
});
