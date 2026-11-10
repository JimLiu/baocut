import { spawn } from 'node:child_process';
import { RpcError, type ServiceStatus } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './services-copy.ts';
import { browserCommand, portInUseRemedy, webOpen } from './services-output.ts';

/**
 * `baocut web open [--video <videoId>] [--launch]`：开启 Web 服务并给出一次性的访问链接（架构设计 §4.8）。
 * `baocut web review --video <videoId>`：这个视频的审片链接，稳定、可反复打开（架构设计 §4.8「审片链接」）。
 */
export const web = defineNoun({
  name: 'web',
  get usage() {
    return M.webHelp;
  },
  options: { launch: { type: 'boolean' }, video: { type: 'string' } },
  async run(ctx) {
    if (ctx.args.length !== 1) throw ctx.usageError();
    const video = ctx.values.video;
    if (video !== undefined && video.trim() === '') throw ctx.usageError();
    if (ctx.args[0] === 'review') {
      // 审片链接里的密钥长期有效，不经打开浏览器的命令的参数：只打印，由 agent 或用户自己打开。
      if (video === undefined || ctx.values.launch === true) throw ctx.usageError();
      let link;
      try {
        link = await ctx.client.request('services.web.reviewLink', { video });
      } catch (error) {
        // 服务没开起来：端口被占用时带上换端口的补救，别的原因原样抛出。
        if (!(error instanceof RpcError) || (error.details as { code?: string } | undefined)?.code !== 'SERVICE_NOT_RUNNING') throw error;
        const status = (await ctx.client.request('services.list', {})).services.find((service) => service.serviceId === 'web');
        const remedy = status ? portInUseRemedy(status) : null;
        if (!status || !remedy) throw error;
        return ctx.fail({ code: 'SERVICE_ERROR', message: M.webNotStarted(status.error ?? status.state), remedy, service: status });
      }
      return ctx.done({ link }, [link.url, M.reviewLinkNote, ...(link.autostartEnabled ? [M.reviewAutostartOn] : [])]);
    }
    if (ctx.args[0] !== 'open') throw ctx.usageError();
    const lines: string[] = [];
    let link: unknown = null;
    let started: ServiceStatus | null = null;
    try {
      await webOpen(
        {
          start: async () => (started = (await ctx.client.request('services.start', { serviceId: 'web' })).service),
          createAccessLink: async () => {
            const created = await ctx.client.request('services.web.createAccessLink', video === undefined ? {} : { video });
            link = created;
            return created;
          },
        },
        { launch: ctx.values.launch === true, video: video ?? null, launcher: launchBrowser, print: (line) => lines.push(line) },
      );
    } catch (error) {
      // 端口被占用：带上换端口的补救；别的原因原样抛出。
      const failed = started as ServiceStatus | null;
      const remedy = failed ? portInUseRemedy(failed) : null;
      if (!failed || !remedy || !(error instanceof Error)) throw error;
      return ctx.fail({ code: 'SERVICE_ERROR', message: error.message, remedy, service: failed });
    }
    return ctx.done({ link, video: video ?? null, launched: ctx.values.launch === true }, lines);
  },
});

/** 用系统默认浏览器打开登录页（不带代码；不等浏览器退出）。 */
function launchBrowser(url: string): Promise<void> {
  const { command, args } = browserCommand(process.platform, url);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('error', (error) => reject(new Error(M.browserFailed(error.message))));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
