import { spawn, type ChildProcess } from 'node:child_process';
import { NODE_SERVICE_TYPE } from '@baocut/protocol';
import type { NodeLogger } from './node-logger.ts';

/**
 * mDNS 登记（节点协议规范 §12）：节点服务监听时登记 `_baocut-node._tcp`，实例名为节点的名字，
 * TXT 记录 `id=<nodeId>`、`v=<nodeProtocolVersion>`。TXT 只用于展示，不构成信任。
 *
 * macOS 用系统的 `dns-sd -R`（进程活着登记就在，结束进程即注销）；其他平台本版不登记。
 * 测试一律注入假的 `Advertiser`，不碰真实的 mDNS。
 */

export interface AdvertiseInfo {
  name: string;
  port: number;
  nodeId: string;
  version: number;
}

export interface Advertiser {
  start(info: AdvertiseInfo): void;
  stop(): Promise<void>;
}

export const noopAdvertiser: Advertiser = {
  start() {},
  async stop() {},
};

export class DnsSdAdvertiser implements Advertiser {
  readonly #log: NodeLogger | undefined;
  readonly #command: string;
  #child: ChildProcess | null = null;

  constructor(options: { log?: NodeLogger; command?: string } = {}) {
    this.#log = options.log;
    this.#command = options.command ?? 'dns-sd';
  }

  start(info: AdvertiseInfo): void {
    void this.stop();
    const args = ['-R', info.name, NODE_SERVICE_TYPE, 'local', String(info.port), `id=${info.nodeId}`, `v=${info.version}`];
    const child = spawn(this.#command, args, { stdio: 'ignore' });
    child.on('error', (error) => this.#log?.warn('mDNS registration failed', { error: String(error) }));
    child.on('exit', (code, signal) => {
      if (this.#child === child) {
        this.#child = null;
        if (signal !== 'SIGTERM') this.#log?.warn('mDNS registration process exited', { code, signal });
      }
    });
    this.#child = child;
    this.#log?.info('mDNS registered', { port: info.port });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}

/** 本平台的默认登记方式：macOS 用 `dns-sd`，其他平台不登记。 */
export function defaultAdvertiser(platform: NodeJS.Platform = process.platform, log?: NodeLogger): Advertiser {
  return platform === 'darwin' ? new DnsSdAdvertiser(log ? { log } : {}) : noopAdvertiser;
}
