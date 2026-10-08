import type { AgentTurnMessages } from './agent-turn.ts';

export const tr: AgentTurnMessages = {
  waiting: "Onayınız bekleniyor",
  working: "İşleniyor",
  stopping: "Durduruluyor",
  worked: (span) => `${span} boyunca çalıştı`,
  stoppedAfter: (span) => `Durduruldu · ${span} boyunca çalıştı`,
  stopped: "Durduruldu",
  failed: (error) => `Başarısız · ${error ?? 'bilinmeyen neden'}`,
  stepStatus: { declined: "Reddedildi", interrupted: "Kesildi" },
  exitCode: (code) => `Çıkış kodu ${code}`,
  stepDeclined: "Bu adım reddedildi",
  commandExited: (code) => `Komut ${code} koduyla sona erdi`,
  stepIncomplete: "Bu adım tamamlanmadı",
  lineRange: (path,line,end) => `${path} · satırlar ${line}–${end}`,
  lineCol: (path,line,col) => `${path} · satır ${line}, sütun ${col}`,
  line: (path,line) => `${path} · satır ${line}`,
};
