import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const tr: ModelsModelDownloaderMessages = {
remedyNoSpace: 'Modeller klasörünün bulunduğu disk dolu. Yeterli yer açın (veya Ayarlar kısmında modeller klasörünü başka diske taşıyın), sonra yeniden yükleyin',
remedyNetwork: 'Ağa erişilemiyor veya indirme kesildi. Ağı kontrol edip yeniden yükleyin; indirilen kısım kaldığı yerden devam eder. “Ayarlar › Genel” içindeki “Model indirme kaynağı” kısmında yansı sunucusunu da değiştirebilirsiniz',
remedyIntegrity: 'İndirilen dosya bildirimdeki boyut veya sha256 ile eşleşmiyor (kaynak veya yansı yanlış içerik sunuyor). Bozuk dosya silindi; başka indirme kaynağına geçip yeniden yükleyin',
remedySource: 'İndirme kaynağında dosya yok veya erişim reddedildi. “Ayarlar › Genel” içindeki “Model indirme kaynağı” ayarında (veya BAOCUT_MODELS_ENDPOINT ortam değişkeninde) belirtilen yansının tam olduğunu kontrol edin',
remedyManifestIncomplete: 'Bu model paketinin yerleşik bildiriminde güvenilir sha256 yok; yüklenemez. BaoCut güncellemesini bekleyin',
downloadFailed: (p) => `${p.file} indirilemedi: ${p.reason}`, integrityMismatch: (p) => `${p.file} dosyasının boyutu veya sha256 değeri bildirimle eşleşmiyor`, sourceHttp: (p) => `İndirme kaynağı ${p.file} için HTTP ${p.status} döndürdü`, diskFull: 'Model dosyaları yazılırken disk doldu',
};
