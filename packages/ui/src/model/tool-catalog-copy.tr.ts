import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: 'Ses', image: 'Görsel', doc: 'Belge', final: 'Video dosyası', subtitle: 'Altyazı' };

export const tr: ToolCatalogMessages = {
inputLabels: { file: 'Yerel dosya', space: 'Space', link: 'Bağlantı', text: 'Metin', video: 'Space içindeki video', document: 'Belge' },
outputLabels: { video: 'Video', artifact: 'Space içindeki öğe' }, artifactLabels,
tools: {
transcribe: { name: 'Yazıya dök', desc: 'Video veya ses dosyasını döküme ve altyazıya dönüştürür; düzenlenebilir videoya bunları yazar ve altyazı katmanı ekler' },
 'translate-subtitles': { name: 'Altyazıları çevir', desc: 'Altyazıları başka bir dile çevirir; yazıya dökülmüş videoya çeviri ve iki dili gösterebilen altyazı katmanı ekler, özgün metni korur' },
 dub: { name: 'Çeviri dublajı', desc: 'Yazıya dökülmüş videoya çevirisinden yeni dublaj ekler; özgün ses kısılabilir, kapatılabilir veya korunabilir' },
 'synthesize-speech': { name: 'Konuşma oluştur', desc: 'Metni veya Space içindeki belge ve altyazıları sesli okur; ön ayarlı ses kullanın, kaydı klonlayın veya sesi tarif edin' },
 'generate-text': { name: 'Metin oluştur', desc: 'İhtiyacınızı tarif edip metin, senaryo veya özet için doğrudan metin modeli çağırın; Space içindeki belge veya altyazıları kaynak olarak ekleyebilirsiniz' },
 'generate-image': { name: 'Görsel oluştur', desc: 'Görseli tarif edip bulut veya yerel görsel modeliyle çizin; referans görselleri, en boy oranı ve sayı isteğe bağlıdır' },
 'link-import': { name: 'Video indir', desc: 'Bağlantı yapıştırıp videoyu bu bilgisayara indirin; tarayıcı çerezleri kullanılabilir ve indirilen video döküm ile altyazıya dönüştürülebilir' },
 'compress-video': { name: 'Videoyu sıkıştır', desc: 'Hedef boyuta veya kaliteye göre yeniden kodlar; göndermeden veya yüklemeden önce küçültün' },
 'merge-video': { name: 'Videoları birleştir', desc: 'Birden fazla videoyu sırasıyla uç uca tek dosyada birleştirir' },
 'extract-audio': { name: 'Sesi çıkar', desc: 'Görüntüyü kaldırıp yalnızca ses izini tutar; yaygın ses kodlamaları yeniden kodlanmadan olduğu gibi kopyalanır' },
},
targetNone: 'Yalnızca döküm ve altyazı oluştur', targetCreate: 'Projede video oluştur', subtitleFile: 'Yerel altyazı dosyası',
groups: {
 speech: { label: 'Konuşma ve altyazılar', desc: 'Yazıya dökün, altyazıları çevirin, dublaj ekleyin ve metni sesli okuyun. Sonuçlar belge, altyazı ve ses öğeleridir; Space içinde düzenlenebilir video seçilirse ona yazılır.' },
 'text-image': { label: 'Metin ve görseller', desc: 'Metin ve görsel modellerini doğrudan çağırın. Sonuçlar belge ve görsel öğeleridir.' },
 'video-file': { label: 'Video dosyaları', desc: 'Bu bilgisayarda yt-dlp ve ffmpeg ile video indirin, sıkıştırın, birleştirin ve sesi çıkarın. Sonuçlar video dosyası ve ses öğeleridir.' },
},
artifactItems: (artifacts) => artifacts.length ? `${artifacts.map((a) => artifactLabels[a]).join(' ve ')} öğeleri` : 'çıktı öğeleri',
resultWritesVideo: 'Sonuç: seçtiğiniz videoya yazılır', resultInSpace: (items) => `Sonuç: Space içindeki ${items}`, resultAlsoCreate: 'yeni video da oluşturabilir', resultWritesEditable: 'seçtiğiniz düzenlenebilir videoya yazar', joinResult: (parts) => parts.join('; '),
};
