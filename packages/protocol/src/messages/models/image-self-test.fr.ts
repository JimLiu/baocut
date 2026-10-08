import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const fr: ModelsImageSelfTestMessages = {
  notPng: "Pas un fichier PNG",
  chunkTruncated: (p: { type: string }) => `La version de ${p.type} : bloc tronqué`,
  missingIhdr: "Le bloc IHDR manque",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Format de pixels non pris en charge (profondeur ${p.depth}, type de couleur ${p.color}, entrelacement ${p.interlace})`,
  zeroSize: "La largeur ou la hauteur est 0",
  missingIdat: "Le bloc IDAT manque",
  inflateFailed: "Impossible de décompresser les données de pixels",
  pixelDataShort: "Données de pixels insuffisantes",
  unknownFilter: "Type de filtre de ligne inconnu",
  undecodable: (p: { problem: string }) => `Le résultat ne peut pas être décodé : ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `La taille ${p.width}×${p.height} n’est pas celle demandée : ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `L’image est presque d’une couleur uniforme (seulement ${p.distinct} couleurs)`,
};
