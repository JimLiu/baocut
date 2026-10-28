import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const tr: TextModelChoiceMessages = {
  placeholder: 'Bir metin modeli seçin',
  providers: 'Sağlayıcılar',
  agentReady: (provider) => `Ajan · ${provider} aboneliğinizi kullanır · API’den yavaş`,
  agentNote: (note) => `Ajan · ${note}`,
  connected: (n) => `Bağlı · ${n} model`,
  notConnected: 'Bağlı değil · Ayarlardan bağlayın',
  settings: 'Metin modellerini yönet…',
  settingsSub: 'API sağlayıcılarını bağla · Varsayılan model',
};
