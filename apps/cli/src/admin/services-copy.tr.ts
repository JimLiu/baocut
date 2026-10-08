import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const tr: ServicesMessages = {
accessLinkVideo: (video) => `Girişten sonra ${video} videosunun düzenleyicisi doğrudan açılır`,
help: `Kullanım:
  baocut services [status]         Dış hizmetler: MCP, model API, web hizmeti ve LAN düğümünün
                                   durumu, adresi, düzeyi ve kapsamı
  baocut services start <service>  Hizmet başlat (mcp, model-api, web, node)
  baocut services stop <service>   Hizmeti durdur (dış bağlantılar kesilir, onay bekleyen istekler
                                   iptal edilir; gönderilmiş görevler tamamlanır)
  baocut services configure <service> [options]
    --port <port>                  Dinleme portu (yalnızca loopback; MCP varsayılan ${MCP_DEFAULT_PORT}, model API
                                   ${MODEL_API_DEFAULT_PORT}); doluysa port değiştirmek yerine hata bildirir
    --level read|ask|auto          read salt okunur; ask her yazma, görev ve oluşturmada BaoCut
                                   içinde onay ister (varsayılan); auto doğrudan çalıştırır
    --videos all|<id,…>            Tüm videoları veya yalnızca bu videoId değerlerini aç (virgülle ayrılmış); kapsam
                                   dışı videolar dışarıdan görünmez (model API hizmetinin kapsamı yok)
    --autostart on|off             Runtime ile başlat
    --route-online on|off          Model API: istekleri etkin çevrimiçi hizmetlere ilet (varsayılan kapalı, yalnızca yerel)
    --route-nodes on|off           Model API: eşleştirilmiş LAN düğümlerine ilet (varsayılan kapalı)
    --route-agent on|off           Model API: ajan sağlayıcılarına ilet (varsayılan kapalı)
    --max-concurrent <n>           Model API: istemci başına süren istekler (varsayılan 4); sınır üstü 429 alır
    --read-only on|off             Yalnızca web: tarayıcı yalnızca görüntüler; düzenleyemez, mesaj veya görev gönderemez
    --methods default|<method,…>   Yalnızca web: yöntem izin listesi (yöntem adı veya <namespace>.*), varsayılanı yalnızca daraltabilir
  baocut services mcp add-client <name>
                                   Dış uygulama için jeton oluştur (yalnızca bu sefer gösterilir);
                                   uygulama başına bir tane, her biri ayrı iptal edilebilir
  baocut services mcp clients      Oluşturulan istemcileri listele (jetonlar yok)
  baocut services mcp revoke <clientId>
                                   İstemciyi iptal et; jetonu hemen çalışmayı bırakır
  baocut services mcp connection [clientId]
                                   Adresi ve MCP istemci yapılandırmasına yapıştırılacak parçayı
                                   yazdır (jeton için yer tutucuyla)
  baocut services model-api add-client|clients|revoke|connection …
                                   Model API hizmeti istemcileri (yerel OpenAI tarzı uç nokta), yukarıdaki gibi;
                                   jetonları MCP jetonlarıyla birbirinin yerine kullanılamaz;
                                   connection OPENAI_BASE_URL ve OPENAI_API_KEY ayarlama yolunu yazdırır
  baocut services model-api aliases
                                   Model adı takma adlarını listele (varsayılan whisper-1 → yerel varsayılan yazıya dökme modeli)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Takma ad ekle veya değiştir; model verilmezse sağlayıcının varsayılan modeli kullanılır
  baocut services model-api unalias <name>
                                   Takma ad sil
  baocut services web sessions     Tarayıcı oturumlarını listele (oturum jetonları yok)
  baocut services web revoke <sessionId>
                                   Tarayıcı oturumunu iptal et: bağlantısı hemen kesilir`,
webHelp: `Kullanım:
  baocut web open [--video <videoId>] [--launch]       Web hizmetini başlat (varsayılan port ${WEB_DEFAULT_PORT}) ve tek kullanımlık erişim bağlantısını yazdır;
                                   bağlantı yalnızca bir kez, iki dakika çalışır. --video videoyu doğrudan düzenleyicide açar
                                   (videoId baocut videos list komutundan gelir). --launch varsayılan tarayıcıda kod içermeyen
                                   giriş sayfası açar; erişim kodu yalnızca terminalde yazdırılır, giriş sayfasına yapıştırın
                                   (kod tarayıcıyı açan komutun argümanlarına aktarılmaz)`,
usage: 'Kullanım: baocut services [status | start <service> | stop <service>\n       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n                    [--read-only on|off] [--methods default|<method,…>]\n       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n       | mcp|model-api connection [clientId]\n       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n       | web sessions | web revoke <sessionId>]', unknownService: (id, available) => `Bilinmeyen hizmet: ${id}. Kullanılabilir: ${available.join(', ')}`, addClientUsage: (service) => `Kullanım: baocut services ${service} add-client <name> (tanıyacağınız ad seçin, örneğin ${service === 'mcp' ? 'Claude Desktop' : 'Altyazı Aracı'})`, aliasUsage: (capabilities) => `Kullanım: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (yetenekler: ${capabilities.join(', ')})`, unknownCapability: (capability, available) => `Bilinmeyen yetenek: ${capability}. Kullanılabilir: ${available.join(', ')}`, onOff: (flag) => `${flag} on veya off olmalı`, portRange: '--port 1–65535 arasında tam sayı olmalı', levelChoice: (levels) => `--level şunlardan biri olmalı: ${levels.join(', ')}`, videosFormat: '--videos all veya virgülle ayrılmış video ID değerleri olmalı', maxConcurrentRange: '--max-concurrent 1–64 arasında tam sayı olmalı', routingOnlyModelApi: '--route-online, --route-nodes, --route-agent ve --max-concurrent yalnızca model-api için geçerli', methodsFormat: '--methods default veya virgülle ayrılmış yöntem adları ve <namespace>.* olmalı', webOnlyFlags: '--read-only ve --methods yalnızca web hizmetinde geçerli', nothingToConfigure: 'Değişiklik yok: --port, --level, --videos, --autostart, model-api yönlendirme ve eşzamanlılığı veya web için --read-only ve --methods verin', states: { off: 'Kapalı', starting: 'Başlatılıyor', on: 'Açık', stopping: 'Durduruluyor', error: 'Hata' }, levels: { read: 'read (salt okunur)', ask: 'ask (her yazmada onay)', auto: 'auto (doğrudan çalıştır)' }, levelAskModelApi: 'ask (her oluşturma isteğinde onay)', notProvided: (serviceId, label) => `${serviceId}  ${label}  Bu sürümde kullanılamıyor`, port: (port) => `port ${port}`, reason: (error) => `  Neden: ${error}`, nodeHint: '  Port, yetenek ve eşleştirme için baocut share kullanın', autostart: (on) => `  Runtime ile başlat: ${on ? 'evet' : 'hayır'}`, level: (level) => `  Düzey: ${level}`, levelScope: (level, scope) => `  Düzey: ${level}  Kapsam: ${scope}`, allVideos: 'tüm videolar', someVideos: (ids) => `${ids.length} video (${ids.join(', ')})`, routeLocal: 'bu bilgisayar', routeOnline: 'çevrimiçi hizmetler', routeNodes: 'LAN düğümleri', routeAgent: 'ajan', routing: (routes, maxConcurrent) => `  Yönlendirme: ${routes.join(', ')}  istemci başına ${maxConcurrent} eşzamanlı istek`, aliases: (aliases) => `  Takma adlar: ${aliases.length > 0 ? aliases.join(', ') : 'yok'}`, clientCount: (count) => `  İstemciler: ${count}`, web: (readOnly, methods) => `  Salt okunur: ${readOnly ? 'evet' : 'hayır'}  İzinli yöntemler: ${methods === null ? 'varsayılan küme' : methods.join(', ')}`, browserSessions: (count) => `  Tarayıcı oturumları: ${count} (erişim bağlantısı: baocut web open)`, aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'varsayılan model'} (${capability})`, noAliases: 'Takma ad yok. baocut services model-api alias <name> <capability> <providerId>[/<modelId>] ile ekleyin', noClients: (service) => `İstemci yok. baocut services ${service} add-client <name> ile oluşturun`, client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  oluşturuldu ${createdAt}  son kullanım ${lastUsedAt ?? 'hiç'}`, clientCreated: (name, clientId) => `İstemci oluşturuldu: ${name} (${clientId})`, tokenOnce: (token) => `Jeton (yalnızca bu sefer gösterilir; şimdi kopyalayıp kaydedin. Kaybolursa istemciyi iptal edip yenisini oluşturun): ${token}`, address: (url) => `URL: ${url}`, bearerHeader: 'Başlık: Authorization: Bearer <token>', header: (value) => `Başlık: Authorization: ${value}`, interfaceVersion: (version) => `Arayüz sürümü: ${version}`, snippetIntro: 'Yapılandırma parçası (jeton yer tutucusunu istemci oluştururken aldığınız jetonla değiştirin):', noWebSessions: 'Tarayıcı oturumu yok. baocut web open ile erişim bağlantısı alın', webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  giriş ${createdAt}  son kullanım ${lastUsedAt}  sona erme ${expiresAt}  ${connections} bağlantı`, accessLinkNote: (expiresAt) => `Bu bağlantı bir kez çalışır ve ${expiresAt} zamanına kadar geçerlidir; paylaşmayın. Kullanıldıktan veya süresi dolduktan sonra baocut web open yeniden çalıştırın`, badAccessLink: 'Erişim bağlantısı beklenen biçimde değil: BaoCut güncelleyin veya --launch olmadan yeniden çalıştırın', accessCode: (code) => `Erişim kodu: ${code}`, launchNote: (loginUrl, expiresAt) => `Bu kodu tarayıcınızda açılan giriş sayfasına yapıştırın (${loginUrl}). Kod bir kez çalışır ve ${expiresAt} zamanına kadar geçerlidir; paylaşmayın. Kullanıldıktan veya süresi dolduktan sonra baocut web open yeniden çalıştırın`, webNotStarted: (reason) => `Web hizmeti başlamadı: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} başarısız oldu: ${reason}`, clientRevoked: (clientId) => `${clientId} iptal edildi; jetonu hemen çalışmayı bırakır`, webSessionRevoked: (sessionId) => `${sessionId} iptal edildi; bağlantısı kapatıldı`, browserFailed: (message) => `Tarayıcı açılamadı: ${message}. Yukarıdaki giriş sayfasını kendiniz açın`,
};
