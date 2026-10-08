import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const tr: ProcessHostWorkerMessages = {
requestFailed: (p) => `${p.method} başarısız oldu: ${p.code}: ${p.message}`, exited: (p) => `${p.method} tamamlanmadı: alt süreç çıktı (code ${p.code}, signal ${p.signal})`, notRunning: (p) => `${p.method} gönderilmedi: alt süreç çalışmıyor`, timedOut: (p) => `${p.method} zaman aşımına uğradı (${p.ms} ms)`, spawnFailed: (p) => `${p.command} başlatılamadı: ${p.error}`, malformedError: 'Alt süreç hatalı biçimde hata döndürdü',
};
