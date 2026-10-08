import { RpcError, SETTING_DESCRIPTIONS, type SettingsSnapshot } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './settings-copy.ts';
import { formatSettingLine, formatSettingValue, formatSettings, parseSettingsArgs } from './settings-output.ts';

/** `baocut settings`：经 `settings.get` / `settings.set` 读写 Runtime 持有的偏好设置（架构设计 §5.10）。 */
export const settings = defineNoun({
  name: 'settings',
  get usage() {
    return M.help;
  },
  options: {},
  async run(ctx) {
    const command = ctx.parse(() => parseSettingsArgs(ctx.args));
    if (command.kind === 'list') {
      // 不给 `keys` 时是全部键。
      const view = (await ctx.client.request('settings.get', {})) as SettingsSnapshot;
      return ctx.done(view, formatSettings(view));
    }
    if (command.kind === 'get') {
      const view = await ctx.client.request('settings.get', { keys: [command.key] });
      return ctx.done({ key: command.key, value: view.settings[command.key] }, [formatSettingValue(view.settings[command.key])]);
    }
    const value = command.kind === 'set' ? command.value : null;
    const view = await ctx.client.request('settings.set', { values: { [command.key]: value } }).catch((error: unknown) => {
      // 键已经在本地认过，被拒绝就是值不合规定：给出这个键的说明，而不是笼统的「参数不合法」。
      if (error instanceof RpcError && error.code === 'invalid-request') {
        throw ctx.usageError(M.settingRejected(command.key, formatSettingValue(value), SETTING_DESCRIPTIONS[command.key]));
      }
      throw error;
    });
    return ctx.done(view, [formatSettingLine(view, command.key)]);
  },
});
