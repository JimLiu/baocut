import type { PetMessages } from './pet-copy.ts';

export const ja: PetMessages = {
  title: 'Codex Pets',
  note: '8 列のスプライトシート · 待機ループ · 再生ヘッドに追従',
  peekNote: (count) => `コミュニティ ${count}`,
  categoryChips: 'ペットのカテゴリ',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'ゲームキャラクター',
    'anime-characters': 'アニメキャラクター',
    animals: '動物',
    'original-characters': 'オリジナルキャラクター',
    mascots: 'マスコット',
    others: 'その他',
    memes: 'ミーム',
    'fantasy-creatures': 'ファンタジー生物',
    'human-avatars': '人物アバター',
    robots: 'ロボット',
    'objects-props': '小物・道具',
  },
  noMatch: '一致するペットはありません',
  noMatchHint: '別の言葉やカテゴリで試してください',
  nonCommercial: '非商用利用のみ',
  communityNote:
    'コミュニティのペットは awesome-codex-pet のもので、それぞれ作者が示したライセンスで使います（多くは CC BY-NC 4.0、オレンジは非商用利用のみ）。クレジットは素材と一緒に保存されます。サムネイルとスプライトシートは必要なときにダウンロードし、このコンピュータに保存します。',
  hint: 'Codex Pet は Codex デスクトップ版のデスクトップペットの形式です。192×208 のセルが 8 列並んだ WebP のスプライトシート（v1 は 9 行、v2 は 11 行）で、1 行が 1 つの状態です。キャンバスでは待機の行をループ再生し、再生ヘッドに追従します。スプライトシートは初めて使うときにダウンロードし、このコンピュータに保存します。',
  addFailed: (message) => `ペットを追加できませんでした：${message}`,
};
