import { expect, it, vi } from 'vitest';
import { createParentChannel } from './parent-channel.ts';

function setup() {
  const sent: object[] = [];
  const deps = {
    stop: vi.fn(),
    activeWork: () => ({ jobs: 1, tasks: 0, remote: [] }),
    detach: vi.fn(),
    onIdle: vi.fn(),
    send: (message: object) => sent.push(message),
    log: { info: vi.fn() },
  };
  return { channel: createParentChannel(deps), deps, sent };
}

it('answers status, stops on request, ignores unknown messages', () => {
  const { channel, deps, sent } = setup();
  channel.handle({ type: 'status' });
  channel.handle({ type: 'nope' });
  channel.handle(null);
  channel.handle({ type: 'stop' });
  expect(sent).toEqual([{ type: 'status', jobs: 1, tasks: 0, remote: [] }]);
  expect(deps.stop).toHaveBeenCalledWith('ipc');
});

it('detach enables idle exit when not resident, and the idle callback stops the Runtime', () => {
  const { channel, deps, sent } = setup();
  channel.handle({ type: 'detach' });
  expect(sent).toEqual([{ type: 'detached' }]);
  expect(deps.detach).toHaveBeenCalledTimes(1);
  expect(channel.idleExitEnabled).toBe(true);
  deps.detach.mock.calls[0]![0]();
  expect(deps.onIdle).toHaveBeenCalled();
  channel.handle({ type: 'detach' });
  expect(deps.detach).toHaveBeenCalledTimes(1);
});

it('while resident, idle exit stays off; a detach waits until residency ends', () => {
  const { channel, deps, sent } = setup();
  channel.handle({ type: 'resident', on: true });
  expect(channel.resident).toBe(true);
  channel.handle({ type: 'detach' });
  expect(deps.detach).not.toHaveBeenCalled();
  expect(channel.idleExitEnabled).toBe(false);
  channel.handle({ type: 'resident', on: true });
  expect(deps.detach).not.toHaveBeenCalled();
  channel.handle({ type: 'resident', on: false });
  expect(deps.detach).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([
    { type: 'resident', on: true },
    { type: 'detached' },
    { type: 'resident', on: true },
    { type: 'resident', on: false },
  ]);
});

it('ending residency without a pending detach does not enable idle exit', () => {
  const { channel, deps } = setup();
  channel.handle({ type: 'resident', on: true });
  channel.handle({ type: 'resident', on: 'yes' });
  expect(channel.resident).toBe(false);
  expect(deps.detach).not.toHaveBeenCalled();
});
