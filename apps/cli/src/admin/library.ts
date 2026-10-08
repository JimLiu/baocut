import { newId } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './library-copy.ts';
import { formatVideoSelection, libraryLabel, parseIdList, parseLibraryName, parseSpeakerVoice } from './library-output.ts';

/**
 * 管理桶 `baocut library import|export|remove|voice-clone|voice-clone-remove|video-selection`（架构设计 §5.9）。
 * 列出与查看在 Agent 面（`library list|show`）。
 */
export const library = defineNoun({
  name: 'library',
  partial: true,
  verbs: ['import', 'export', 'remove', 'voice-clone', 'voice-clone-remove', 'video-selection'],
  get usage() {
    return M.help;
  },
  options: {
    provider: { type: 'string' },
    name: { type: 'string' },
    'local-only': { type: 'boolean' },
    'transcribe-glossaries': { type: 'string' },
    'translate-glossaries': { type: 'string' },
    'speaker-voice': { type: 'string', multiple: true },
    'clear-speaker-voices': { type: 'boolean' },
  },
  async run(ctx) {
    const [sub, ...rest] = ctx.args;
    const { values } = ctx;
    switch (sub) {
      case 'import': {
        const [file] = rest;
        if (!file || rest.length > 1) throw ctx.usageError(M.importUsage);
        const result = await ctx.client.request('library.import', { path: ctx.resolve(file), commandId: newId('cmd') });
        return ctx.done(result, [M.imported(libraryLabel(result.entry.library), result.entry.id, result.entry.content.name)]);
      }
      case 'export': {
        const [name, id, target] = rest;
        if (!id || !target) throw ctx.usageError(M.exportUsage);
        const library = ctx.parse(() => parseLibraryName(name));
        const result = await ctx.client.request('library.export', { entry: { library, id }, path: ctx.resolve(target) });
        return ctx.done(result, [M.exported(result.entry.id, result.entry.version, result.path, result.byteLength)]);
      }
      case 'remove': {
        const [name, id] = rest;
        if (!id) throw ctx.usageError(M.removeUsage);
        const library = ctx.parse(() => parseLibraryName(name));
        const result = await ctx.client.request('library.remove', { library, id });
        return ctx.done(result, [M.deleted(id)]);
      }
      case 'voice-clone': {
        const [id] = rest;
        const providerId = values.provider;
        if (!id || !providerId) throw ctx.usageError(M.voiceCloneUsage);
        return ctx.follow(
          () =>
            ctx.client.request('library.createVoiceClone', {
              id,
              providerId,
              ...(values.name ? { name: values.name } : {}),
              commandId: newId('cmd'),
            }),
          {
            complete: async (job) => {
              const { entry } = await ctx.client.request('library.get', { library: 'voices', id });
              const clone = entry.clones?.[providerId] ?? null;
              const result = { jobId: job.jobId, id, providerId, clone };
              return ctx.done(result, [JSON.stringify(result)]);
            },
          },
        );
      }
      case 'voice-clone-remove': {
        const [id] = rest;
        if (!id || !values.provider) throw ctx.usageError(M.voiceCloneRemoveUsage);
        const result = await ctx.client.request('library.removeVoiceClone', {
          id,
          providerId: values.provider,
          ...(values['local-only'] ? { localOnly: true } : {}),
        });
        return ctx.done(result, [M.voiceCloneRemoved(id, values.provider, M.remoteCloneOutcome[result.remote])]);
      }
      case 'video-selection': {
        const [videoId] = rest;
        if (!videoId) throw ctx.usageError(M.videoSelectionUsage);
        const glossaries = ctx.parse(() => ({
          ...(values['transcribe-glossaries'] !== undefined ? { transcribe: parseIdList(values['transcribe-glossaries']) } : {}),
          ...(values['translate-glossaries'] !== undefined ? { translate: parseIdList(values['translate-glossaries']) } : {}),
        }));
        const speakerVoices = values['clear-speaker-voices'] ? [] : ctx.parse(() => values['speaker-voice']?.map(parseSpeakerVoice));
        if (Object.keys(glossaries).length > 0 || speakerVoices !== undefined) {
          await ctx.client.request('library.setVideoSelection', {
            videoId,
            commandId: newId('cmd'),
            ...(Object.keys(glossaries).length > 0 ? { glossaries } : {}),
            ...(speakerVoices !== undefined ? { speakerVoices } : {}),
          });
        }
        const result = await ctx.client.request('library.getVideoSelection', { videoId });
        return ctx.done(result, formatVideoSelection(result));
      }
      default:
        throw ctx.usageError();
    }
  },
});
