import { spawn } from 'node:child_process';
import { defineNoun } from './context.ts';
import { M } from './services-copy.ts';
import { browserCommand, webOpen } from './services-output.ts';

/** `baocut web open [--video <videoId>] [--launch]`：开启 Web 服务并给出一次性的访问链接（架构设计 §4.8）。 */
export const web = defineNoun({
  name: 'web',
  get usage() {
    return M.webHelp;
  },
  options: { launch: { type: 'boolean' }, video: { type: 'string' } },
  async run(ctx) {
    if (ctx.args[0] !== 'open' || ctx.args.length !== 1) throw ctx.usageError();
    const video = ctx.values.video;
    if (video !== undefined && video.trim() === '') throw ctx.usageError();
    const lines: string[] = [];
    let link: unknown = null;
    await webOpen(
      {
        start: async () => (await ctx.client.request('services.start', { serviceId: 'web' })).service,
        createAccessLink: async () => {
          const created = await ctx.client.request('services.web.createAccessLink', video === undefined ? {} : { video });
          link = created;
          return created;
        },
      },
      { launch: ctx.values.launch === true, video: video ?? null, launcher: launchBrowser, print: (line) => lines.push(line) },
    );
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
