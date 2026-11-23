import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const tr: RcArtifactsMessages = {
  unavailable: "Yapıtlar kullanılamıyor: Open Artifact başlatılamadı.",
  unavailableBecause: (p: { reason: string }) => `Yapıtlar kullanılamıyor: ${p.reason}`,
  notFound: "Bu yapıt bulunamadı. Silinmiş olabilir.",
  viewGone: "Bu yapıt görünümü kapandı. Yapıtı yeniden açın.",
  confirmAction: (p: { tool: string; action: string }) => `Bir yapıtta “${p.action}” çalıştır (${p.tool})`,
  skillName: "Yapıtlar",
  skillSummary: "Open Artifact ile slayt, belge, tasarım, tablo ve daha fazlasını oluşturun",
};
