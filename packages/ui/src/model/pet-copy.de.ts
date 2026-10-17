import type { PetMessages } from './pet-copy.ts';

export const de: PetMessages = {
  title: 'Codex Pets',
  note: 'Sprite-Sheets mit 8 Spalten · Ruhe-Schleife · folgt dem Abspielkopf',
  peekNote: (count) => `${count} aus der Community`,
  categoryChips: 'Haustier-Kategorien',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Spielfiguren',
    'anime-characters': 'Anime-Figuren',
    animals: 'Tiere',
    'original-characters': 'Eigene Figuren',
    mascots: 'Maskottchen',
    others: 'Sonstiges',
    memes: 'Memes',
    'fantasy-creatures': 'Fantasiewesen',
    'human-avatars': 'Personen-Avatare',
    robots: 'Roboter',
    'objects-props': 'Gegenstände',
  },
  noMatch: 'Keine passenden Haustiere',
  noMatchHint: 'Versuche ein anderes Wort oder eine andere Kategorie',
  nonCommercial: 'Nur nichtkommerzielle Nutzung',
  communityNote:
    'Community-Haustiere stammen aus awesome-codex-pet und werden unter der jeweils vom Autor angegebenen Lizenz genutzt (meist CC BY-NC 4.0; orange heißt nur nichtkommerzielle Nutzung). Die Namensnennung wird mit dem Asset gespeichert. Vorschaubilder und Sprite-Sheets werden bei Bedarf heruntergeladen und auf diesem Computer behalten.',
  hint: 'Ein Codex Pet ist das Desktop-Haustier-Format von Codex: ein WebP-Sprite-Sheet mit 192×208-Zellen in 8 Spalten (9 Zeilen in v1, 11 in v2), ein Zustand pro Zeile. Auf der Leinwand spielt es die Ruhezeile als Schleife, die dem Abspielkopf folgt. Das Sprite-Sheet wird beim ersten Gebrauch heruntergeladen und auf diesem Computer behalten.',
  addFailed: (message) => `Das Haustier konnte nicht hinzugefügt werden: ${message}`,
};
