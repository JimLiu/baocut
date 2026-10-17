import type { PetMessages } from './pet-copy.ts';

export const es: PetMessages = {
  title: 'Codex Pets',
  note: 'Hojas de sprites de 8 columnas · bucle en reposo · sigue el cabezal',
  peekNote: (count) => `${count} de la comunidad`,
  categoryChips: 'Categorías de mascotas',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Personajes de videojuegos',
    'anime-characters': 'Personajes de anime',
    animals: 'Animales',
    'original-characters': 'Personajes originales',
    mascots: 'Mascotas de marca',
    others: 'Otros',
    memes: 'Memes',
    'fantasy-creatures': 'Criaturas fantásticas',
    'human-avatars': 'Avatares de personas',
    robots: 'Robots',
    'objects-props': 'Objetos y accesorios',
  },
  noMatch: 'No hay mascotas que coincidan',
  noMatchHint: 'Prueba con otra palabra u otra categoría',
  nonCommercial: 'Solo uso no comercial',
  communityNote:
    'Las mascotas de la comunidad vienen de awesome-codex-pet y se usan con la licencia que indica cada autor (casi todas CC BY-NC 4.0; en naranja, solo uso no comercial). El crédito se guarda con el recurso. Las miniaturas y las hojas de sprites se descargan cuando hacen falta y se guardan en este equipo.',
  hint: 'Una Codex Pet es el formato de mascota de escritorio de Codex: una hoja de sprites WebP con celdas de 192×208 en 8 columnas (9 filas en v1, 11 en v2), un estado por fila. En el lienzo reproduce en bucle la fila de reposo, siguiendo el cabezal. La hoja se descarga la primera vez que usas la mascota y se guarda en este equipo.',
  addFailed: (message) => `No se pudo añadir la mascota: ${message}`,
};
