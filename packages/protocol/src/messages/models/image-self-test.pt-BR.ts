import type { ModelsImageSelfTestMessages } from './image-self-test.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: ModelsImageSelfTestMessages = {
  notPng: "Não é um arquivo PNG",
  chunkTruncated: (p: { type: string }) => `${p.type} tem um bloco truncado`,
  missingIhdr: "O bloco IHDR está ausente",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Formato de pixel não suportado (profundidade de bits ${p.depth}, tipo de cor ${p.color}, entrelaçamento ${p.interlace})`,
  zeroSize: "A largura ou altura é 0",
  missingIdat: "O bloco IDAT está ausente",
  inflateFailed: "Não foi possível descompactar os dados dos pixels",
  pixelDataShort: "Dados de pixels insuficientes",
  unknownFilter: "Tipo de filtro de linha desconhecido",
  undecodable: (p: { problem: string }) => `Não é possível decodificar a saída: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `O tamanho ${p.width}×${p.height} não corresponde ao solicitado ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `A imagem é quase uma única cor sólida (apenas ${pluralForm('pt-BR', p.distinct, { one: `${p.distinct} cor`, other: `${p.distinct} cores` })})`,
};
