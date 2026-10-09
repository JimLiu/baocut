import type { StageToolbarMessages } from './stage-toolbar-copy.ts';

export const fr: StageToolbarMessages = {
  toolLabel: {
    color: 'Couleur', font: 'Police', size: 'Taille', 'text-styles': 'Styles', animation: 'Animation', transitions: 'Transitions',
    volume: 'Volume', speed: 'Vitesse', adjust: 'Ajuster', border: 'Contour', 'fill-list': 'Couleurs de remplissage',
    'progress-colors': 'Couleur', 'progress-picker': 'Styles', 'wave-colors': 'Couleur', 'wave-picker': 'Styles',
    'counter-mode': 'Mode', 'volume-levels': 'Niveaux de volume', properties: 'Propriétés', copy: 'Dupliquer', arrange: 'Ordre',
    'save-to-brand-kit': 'Enregistrer dans le kit de marque', 'adjust-timing': 'Ajuster le minutage', delete: 'Supprimer',
    bold: 'Gras', italic: 'Italique', 'align-left': 'Aligner à gauche', 'align-center': 'Centrer', 'align-right': 'Aligner à droite',
    'line-height': 'Interligne', 'letter-spacing': 'Espacement des lettres', 'flip-vertical': 'Retourner verticalement',
    'flip-horizontal': 'Retourner horizontalement', 'fit-canvas': 'Adapter au canevas', 'fill-canvas': 'Remplir le canevas',
    opacity: 'Opacité', 'round-corners': 'Rayon des coins', filters: 'Filtres', effects: 'Effets', 'crop-video': 'Recadrage intelligent',
    'replace-video': 'Remplacer la vidéo', 'replace-image': 'Remplacer l’image', 'detach-audio': 'Détacher l’audio',
    'sub-scope': 'Ligne à modifier', 'sub-edit': 'Modifier', 'sub-style': 'Styles', 'sub-animation': 'Animation', case: 'Casse', 'hide-subs': 'Masquer les sous-titres',
  },
  offReason: {
    animation: 'Le format vidéo ne prend pas encore en charge les animations : aucun champ ni aucune opération de modification ne permet de les enregistrer.',
    brand: 'Le kit de marque ne peut pas encore stocker de clips.',
    roundCorners: 'Le rayon des coins des vidéos et des images ne peut pas encore être enregistré (l’opération d’apparence n’accepte pas de rayon).',
    filters: 'Les filtres (LUT) sont un nom réservé dans le format vidéo et sont refusés à l’écriture.',
    crop: 'Le recadrage intelligent nécessite un modèle et n’a pas encore de point d’entrée. Bientôt disponible.',
    replace: 'Aucune opération ne permet encore de remplacer le média d’un clip.',
    detach: 'Le détachement de l’audio n’est pas encore intégré : il faut ajouter un clip audio et couper le son de la vidéo dans la même modification.',
    speed: 'Ce clip n’est pas lu à vitesse constante ; sa vitesse ne peut donc pas être modifiée ici.',
    sound: 'Ce clip n’a pas de son.',
    captionAnimation: 'Le format vidéo ne prend pas encore en charge les animations de sous-titres : un style de sous-titres n’a aucun champ pour elles.',
    captionDefaultStyle: 'Ces sous-titres utilisent encore le style par défaut. Modifiez d’abord un réglage, puis enregistrez-le dans le kit de marque.',
    brandText: 'Le kit de marque n’a pas encore de section pour les styles de texte.',
  },
  arrange: { front: 'Mettre au premier plan', forward: 'Avancer', backward: 'Reculer', back: 'Mettre à l’arrière-plan', label: 'Modifier l’ordre de superposition' },
  subtitleBar: 'Barre d’outils des sous-titres',
  textStyleLocked: (schema) => `Ce texte utilise le format de style ${schema} et ne peut pas encore être modifié ici.`,
};
