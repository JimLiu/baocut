import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const vi: ProcessHostWorkerMessages = {
requestFailed: (p) => `${p.method} thất bại: ${p.code}: ${p.message}`, exited: (p) => `${p.method} chưa hoàn tất: tiến trình con đã thoát (code ${p.code}, signal ${p.signal})`, notRunning: (p) => `${p.method} chưa gửi: tiến trình con không chạy`, timedOut: (p) => `${p.method} hết thời gian chờ (${p.ms} ms)`, spawnFailed: (p) => `Không khởi chạy được ${p.command}: ${p.error}`, malformedError: 'Tiến trình con trả về lỗi sai định dạng',
};
