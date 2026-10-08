import { newId } from '@baocut/protocol';
import { remedyText } from '../localized-text.ts';
import { defineNoun } from './context.ts';
import { M } from './fonts-copy.ts';
import { formatDownloadedFonts, formatFontFamilies, formatFontRemoval, parseFontsArgs } from './fonts-output.ts';

/** `baocut fonts …`：按需下载的字体（架构设计 §9.1）。下载跟着任务的进度；已经下载好的不再下载。 */
export const fonts = defineNoun({
  name: 'fonts',
  get usage() {
    return M.help;
  },
  options: {
    weights: { type: 'string' },
    italic: { type: 'boolean' },
    category: { type: 'string' },
    script: { type: 'string' },
    limit: { type: 'string' },
  },
  async run(ctx) {
    const { values, client } = ctx;
    const command = ctx.parse(() =>
      parseFontsArgs(ctx.args, {
        weights: values.weights,
        italic: values.italic,
        category: values.category,
        script: values.script,
        limit: values.limit,
      }),
    );
    switch (command.kind) {
      case 'downloaded': {
        const result = await client.request('fonts.downloaded', {});
        return ctx.done(result, formatDownloadedFonts(result.faces, result.totalBytes));
      }
      case 'search': {
        const result = await client.request('fonts.catalogue', {
          ...(command.query ? { query: command.query } : {}),
          ...(command.category ? { category: command.category } : {}),
          ...(command.script ? { script: command.script } : {}),
          limit: command.limit,
        });
        return ctx.done(result, formatFontFamilies(result.families, result.total));
      }
      case 'remove': {
        const result = await client.request('fonts.remove', { family: command.family });
        return ctx.done(result, formatFontRemoval(result));
      }
      case 'clear': {
        const result = await client.request('fonts.clear', {});
        return ctx.done(result, formatFontRemoval(result));
      }
      case 'download':
        break;
    }
    const request = { family: command.family, commandId: newId('cmd'), ...(command.faces ? { faces: command.faces } : {}) };
    const first = await client.request('fonts.download', request);
    if (!first.jobId) {
      return ctx.done(first, [M.alreadyDownloaded(first.family), ...formatFontFamilies([first.status], 1)]);
    }
    const jobId = first.jobId;
    return ctx.follow(async () => ({ jobId }), {
      complete: async (job) => {
        const { families } = await client.request('fonts.catalogue', { families: [first.family] });
        return ctx.done({ jobId: job.jobId, family: first.family, families }, [
          M.downloadDone,
          ...formatFontFamilies(families, families.length),
        ]);
      },
      stopped: (job) => {
        const remedy = remedyText(job.error?.details);
        if (remedy !== null) ctx.log(M.remedy(remedy));
      },
    });
  },
});
