import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const tr: AgentHostsMessages = {
missingAgent: (hosts) => `--agent eksik: şunlardan biri ${hosts.join(', ')}`, unknownAgent: (value, hosts) => `Bilinmeyen ajan “${value}”: yalnızca ${hosts.join(', ')}`, invalidJson: (file, reason) => `${file} geçerli JSON değil; hiçbir şey değişmedi: ${reason}`, notObject: (file) => `${file} dosyasının üst düzeyi nesne değil; hiçbir şey değişmedi`,
};
