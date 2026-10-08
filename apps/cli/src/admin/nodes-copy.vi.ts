import type { NodesMessages } from './nodes-copy.ts';

export const vi: NodesMessages = {
nodesHelp: (port) => `Cách dùng:
  baocut nodes                     Liệt kê nút LAN đã ghép đôi (kiểm tra trực tiếp từng nút)
  baocut nodes discover            Duyệt nút LAN chia sẻ khả năng (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Ghép đôi bằng mã trong Chia sẻ máy tính này của máy tính kia;
                                   cổng mặc định ${port}
  baocut nodes remove <nodeId|alias>
                                   Xóa nút và token được nhớ trên máy tính này`,
noPairedNodes: 'Chưa có nút ghép đôi. Ghép bằng baocut nodes pair <address[:port]> <pairing code>', noNodesDiscovered: 'Không tìm thấy nút chia sẻ khả năng (chỉ duyệt được trên macOS; cũng có thể ghép bằng cách nhập địa chỉ)', pairUsage: 'Cách dùng: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]', removeUsage: 'Cách dùng: baocut nodes remove <nodeId|alias>', paired: (description) => `Đã ghép đôi: ${description}`, noSuchNode: (ref) => `Không có nút ghép đôi: ${ref}`, removed: (alias, nodeId) => `Đã xóa ${alias} (${nodeId})`, invalidPort: (port) => `Cổng không hợp lệ: ${port}`,
shareHelp: (port, capabilities) => `Cách dùng:
  baocut share [status]            Trạng thái Chia sẻ máy tính này: địa chỉ, cổng,
                                   công tắc từng khả năng, mã ghép đôi, máy tính đã ghép
  baocut share start [options]     Bắt đầu chia sẻ và tạo mã ghép đôi
    --port <port>                  Mặc định ${port}
    --name <name>                  Tên người khác thấy, mặc định tên máy chủ
    --allow-any-source             Nhận mọi địa chỉ nguồn (mặc định chỉ địa chỉ LAN)
  baocut share stop                Dừng chia sẻ (hủy tác vụ người khác gửi)
  baocut share code                Vô hiệu mã ghép đôi cũ và tạo mã mới
  baocut share revoke <clientId>   Thu hồi máy tính đã ghép đôi
  baocut share capability <capability> <on|off>
                                   Bật hoặc tắt chia sẻ khả năng (${capabilities.join(', ')}), có hiệu lực ngay:
                                   khi tắt sẽ từ chối tác vụ mới từ người khác;
                                   tác vụ đã nhận vẫn chạy đến hoàn tất`,
portRange: '--port phải là số nguyên từ 0 đến 65535', shareRevokeUsage: 'Cách dùng: baocut share revoke <clientId>', capabilityLabels: { transcribe: 'Chép lời' }, capabilityUsage: 'Cách dùng: baocut share capability <capability> <on|off> (ví dụ baocut share capability transcribe off)', shareOff: 'Tắt', shareOn: 'Bật', shareNotListening: (error) => `Bật nhưng chưa lắng nghe${error ? `: ${error}` : ''}`, shareState: (state) => `Chia sẻ máy tính này: ${state}`, name: (name, nodeId) => `Tên: ${name}${nodeId ? ` (${nodeId})` : ''}`, port: (port, anySource) => `Cổng: ${port}${anySource ? ' (mọi địa chỉ nguồn)' : ''}`, addresses: (addresses) => `Địa chỉ: ${addresses ?? '(không có địa chỉ mạng cục bộ)'}`, capabilitiesHead: (empty) => `Khả năng: ${empty ? 'không có' : ''}`, capabilityLine: (label, capability, enabled) => `  ${label} (${capability}): ${enabled ? 'bật' : `tắt (bật bằng baocut share capability ${capability} on)`}`, pairingCode: (code, until) => `Mã ghép đôi: ${code} (hợp lệ đến ${until})`, pairingLocked: (until) => `Ghép đôi bị khóa đến ${until} (baocut share code mở khóa ngay)`, noPairingCode: 'Mã ghép đôi: không có (baocut share code tạo mã)', clientsHead: (empty) => `Máy tính đã ghép đôi: ${empty ? 'không có' : ''}`, clientLine: (name, clientId, pairedAt, lastSeenAt) => `  ${name}  ${clientId}  ghép đôi ${pairedAt}${lastSeenAt ? `  thấy lần cuối ${lastSeenAt}` : ''}`, remoteTasks: (running, queued) => `Tác vụ từ xa: ${running} đang chạy, ${queued} đang chờ`, unreachable: 'Không thể kết nối', versionMismatch: 'Phiên bản giao thức không tương thích', unpaired: 'Ghép đôi không còn hợp lệ (ghép lại)', available: 'Khả dụng', transcribeReady: (bundles, running, queued) => `Khả dụng · mô hình ${bundles.length > 0 ? bundles.join(', ') : 'không có'} · ${running} đang chạy, ${queued} đang chờ`, transcribeOff: 'Không khả dụng · nút đã tắt chia sẻ chép lời (bật trên máy tính đó)',
};
