import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const vi: ServicesMessages = {
accessLinkVideo: (video) => `Sau khi đăng nhập, trình chỉnh sửa video ${video} mở trực tiếp`,
help: `Cách dùng:
  baocut services [status]         Dịch vụ bên ngoài: trạng thái, địa chỉ, mức và phạm vi của
                                   dịch vụ MCP, API mô hình, web và nút LAN
  baocut services start <service>  Khởi chạy dịch vụ (mcp, model-api, web, node)
  baocut services stop <service>   Dừng dịch vụ (ngắt kết nối bên ngoài và hủy yêu cầu chờ xác nhận;
                                   tác vụ đã gửi chạy đến hoàn tất)
  baocut services configure <service> [options]
    --port <port>                  Cổng lắng nghe (chỉ loopback; MCP mặc định ${MCP_DEFAULT_PORT}, API mô hình
                                   ${MODEL_API_DEFAULT_PORT}); nếu bận thì báo lỗi thay vì đổi cổng
    --level read|ask|auto          read chỉ đọc; ask yêu cầu xác nhận mỗi lần ghi, tác vụ và tạo
                                   trong BaoCut (mặc định); auto chạy trực tiếp
    --videos all|<id,…>            Công khai mọi video hoặc chỉ videoId này (cách nhau bằng dấu phẩy); video ngoài
                                   phạm vi không thấy được từ ngoài (dịch vụ API mô hình không có phạm vi)
    --autostart on|off             Khởi chạy cùng Runtime
    --route-online on|off          API mô hình: chuyển yêu cầu đến dịch vụ trực tuyến đã bật (mặc định tắt, chỉ mô hình cục bộ)
    --route-nodes on|off           API mô hình: chuyển đến nút LAN đã ghép (mặc định tắt)
    --route-agent on|off           API mô hình: chuyển đến nhà cung cấp Agent (mặc định tắt)
    --max-concurrent <n>           API mô hình: yêu cầu đang chạy mỗi máy khách (mặc định 4); quá giới hạn nhận 429
    --read-only on|off             Chỉ web: trình duyệt chỉ xem, không chỉnh sửa, gửi thông điệp hay tác vụ
    --methods default|<method,…>   Chỉ web: danh sách phương thức cho phép (tên hoặc <namespace>.*), chỉ thu hẹp tập mặc định
  baocut services mcp add-client <name>
                                   Tạo token cho ứng dụng ngoài (chỉ hiện lần này);
                                   mỗi ứng dụng một token, có thể thu hồi riêng
  baocut services mcp clients      Liệt kê máy khách đã tạo (không kèm token)
  baocut services mcp revoke <clientId>
                                   Thu hồi máy khách; token ngừng hoạt động ngay
  baocut services mcp connection [clientId]
                                   In địa chỉ và đoạn để dán vào cấu hình máy khách MCP
                                   (có chỗ giữ cho token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Máy khách của API mô hình (điểm cuối cục bộ theo kiểu OpenAI), dùng như trên;
                                   token không dùng thay token MCP được;
                                   connection in cách đặt OPENAI_BASE_URL và OPENAI_API_KEY
  baocut services model-api aliases
                                   Liệt kê bí danh mô hình (mặc định whisper-1 → mô hình chép lời cục bộ mặc định)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Thêm hoặc đổi bí danh; không có mô hình thì dùng mặc định nhà cung cấp
  baocut services model-api unalias <name>
                                   Xóa bí danh
  baocut services web sessions     Liệt kê phiên trình duyệt (không kèm token phiên)
  baocut services web revoke <sessionId>
                                   Thu hồi phiên trình duyệt: kết nối ngắt ngay`,
webHelp: `Cách dùng:
  baocut web open [--video <videoId>] [--launch]       Khởi chạy dịch vụ web (cổng mặc định ${WEB_DEFAULT_PORT}) và in liên kết truy cập dùng một lần;
                                   liên kết hoạt động một lần trong hai phút. --video mở thẳng video trong trình chỉnh sửa
                                   (videoId từ baocut videos list). --launch mở trang đăng nhập không có mã trong trình duyệt
                                   mặc định; mã chỉ được in trong terminal để bạn dán vào trang đăng nhập
                                   (mã không truyền qua đối số của lệnh mở trình duyệt)`,
usage: 'Cách dùng: baocut services [status | start <service> | stop <service>\n       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n                    [--read-only on|off] [--methods default|<method,…>]\n       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n       | mcp|model-api connection [clientId]\n       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n       | web sessions | web revoke <sessionId>]', unknownService: (id, available) => `Dịch vụ không xác định: ${id}. Có sẵn: ${available.join(', ')}`, addClientUsage: (service) => `Cách dùng: baocut services ${service} add-client <name> (chọn tên dễ nhận biết, ví dụ ${service === 'mcp' ? 'Claude Desktop' : 'Công cụ phụ đề'})`, aliasUsage: (capabilities) => `Cách dùng: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (khả năng: ${capabilities.join(', ')})`, unknownCapability: (capability, available) => `Khả năng không xác định: ${capability}. Có sẵn: ${available.join(', ')}`, onOff: (flag) => `${flag} phải là on hoặc off`, portRange: '--port phải là số nguyên từ 1 đến 65535', levelChoice: (levels) => `--level phải là một trong: ${levels.join(', ')}`, videosFormat: '--videos phải là all hoặc ID video cách nhau bằng dấu phẩy', maxConcurrentRange: '--max-concurrent phải là số nguyên từ 1 đến 64', routingOnlyModelApi: '--route-online, --route-nodes, --route-agent và --max-concurrent chỉ áp dụng cho model-api', methodsFormat: '--methods phải là default hoặc tên phương thức và <namespace>.* cách nhau bằng dấu phẩy', webOnlyFlags: '--read-only và --methods chỉ áp dụng cho dịch vụ web', nothingToConfigure: 'Không có gì để đổi: cung cấp --port, --level, --videos, --autostart, định tuyến và đồng thời model-api hoặc --read-only và --methods cho web', states: { off: 'Tắt', starting: 'Đang khởi chạy', on: 'Bật', stopping: 'Đang dừng', error: 'Lỗi' }, levels: { read: 'read (chỉ đọc)', ask: 'ask (xác nhận mỗi lần ghi)', auto: 'auto (chạy trực tiếp)' }, levelAskModelApi: 'ask (xác nhận mỗi yêu cầu tạo)', notProvided: (serviceId, label) => `${serviceId}  ${label}  Không khả dụng trong phiên bản này`, port: (port) => `cổng ${port}`, reason: (error) => `  Lý do: ${error}`, nodeHint: '  Dùng baocut share cho cổng, khả năng và ghép đôi', autostart: (on) => `  Khởi chạy cùng Runtime: ${on ? 'có' : 'không'}`, level: (level) => `  Mức: ${level}`, levelScope: (level, scope) => `  Mức: ${level}  Phạm vi: ${scope}`, allVideos: 'mọi video', someVideos: (ids) => `${ids.length} video (${ids.join(', ')})`, routeLocal: 'máy tính này', routeOnline: 'dịch vụ trực tuyến', routeNodes: 'nút LAN', routeAgent: 'Agent', routing: (routes, maxConcurrent) => `  Định tuyến đến: ${routes.join(', ')}  ${maxConcurrent} yêu cầu đồng thời mỗi máy khách`, aliases: (aliases) => `  Bí danh: ${aliases.length > 0 ? aliases.join(', ') : 'không có'}`, clientCount: (count) => `  Máy khách: ${count}`, web: (readOnly, methods) => `  Chỉ đọc: ${readOnly ? 'có' : 'không'}  Phương thức cho phép: ${methods === null ? 'tập mặc định' : methods.join(', ')}`, browserSessions: (count) => `  Phiên trình duyệt: ${count} (liên kết truy cập: baocut web open)`, aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'mô hình mặc định'} (${capability})`, noAliases: 'Không có bí danh. Thêm bằng baocut services model-api alias <name> <capability> <providerId>[/<modelId>]', noClients: (service) => `Không có máy khách. Tạo bằng baocut services ${service} add-client <name>`, client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  tạo ${createdAt}  dùng lần cuối ${lastUsedAt ?? 'chưa từng'}`, clientCreated: (name, clientId) => `Đã tạo máy khách ${name} (${clientId})`, tokenOnce: (token) => `Token (chỉ hiện lần này; sao chép và lưu ngay. Nếu mất, thu hồi máy khách và tạo mới): ${token}`, address: (url) => `URL: ${url}`, bearerHeader: 'Header: Authorization: Bearer <token>', header: (value) => `Header: Authorization: ${value}`, interfaceVersion: (version) => `Phiên bản giao diện: ${version}`, snippetIntro: 'Đoạn cấu hình (thay chỗ giữ token bằng token nhận khi tạo máy khách):', noWebSessions: 'Không có phiên trình duyệt. Lấy liên kết truy cập bằng baocut web open', webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  đăng nhập ${createdAt}  dùng lần cuối ${lastUsedAt}  hết hạn ${expiresAt}  ${connections} kết nối`, accessLinkNote: (expiresAt) => `Liên kết này dùng một lần và hợp lệ đến ${expiresAt}; không chia sẻ. Sau khi dùng hoặc hết hạn, chạy baocut web open lại`, badAccessLink: 'Liên kết truy cập không đúng định dạng: cập nhật BaoCut hoặc chạy lại không có --launch', accessCode: (code) => `Mã truy cập: ${code}`, launchNote: (loginUrl, expiresAt) => `Dán mã này vào trang đăng nhập đã mở trong trình duyệt (${loginUrl}). Mã dùng một lần và hợp lệ đến ${expiresAt}; không chia sẻ. Sau khi dùng hoặc hết hạn, chạy baocut web open lại`, webNotStarted: (reason) => `Dịch vụ web chưa khởi chạy: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} thất bại: ${reason}`, clientRevoked: (clientId) => `Đã thu hồi ${clientId}; token ngừng hoạt động ngay`, webSessionRevoked: (sessionId) => `Đã thu hồi ${sessionId}; kết nối đã đóng`, browserFailed: (message) => `Không mở được trình duyệt: ${message}. Tự mở trang đăng nhập bên trên`,
};
