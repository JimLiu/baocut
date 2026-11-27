import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const vi: DownloaderSettingsMessages = {
  lead: 'Tải video từ liên kết dùng yt-dlp. Tải video, chép lời từ liên kết và Agent đều tải theo thiết lập ở đây.',
  toolGroup: 'Công cụ tải xuống',
  cookiesLead: 'Khi tải xuống sẽ dùng trạng thái đăng nhập trong trình duyệt, nên cả video cần đăng nhập mới xem được cũng tải được. Mặc định dùng mọi trình duyệt phát hiện được.',
  autoUpdate: "Tự động cập nhật yt-dlp",
  autoUpdateDesc:
    "Mỗi ngày kiểm tra một lần xem có bản ổn định mới không. Nếu có, bản do BaoCut tải về sẽ được thay sau khi đối chiếu mã kiểm tra; trước đó bạn vẫn tải bằng bản hiện tại. yt-dlp bạn tự cài không bị thay đổi.",
  autoUpdateChecked: (when: string, version: string) => `Lần kiểm tra gần nhất: ${when} · phiên bản mới nhất ${version}`,
};
