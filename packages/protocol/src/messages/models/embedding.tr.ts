import type { ModelsEmbeddingMessages } from './embedding.ts';

export const tr: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: ticari kullanım dahil ücretsiz; yeniden dağıtırken telif hakkı ve lisans bildirimlerini koruyun',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM’in bu makine (${p.platform}) için bir derlemesi yok; bu yüzden yerel anlamsal arama burada henüz kullanılamıyor`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} yüklü değil`,
  countMismatch: (p: { expected: number; actual: number }) => `${p.expected} vektör bekleniyordu, ${p.actual} geldi`,
  wrongDims: (p: { expected: number; actual: number }) => `Bir vektör ${p.expected} yerine ${p.actual} boyutlu`,
  notFinite: 'Bir vektörde sonlu sayı olmayan bir değer var',
  notNormalized: (p: { norm: string }) => `Bir vektörün uzunluğu 1 değil (norm ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `İlgili cümle, ilgisiz cümleden yüksek puan almadı (kosinüs ${p.relevant} - ${p.irrelevant})`,
  noModel: 'Yerel gömme (embedding) modeli yüklü değil',
  noVisionModel: "Yüklü yerel gömme (embedding) modellerinden hiçbiri görüntü okuyamıyor. Ekrandaki içeriğe göre aramak için EmbeddingGemma 2 740M'yi yükleyin",
  inputTooLong: (p: { index: number; max: number }) => `${p.index}. metin modelin kabul ettiğinden uzun (${p.max} token)`,
  modelUnavailable: (p: { problem: string }) => `Yerel gömme modeli kullanılamıyor: ${p.problem}`,
  cannotEmbed: 'Bu Model Worker bu modelle henüz gömme hesaplayamıyor',
  embedReturned: (p: { code: string }) => `embed.run ${p.code} döndürdü`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} boyut · kosinüs ${p.relevant} - ${p.irrelevant} · ${p.device}`,
};
