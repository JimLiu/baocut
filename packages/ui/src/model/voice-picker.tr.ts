import type { VoicePickerMessages } from './voice-picker.ts';

export const tr: VoicePickerMessages = {
clonedOn: (provider) => `${provider} sağlayıcısında klonlandı · bu klonla sentezlenir`,
defaultVoice: 'Varsayılan ses',
providerPreset: (provider, name) => `${provider} sağlayıcısındaki ${name}`,
loadingMine: 'Seslerim yükleniyor…',
cloneNew: 'Yeni ses klonla…',
cloneNewHint: 'Ayarlar › Modeller › Konuşma sentezi › Seslerim kısmında kayıt yapın veya dosyadan içe aktarın',
myVoices: 'Seslerim',
providerVoices: (provider) => `${provider} sesleri`,
customVoice: 'Ses ID gir…',
customVoiceHint: 'Sağlayıcı hesabınızdaki ses ID',
tempReference: 'Bir kaydı bir kez kullan…',
tempReferenceHint: 'Bu sürümün sentez API’si henüz tek kullanımlık referans kayıt kabul etmiyor · önce Seslerim kısmına kaydedip klonlayın',
other: 'Diğer',
voiceDeleted: 'Bu ses silindi · başka birini seçin veya varsayılana dönün',
customLine: 'Denetlemesi için sağlayıcıya olduğu gibi gönderilir; Seslerim kısmında klonlanmış bir ses oluşturup da seçebilirsiniz',
presetLine: (provider, voiceId) => voiceId === null ? `${provider} sesi` : `${provider} sesi · ${voiceId}`,
defaultLine: (provider, name) => `Seçmezseniz ${provider} sağlayıcısının varsayılan sesi (${name}) kullanılır`,
noDefault: 'Bu modelin varsayılan sesi yok; önce bir ses seçin',
};
