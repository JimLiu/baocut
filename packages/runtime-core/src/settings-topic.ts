import { TopicLog, type Logger } from '@baocut/harness';
import { processLanguageTags, resolveLanguage, setLocale, type SettingsEvent, type SettingsSnapshot } from '@baocut/protocol';
import { SettingsStore, type RuntimeHome } from '@baocut/runtime-storage';

export interface RuntimeSettings {
  store: SettingsStore;
  /** `settings` 主题：快照是全部键的有效值与默认值，有效值变化时送 `settings.updated`（架构设计 §5.10）。 */
  topic: TopicLog<SettingsSnapshot, SettingsEvent>;
}

/** 读入偏好设置并接上主题。文件不是合法的 JSON 或认不出时改名保留、全部取默认值（`store-file.ts`）；读不了时抛出。 */
export async function openSettings(home: RuntimeHome, log?: Logger): Promise<RuntimeSettings> {
  const store = new SettingsStore(home.settingsFile, log ? { log: log.child('settings') } : {});
  await store.load();
  const topic = new TopicLog<SettingsSnapshot, SettingsEvent>(() => store.snapshotAll(), '0');
  // Runtime 给人看的文字跟着界面语言（`ui.language`）；跟随系统时按这台电脑的系统语言。
  const applyLocale = () => setLocale(resolveLanguage(store.get('ui.language'), processLanguageTags()));
  applyLocale();
  store.onChange((changed) => {
    if ('ui.language' in changed) applyLocale();
    topic.publish({ type: 'settings.updated', changed });
  });
  return { store, topic };
}
