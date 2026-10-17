import type { PetMessages } from './pet-copy.ts';

export const vi: PetMessages = {
  title: 'Codex Pets',
  note: 'Sprite sheet 8 cột · lặp trạng thái chờ · theo đầu phát',
  peekNote: (count) => `${count} cộng đồng`,
  categoryChips: 'Danh mục thú cưng',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Nhân vật game',
    'anime-characters': 'Nhân vật anime',
    animals: 'Động vật',
    'original-characters': 'Nhân vật nguyên bản',
    mascots: 'Linh vật',
    others: 'Khác',
    memes: 'Meme',
    'fantasy-creatures': 'Sinh vật kỳ ảo',
    'human-avatars': 'Ảnh đại diện người',
    robots: 'Robot',
    'objects-props': 'Đồ vật và đạo cụ',
  },
  noMatch: 'Không có thú cưng phù hợp',
  noMatchHint: 'Thử từ khác hoặc danh mục khác',
  nonCommercial: 'Chỉ dùng phi thương mại',
  communityNote:
    'Thú cưng cộng đồng lấy từ awesome-codex-pet và dùng theo giấy phép mỗi tác giả nêu (phần lớn là CC BY-NC 4.0; màu cam là chỉ dùng phi thương mại). Ghi công được lưu cùng tài nguyên. Ảnh thu nhỏ và sprite sheet được tải khi cần và giữ trên máy tính này.',
  hint: 'Codex Pet là định dạng thú cưng màn hình của Codex: một sprite sheet WebP gồm các ô 192×208 xếp 8 cột (v1 có 9 hàng, v2 có 11), mỗi hàng một trạng thái. Trên khung vẽ, nó phát lặp hàng trạng thái chờ theo đầu phát. Sprite sheet được tải ở lần dùng đầu tiên và giữ trên máy tính này.',
  addFailed: (message) => `Không thêm được thú cưng: ${message}`,
};
