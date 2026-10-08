import type { ToolsTextMessages } from './tools-text.ts';

export const tr: ToolsTextMessages = {
emptyInput: 'Önce ne oluşturulacağını yazın',
tooLong: (max) => `Bir seferde en fazla ${max} karakter`,
sample: 'Bir şehir gezisi videosu için 30 saniyelik dublaj metni yaz. Doğal bir ton kullan; sokaklara, kafelere ve akşam karanlığına yer ver.',
counter: (n, max) => `${n} / ${max} karakter`,
connectTextModel: 'Önce bir metin modeli bağlayın',
connectFirst: (provider) => `Önce ${provider} sağlayıcısını bağlayın`,
effortFixed: 'Akıl yürütme düzeyi · bu modelde ayarlanamaz',
effort: (label) => `Akıl yürütme düzeyi · ${label} (varsayılan Modeller sayfasında ayarlanır)`,
auto: 'Otomatik',
headerChip: (provider) => `Çevrimiçi · ${provider} · token başına ücretlendirilir`,
fileStem: 'Oluşturulan metin',
chars: (n) => `${n} karakter`,
outputTokens: (n) => `${n} çıktı token`,
truncated: 'Çıktı sınırına ulaşıldı; kalan kısım kesildi',
};
