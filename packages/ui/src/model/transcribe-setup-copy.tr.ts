import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const tr: TranscribeSetupMessages = {
notConnected: 'Bağlı değil', unavailable: 'Kullanılamıyor', autoDetect: 'Otomatik algıla',
hintNoModel: 'Hangi konuşma modelinin kullanılacağı henüz bilinmiyor. Tanıma ipuçlarını kabul edip etmediğini görmek için yukarıdan bir model seçin.',
hintUnsupported: (model, alt) => `${model} tanıma ipuçlarını kabul etmiyor; bu adımda sözlükler ve istem kullanılamaz, yazıya dökmede atlanır.${alt ? ` Bunları yazıya dökmede kullanmak için ${alt} modeline geçin.` : ''}`,
budget: (model, b, max) => {
 const custom = b.custom ? `${b.custom} karakterlik istem` : 'istem yok';
 const dropped = b.dropped ? ` · ${b.dropped} terim daha sığmıyor; önce listelenen sözlükler önce alınır` : '';
 return `${model} modeline gönderilen: ${custom} + ${b.terms} terim · yaklaşık ${b.chars} / ${max} karakter${dropped}`;
},
glossaryGone: 'Artık sözlük kitaplığında yok · bu sefer kullanılmaz',
glossaryTranslation: 'Çeviri sözlüğü; yazıya dökmede kullanılmaz · bu sefer kullanılmaz',
anyLanguage: 'Herhangi bir dil', termCount: (count) => `${count} terim`,
noDefaultModel: 'Henüz varsayılan konuşma modeli yok', defaultModel: (label) => `${label} (varsayılan)`,
autoDetectLanguage: 'Dili otomatik algıla', glossaries: (count) => `${count} sözlük`, hasPrompt: 'İstem var',
noDefaultFacts: 'Henüz varsayılan konuşma modeli yok. Bir model seçin veya Modeller sayfasında varsayılanı ayarlayın. Seçmeden başlarsanız eksik olan size bildirilir.',
modelUnusable: 'Bu model şu anda kullanılamıyor', acceptsHint: 'Tanıma ipuçlarını kabul eder', noHint: 'Tanıma ipucu kabul etmez', followDefault: (facts) => `Varsayılanı kullanır · ${facts}`,
};
