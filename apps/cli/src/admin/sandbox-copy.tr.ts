import type { SandboxMessages } from './sandbox-copy.ts';

export const tr: SandboxMessages = {
  help: `Kullanım:
  baocut sandbox create <klasör> [--link-accounts-from <home>]
                                   Geliştirme ve test için ayrı bir Runtime klasörü hazırlar: içinde projects klasörü olan
                                   klasörü, bu depo kopyasının CLI'sini o klasörle çalıştıran bin/baocut'u ve bir shell'i ona
                                   geçiren env.sh / env.ps1'i. Yeniden çalıştırmak bu dosyaları yeniler. Yalnızca bir depo
                                   kopyasından çalışır; varsayılan ~/.baocut asla kullanılmaz
    --link-accounts-from <home>    O klasörün (genellikle ~/.baocut) model hesaplarını da salt okunur bağlar, baocut models
                                   accounts link --from gibi. Çağrılar gerçek hesaplarınızı kullanır ve ücretlendirilir`,
  defaultHome: (dir) => `${dir} gerçek verilerinizin bulunduğu varsayılan Runtime klasörü; sandbox için başka bir klasör seçin`,
  needsSourceCli:
    "baocut sandbox create yalnızca bir depo kopyasından çalışır (node apps/cli/src/main.ts sandbox create …). Bu CLI, BaoCut uygulamasının Runtime'ını başlatır; o Runtime anahtarları tüm klasörlerin paylaştığı sistem anahtar zincirinde tutar: orada bir sandbox gerçek anahtarlarınızın üzerine yazabilir veya onları silebilir",
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY ${entry} konumunu gösteriyor ve o Runtime'ın anahtarları nerede tuttuğu bilinmiyor. Sandbox oluşturmadan önce bu değişkeni kaldırın`,
  notEmpty: (dir) => `${dir} içinde zaten dosyalar var ve bir BaoCut klasörü değil; yeni veya boş bir klasör seçin`,
  notFolder: (dir) => `${dir} bir klasör değil`,
  created: (dir) => `Sandbox hazır: ${dir}`,
  refreshed: (dir) => `Sandbox yenilendi: ${dir}`,
  projects: (dir) => `  Projeler  ${dir}`,
  cli: (file) => `  baocut    ${file} (bu kopyanın CLI'sini çalıştırır)`,
  useHeader: "Bir shell'de kullanmak için:",
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    "Ardından o shell'deki baocut ve oradan başlatılan agent'lar sandbox'ı kullanır; diğer shell'ler ~/.baocut kullanmaya devam eder. Runtime'ı anahtarları sandbox içindeki bir dosyada tutar",
  linkFailed: (dir) => `${dir} içindeki sandbox hazır; hesaplar bağlanamadı:`,
};
