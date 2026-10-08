import type { ToolUpdateMessages } from './tool-update.ts';

export const tr: ToolUpdateMessages = {
standalone: 'Resmî bağımsız program',
updateInTerminal: 'Terminal’de güncelle',
unknownInstall: "Bu yt-dlp kurulumunun nasıl yapıldığı belirlenemiyor. Yükleme yönteminize uyan komutu çalıştırın, sonra “Yeniden denetle” düğmesine tıklayın.",
cannotRun: 'BaoCut bu komutu sizin için çalıştıramaz.',
thenRecheck: 'Sonra “Yeniden denetle” düğmesine tıklayın.',
runThenRecheck: 'Bu komutu Terminal’de çalıştırın, sonra “Yeniden denetle” düğmesine tıklayın.',
updateWith: (method) => `${method} ile güncelle`,
stoppedTitle: 'Güncelleme durduruldu',
stoppedBody: 'Komut kısmen çalışmış olabilir. Aşağıdaki çıktıyı inceleyin, ardından mevcut yt-dlp sürümünü doğrulamak için “Yeniden denetle” düğmesine tıklayın.',
failedTitle: (exitCode) => exitCode === null ? 'Güncelleme tamamlanmadı' : `Güncelleme tamamlanmadı (çıkış kodu ${exitCode})`,
failedBody: (error) => `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}Mevcut yt-dlp etkilenmez. Çıktı aşağıdadır; komutu kopyalayıp Terminal’de çalıştırabilir, sonra “Yeniden denetle” düğmesine tıklayabilirsiniz.`,
updatedTo: (version) => `${version} sürümüne güncellendi`,
upToDate: (version) => version ? `Zaten güncel (${version})` : 'Zaten güncel',
logTruncated: '… (önceki çıktı atlandı; tam çıktı görev kaydında)\n',
logStopped: '(Durduruldu)',
logExitCode: (exitCode) => `(Çıkış kodu ${exitCode})`,
};
