import { describe, expect, it } from 'vitest';
import type { ConnectionState } from '@baocut/client';
import type { RuntimeInfo, WebBuildNote } from '@baocut/protocol';
import { bannerContent } from './connection-banner.tsx';
import { S } from './shell-copy.ts';

// 横幅写什么（产品设计 §2.4；页面的构建与源码不一致时见 CLI 独立使用与发布 §7.4）。

const c = S.connectionBanner;
const CONNECTED: ConnectionState = { status: 'connected', runtime: {} as RuntimeInfo, connectionId: 'conn_1' };
const WEB_PROTOCOL: WebBuildNote = { component: 'web', state: 'stale', reason: 'protocol', rebuild: 'npm run build:web' };
const WEB_INPUTS: WebBuildNote = { component: 'web', state: 'stale', reason: 'inputs', rebuild: 'npm run build:web' };
const WEB_UNVERIFIED: WebBuildNote = { component: 'web', state: 'unverified', reason: 'no-stamp', rebuild: 'npm run build:web' };
const WASM_STALE: WebBuildNote = { component: 'preview-wasm', state: 'stale', reason: 'inputs', rebuild: 'npm run build:wasm && npm run build:web' };

describe('构建都与源码一致（或打包的 Runtime）：与原来一样', () => {
  it('连上了、第一次连接中不显示', () => {
    expect(bannerContent(CONNECTED, [])).toBeNull();
    expect(bannerContent({ status: 'connecting', attempt: 0 }, [])).toBeNull();
  });

  it('协议版本不兼容时照原样写原因', () => {
    expect(bannerContent({ status: 'incompatible', reason: 'x' }, [])).toEqual({ title: c.title, text: c.incompatible('x'), negative: true, retrying: false });
  });

  it('断开与重连', () => {
    expect(bannerContent({ status: 'disconnected', reason: 'gone', retryInMs: 1000 }, [WEB_INPUTS])).toEqual({
      title: c.title,
      text: c.lost('gone', true),
      negative: false,
      retrying: true,
    });
    expect(bannerContent({ status: 'closed' }, [])).toMatchObject({ text: c.closed, retrying: false });
  });
});

describe('页面的构建与源码不一致', () => {
  it('协议版本不同、握手被拒：写明是 Web 客户端的构建，给重建命令', () => {
    expect(bannerContent({ status: 'incompatible', reason: 'x' }, [WEB_PROTOCOL])).toEqual({
      title: c.title,
      text: c.buildProtocol('npm run build:web'),
      negative: true,
      retrying: false,
    });
  });

  it('连上了也一直提示：过期的在比不了的之前，预览引擎的重建命令连 Web 客户端一起重建', () => {
    expect(bannerContent(CONNECTED, [WEB_INPUTS])).toEqual({
      title: c.buildTitle,
      text: c.buildStale('web', 'npm run build:web'),
      negative: false,
      retrying: false,
    });
    expect(bannerContent({ status: 'connecting', attempt: 0 }, [WEB_UNVERIFIED])).toMatchObject({ text: c.buildUnverified('web', 'npm run build:web') });
    expect(bannerContent(CONNECTED, [WASM_STALE, WEB_INPUTS])).toMatchObject({
      text: c.buildStale('preview', 'npm run build:wasm && npm run build:web'),
    });
    expect(bannerContent(CONNECTED, [WEB_UNVERIFIED, WEB_INPUTS])).toMatchObject({ text: c.buildStale('web', 'npm run build:web') });
  });
});
