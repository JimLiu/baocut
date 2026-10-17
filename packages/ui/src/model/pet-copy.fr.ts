import type { PetMessages } from './pet-copy.ts';

export const fr: PetMessages = {
  title: 'Codex Pets',
  note: 'Planches de sprites à 8 colonnes · boucle au repos · suit la tête de lecture',
  peekNote: (count) => `${count} de la communauté`,
  categoryChips: 'Catégories d’animaux',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Personnages de jeux vidéo',
    'anime-characters': 'Personnages d’anime',
    animals: 'Animaux',
    'original-characters': 'Personnages originaux',
    mascots: 'Mascottes',
    others: 'Autres',
    memes: 'Mèmes',
    'fantasy-creatures': 'Créatures fantastiques',
    'human-avatars': 'Avatars humains',
    robots: 'Robots',
    'objects-props': 'Objets et accessoires',
  },
  noMatch: 'Aucun animal ne correspond',
  noMatchHint: 'Essayez un autre mot ou une autre catégorie',
  nonCommercial: 'Usage non commercial uniquement',
  communityNote:
    'Les animaux de la communauté viennent d’awesome-codex-pet et s’utilisent sous la licence indiquée par chaque auteur (le plus souvent CC BY-NC 4.0 ; en orange, usage non commercial uniquement). Le crédit est enregistré avec la ressource. Miniatures et planches de sprites sont téléchargées au besoin et conservées sur cet ordinateur.',
  hint: 'Un Codex Pet est le format d’animal de bureau de Codex : une planche de sprites WebP de cellules 192×208 sur 8 colonnes (9 lignes en v1, 11 en v2), un état par ligne. Sur le canevas, il joue en boucle la ligne de repos en suivant la tête de lecture. La planche est téléchargée la première fois que vous utilisez l’animal et conservée sur cet ordinateur.',
  addFailed: (message) => `Impossible d’ajouter l’animal : ${message}`,
};
