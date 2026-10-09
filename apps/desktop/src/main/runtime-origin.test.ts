import type { WebFrameMain } from 'electron';
import { expect, it } from 'vitest';
import { desktopRuntimeHeaders, desktopRuntimeResponseHeaders, isDesktopRuntimeRequest } from './runtime-origin.ts';

const appOrigin = 'http://localhost:5174';
const endpoint = 'ws://127.0.0.1:61861';
const appContents = new Set([1, 2]);
const request = {
  url: `${endpoint}/`,
  webContentsId: 1,
  frame: { url: `${appOrigin}/` } as WebFrameMain,
};

it('allows only registered desktop frames on the discovered Runtime port', () => {
  expect(isDesktopRuntimeRequest(request, endpoint, appOrigin, appContents)).toBe(true);
  expect(isDesktopRuntimeRequest({ ...request, webContentsId: 2 }, endpoint, appOrigin, appContents)).toBe(true);
  expect(isDesktopRuntimeRequest({ ...request, url: 'http://127.0.0.1:61861/media/fixture' }, endpoint, appOrigin, appContents)).toBe(true);
  for (const url of ['ws://127.0.0.1:61862/', 'ws://localhost:61861/', 'https://127.0.0.1:61861/', 'ws://example.com:61861/', 'ws://user@127.0.0.1:61861/']) {
    expect(isDesktopRuntimeRequest({ ...request, url }, endpoint, appOrigin, appContents)).toBe(false);
  }
  expect(isDesktopRuntimeRequest(request, null, appOrigin, appContents)).toBe(false);
  expect(isDesktopRuntimeRequest(request, 'ws://example.com:61861', appOrigin, appContents)).toBe(false);
  expect(isDesktopRuntimeRequest({ ...request, webContentsId: 3 }, endpoint, appOrigin, appContents)).toBe(false);
  expect(isDesktopRuntimeRequest({ ...request, frame: null }, endpoint, appOrigin, appContents)).toBe(false);
  for (const url of ['https://example.com/', 'http://localhost:5173/', 'invalid']) {
    expect(isDesktopRuntimeRequest({ ...request, frame: { url } as WebFrameMain }, endpoint, appOrigin, appContents)).toBe(false);
  }
});

it('maps only Origin and its matching CORS response without changing authentication', () => {
  const headers = { origin: appOrigin, Authorization: 'Bearer fixture', Other: 'unchanged' };
  expect(desktopRuntimeHeaders(headers)).toEqual({ ...headers, origin: 'null' });
  expect(headers.origin).toBe(appOrigin);
  expect(desktopRuntimeHeaders({ Origin: appOrigin })).toEqual({ Origin: 'null' });
  expect(desktopRuntimeHeaders({ Other: 'unchanged' })).toEqual({ Other: 'unchanged' });
  const response = { 'Access-Control-Allow-Origin': ['null'], Vary: ['Origin'] };
  expect(desktopRuntimeResponseHeaders(response, appOrigin)).toEqual({ ...response, 'Access-Control-Allow-Origin': [appOrigin] });
  expect(response['Access-Control-Allow-Origin']).toEqual(['null']);
  expect(desktopRuntimeResponseHeaders({ 'access-control-allow-origin': ['https://example.com'] }, appOrigin))
    .toEqual({ 'access-control-allow-origin': ['https://example.com'] });
});
