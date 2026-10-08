import type { AgentTurnMessages } from './agent-turn.ts';

export const vi: AgentTurnMessages = {
  waiting: "Đang chờ bạn phê duyệt",
  working: "Đang xử lý",
  stopping: "Đang dừng",
  worked: (span) => `Đã làm trong ${span}`,
  stoppedAfter: (span) => `Đã dừng · làm trong ${span}`,
  stopped: "Đã dừng",
  failed: (error) => `Thất bại · ${error ?? 'không rõ nguyên nhân'}`,
  stepStatus: { declined: "Đã từ chối", interrupted: "Bị gián đoạn" },
  exitCode: (code) => `Mã thoát ${code}`,
  stepDeclined: "Bước này đã bị từ chối",
  commandExited: (code) => `Lệnh thoát với mã ${code}`,
  stepIncomplete: "Bước này chưa hoàn tất",
  lineRange: (path,line,end) => `${path} · dòng ${line}–${end}`,
  lineCol: (path,line,col) => `${path} · dòng ${line}, cột ${col}`,
  line: (path,line) => `${path} · dòng ${line}`,
};
