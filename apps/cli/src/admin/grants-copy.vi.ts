import type { GrantsMessages } from './grants-copy.ts';

export const vi: GrantsMessages = {
help: `Cách dùng:
  baocut grants [list]             Liệt kê ủy quyền chia sẻ dữ liệu (nhà cung cấp trực tuyến và Agent):
                                   bên nhận, loại dữ liệu, phạm vi, mức sử dụng và ngân sách
    --recipient <id>               Chỉ ủy quyền của nhà cung cấp này
    --video <video id>             Chỉ ủy quyền bao gồm video này
    --include-ended                Liệt kê cả ủy quyền đã thu hồi, hết hạn và dùng hết
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Cấp ủy quyền. Loại dữ liệu: transcript (bản chép lời và bản dịch), frames (khung hình video),
                                   audio (âm thanh), video (video gốc), document (văn bản và lời nhắc), context (ngữ cảnh Agent)
    --video <video id|all>         Chỉ bao gồm video này; bỏ qua hoặc all nghĩa là mọi video
    --max-calls <n>                Giới hạn lệnh gọi; không giới hạn nếu bỏ qua
    --budget <amount> --currency <currency>
                                   Giới hạn chi tiêu: ước tính và dự phòng theo giá mô hình;
                                   từ chối lệnh gọi mô hình không có giá (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Thời điểm hết hạn
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Đổi ủy quyền; thu hẹp, giảm giới hạn hoặc rút ngắn hạn sẽ từ chối
                                   lệnh gọi xếp hàng theo điều kiện cũ khi bắt đầu
  baocut grants revoke <id>        Thu hồi ủy quyền: lệnh gọi sau không được phép; dữ liệu đã gửi
                                   và chi phí đã tính được báo nguyên trạng
  baocut grants usage <id>         Mức sử dụng ủy quyền và tác vụ đã dùng (dự phòng và quyết toán)`,
usage: 'Cách dùng: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options] | update <grant id> [options] | revoke <grant id> | usage <grant id>]', listSep: ', ', missingRecipient: 'Thiếu --recipient (nhà cung cấp nhận dữ liệu, ví dụ openai)', missingData: (kinds) => `Thiếu --data (loại dữ liệu, cách nhau bằng dấu phẩy: ${kinds.join(', ')})`, missingPurpose: 'Thiếu --purpose (một câu cho người đọc)', recipientFixed: 'Không thể đổi bên nhận: thu hồi ủy quyền này và tạo mới', nothingToUpdate: 'Không có gì để đổi: cung cấp --data, --video, --purpose, --max-calls, --budget hoặc --expires', persistOnly: '--scope, --max-calls, --budget và --expires chỉ dùng cùng --persist', scopeChoices: '--scope nhận video hoặc all', unknownKinds: (unknown, kinds) => `Loại dữ liệu không xác định: ${unknown}. Chọn trong ${kinds.join(', ')}`, maxCallsRange: '--max-calls phải là số nguyên từ 1 đến 1000000 hoặc none (không giới hạn)', currencyNeedsBudget: '--currency chỉ dùng cùng --budget', budgetFormat: '--budget phải là số tiền thập phân không âm với tối đa 6 chữ số thập phân (ví dụ 5 hoặc 2.50)', budgetNeedsCurrency: '--budget cần --currency <mã tiền tệ ba chữ cái, ví dụ USD>', expiresFormat: '--expires phải là thời gian ISO có múi giờ (ví dụ 2026-12-31T23:59:59Z) hoặc none', stateLabels: { active: 'Hoạt động', expired: 'Hết hạn', revoked: 'Đã thu hồi', exhausted: 'Đã dùng hết' }, originLabels: { user: 'do bạn cấp', approval: 'cấp khi phê duyệt', 'provider-enable': 'mặc định khi bật' }, calls: (calls, reserved, max) => `${calls}${reserved ? `+${reserved} dự phòng` : ''}${max !== null ? `/${max}` : ''} lệnh gọi`, unknownCostCalls: (n) => ` (${n} lệnh gọi chưa rõ chi phí)`, callsAndAmount: (calls, amount, reserved, cap, currency) => `${calls}, ${amount}${reserved ? `+${reserved} dự phòng` : ''}/${cap} ${currency}`, noGrants: 'Không có ủy quyền: lệnh gọi nhà cung cấp trực tuyến và Agent sẽ xin phê duyệt (hoặc tạo bằng baocut grants create)', scopeVideo: (videoId) => `video ${videoId}`, scopeAll: 'mọi video', grantLine: (g) => `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, chỉ tác vụ ${g.taskId}` : ''}${g.once ? ', chỉ lần này' : ''}  mức sử dụng ${g.usage}${g.expiresAt ? `, hết hạn ${g.expiresAt}` : ''}  (${g.origin}: ${g.purpose})`, revoked: (id, recipient, kinds) => `Đã thu hồi ${id} (${recipient} ← ${kinds})`, alreadySent: (calls, amount, unknownCostCalls) => `Đã gửi: ${calls} lệnh gọi${amount ? `, đã tính ${amount}` : ''}${unknownCostCalls ? ` (${unknownCostCalls} lệnh gọi chưa rõ chi phí)` : ''}`, runningJobs: (jobs) => `Tác vụ vẫn chạy (sẽ hoàn tất như thường lệ): ${jobs.join(', ')}`, noJobs: '(Chưa có tác vụ dùng hoặc bản ghi tác vụ đã được dọn)', settled: (calls, amount, basis) => `đã quyết toán ${calls} lệnh gọi ${amount} (${basis})`, unsettled: 'chưa quyết toán', jobLine: (jobId, state, calls, amount, settled) => `  ${jobId}  ${state}  dự phòng ${calls} lệnh gọi ${amount}  ${settled}`, approvalGrant: (a) => `    Gửi: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (video ${a.videoId})` : ''}: ${a.purpose}${a.estimate ? `, ước tính ${a.estimate}` : ', chưa rõ chi phí'}${a.maxCalls !== null ? `, tối đa ${a.maxCalls} lệnh gọi` : ''}${a.reason === 'revoked' ? ', ủy quyền đã thu hồi hoặc hết hạn' : a.reason === 'unverifiable' ? ', không thể ước tính chi phí' : ''}`,
};
