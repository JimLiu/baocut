import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const vi: AgentHostsMessages = {
missingAgent: (hosts) => `Thiếu --agent: một trong ${hosts.join(', ')}`, unknownAgent: (value, hosts) => `Agent không xác định “${value}”: chỉ có ${hosts.join(', ')}`, invalidJson: (file, reason) => `${file} không phải JSON hợp lệ; chưa thay đổi gì: ${reason}`, notObject: (file) => `Cấp cao nhất của ${file} không phải đối tượng; chưa thay đổi gì`,
};
