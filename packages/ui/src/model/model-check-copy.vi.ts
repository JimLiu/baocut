import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: 'Mô hình chạy được nhưng không nhận dạng được lời nói trong mẫu',
  synthesize: 'Mô hình chạy được nhưng giọng tạo ra không đúng',
  image: 'Mô hình chạy được nhưng hình vẽ không đúng',
  separate: 'Mô hình chạy được nhưng chưa tách giọng khỏi nền',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'Thiếu tệp đi kèm BaoCut; không phải vấn đề mô hình',
    todo: 'Cài lại BaoCut sẽ khắc phục. Mô hình đã tải không bị ảnh hưởng.',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: 'Tệp mô hình bị hỏng', todo: 'Sửa sẽ tải lại tệp hỏng.' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: 'Sửa trước. Nếu vẫn xảy ra, sao chép chi tiết kỹ thuật và gửi cho chúng tôi.',
  }),
  MODEL_OUT_OF_MEMORY: () => ({ text: 'Không đủ bộ nhớ nên không tải được mô hình', todo: 'Đóng mô hình lớn hoặc ứng dụng tốn bộ nhớ khác rồi kiểm tra lại.' }),
  MODEL_WORKER_FAILED: () => ({
    text: 'Tiến trình nền chạy mô hình gặp lỗi',
    todo: 'Kiểm tra lại. Nếu vẫn xảy ra, khởi động lại BaoCut hoặc sao chép chi tiết kỹ thuật gửi cho chúng tôi.',
  }),
};

function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `Không đủ bộ nhớ để hoàn tất ${verb}`, todo: noMemoryTodo },
    modelError: { text: `Mô hình gặp lỗi; không có đầu ra ${verb}`, todo: 'Kiểm tra mô hình để xem lỗi ở đâu.' },
    other: (message) => ({ text: `Không ${verb} được: ${message}`, todo: 'Có thể thử lại. Nếu vẫn xảy ra, xem chi tiết trong Tác vụ nền.' }),
    notStarted: (message) => ({ text: `Không bắt đầu ${verb} được: ${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo} ${noun} lúc này có thể cũng thất bại.`,
  };
}

export const vi: ModelCheckMessages = {
  label: {
    check: 'Kiểm tra',
    checkFull: 'Kiểm tra mô hình',
    recheck: 'Kiểm tra lại',
    repair: 'Sửa…',
    repairSub: 'Chỉ tải lại tệp hỏng',
    details: 'Chi tiết kỹ thuật',
    hideDetails: 'Ẩn chi tiết kỹ thuật',
    copy: 'Sao chép chi tiết kỹ thuật',
    copied: 'Đã sao chép chi tiết kỹ thuật',
    copyFailed: 'Không sao chép được. Chọn văn bản bên trên và tự sao chép.',
    cancel: 'Hủy',
    retry: 'Thử lại',
    pickRef: 'Chọn bản ghi khác…',
    useSample: 'Dùng bản ghi mẫu',
  },
  caption: 'Kiểm tra xác nhận mô hình hoạt động; Sửa chỉ tải lại tệp hỏng. Khi xóa mô hình, giữ thành phần chung mô hình khác vẫn dùng.',
  head: {
    running: 'Đang kiểm tra…',
    repairing: 'Đang sửa…',
    failed: 'Kiểm tra thất bại:',
    notStarted: 'Không bắt đầu kiểm tra được:',
  },
  sentence: (text) => `${text}.`,
  phase: {
    queued: 'Đang chờ',
    loading: 'Đang tải mô hình',
    running: 'Đang chạy mẫu ngắn',
    verifying: 'Đang xác minh kết quả',
    repairing: 'Tải lại tệp hỏng; tự kiểm tra lại khi sửa xong',
  },
  checkSentences,
  unknown: {
    text: 'Mô hình không hoạt động bình thường',
    todo: 'Kiểm tra lại. Nếu vẫn xảy ra, sao chép chi tiết kỹ thuật và gửi cho chúng tôi.',
  },
  notStarted: {
    RUNTIME_UNREACHABLE: { text: 'Dịch vụ nền BaoCut không phản hồi', todo: 'Kiểm tra lại sau. Nếu vẫn xảy ra, khởi động lại BaoCut.' },
    MODEL_IN_USE: { text: 'Tác vụ khác đang dùng mô hình này', todo: 'Chờ tác vụ hoàn tất hoặc hủy trong Tác vụ nền rồi kiểm tra lại.' },
    MODEL_UNAVAILABLE: { text: 'Hiện không dùng được mô hình này', todo: 'Sửa hoặc bật lại trước rồi kiểm tra lại.' },
    RESOURCE_ADMISSION_UNSATISFIABLE: { text: 'Máy tính này không đủ bộ nhớ để chạy mô hình', todo: 'Chuyển mô hình nhỏ hơn.' },
    WEB_METHOD_NOT_ALLOWED: { text: 'Không thể kiểm tra mô hình cục bộ trong trình duyệt', todo: 'Kiểm tra trong ứng dụng máy tính.' },
    OFFLINE_STRICT: { text: 'Chế độ ngoại tuyến nghiêm ngặt bật', todo: 'Tắt chế độ ngoại tuyến nghiêm ngặt trong Cài đặt rồi kiểm tra lại.' },
  },
  notStartedUnknown: {
    text: 'BaoCut không nhận kiểm tra này',
    todo: 'Kiểm tra lại sau. Nếu vẫn xảy ra, sao chép chi tiết kỹ thuật và gửi cho chúng tôi.',
  },
  detail: {
    code: (code) => `Mã ${code}`,
    model: (id, when) => `Mô hình ${id} · ${when}`,
    message: (message) => `Thông điệp ${message}`,
    passed: (when) => `Kiểm tra đạt · ${when}`,
  },
  noticeText: (what) => `Mô hình này không đạt kiểm tra trước: ${what}`,
  refUnreadable: (file) => ({
    text: `Không đọc được bản ghi “${file}”. Tệp có thể hỏng hoặc không phải âm thanh`,
    todo: 'Thử bản ghi khác hoặc nghe bằng bản ghi mẫu trước.',
  }),
  refUnknown: 'bản ghi',
  trySpeech: trySubject('tổng hợp', 'nghe thử', 'Đóng mô hình lớn hoặc ứng dụng tốn bộ nhớ khác rồi thử lại.'),
  tryImage: trySubject('vẽ', 'vẽ thử', 'Đóng mô hình lớn khác rồi thử lại hoặc giảm số bước.'),
};
