import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const vi: ResourceCapacityMessages = {
sources: { system: 'Hệ thống phát hiện', setting: 'Đặt thủ công', 'unified-estimate': 'Ước tính từ bộ nhớ hợp nhất', unknown: 'Chưa rõ', statfs: 'Dung lượng trống trên đĩa chứa tệp tạm' }, dimensions: { memory: 'Bộ nhớ', gpuMemory: 'Bộ nhớ GPU', cpuThreads: 'Luồng CPU', scratchDisk: 'Dung lượng đĩa tạm' }, unknown: 'Chưa rõ', threads: (n) => `${n} luồng`, unifiedMemory: 'Dùng chung bộ nhớ; mức dùng GPU cũng tính vào bộ nhớ', inUse: (amount) => `Đang dùng ${amount}`, backgroundAvailable: (amount) => `${amount} khả dụng cho tác vụ nền`, demandPart: (dimension, amount) => `${dimension} ${amount}`, joinDemand: (parts) => parts.join(', '), noDemand: 'Không dùng tài nguyên cục bộ', auto: 'Tự động', autoWith: (value) => `Tự động (${value})`,
};
