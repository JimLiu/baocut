import type { StageToolbarMessages } from './stage-toolbar-copy.ts';

export const ptBR: StageToolbarMessages = {
  toolLabel: {
    color: 'Cor', font: 'Fonte', size: 'Tamanho', 'text-styles': 'Estilos', animation: 'Animação', transitions: 'Transições', volume: 'Volume', speed: 'Velocidade', adjust: 'Ajustar', border: 'Contorno', 'fill-list': 'Cores de preenchimento', 'progress-colors': 'Cor', 'progress-picker': 'Estilos', 'wave-colors': 'Cor', 'wave-picker': 'Estilos', 'counter-mode': 'Modo', 'volume-levels': 'Níveis de volume', properties: 'Propriedades', copy: 'Duplicar', arrange: 'Ordem', 'save-to-brand-kit': 'Salvar no kit de marca', 'adjust-timing': 'Ajustar tempo', delete: 'Excluir', bold: 'Negrito', italic: 'Itálico', 'align-left': 'Alinhar à esquerda', 'align-center': 'Centralizar', 'align-right': 'Alinhar à direita', 'line-height': 'Altura da linha', 'letter-spacing': 'Espaçamento entre letras', 'flip-vertical': 'Inverter verticalmente', 'flip-horizontal': 'Inverter horizontalmente', 'fit-canvas': 'Ajustar à tela', 'fill-canvas': 'Preencher tela', opacity: 'Opacidade', 'round-corners': 'Raio dos cantos', filters: 'Filtros', effects: 'Efeitos', 'crop-video': 'Recorte inteligente', 'replace-video': 'Substituir vídeo', 'replace-image': 'Substituir imagem', 'detach-audio': 'Desvincular áudio',
  },
  offReason: {
    animation: 'O formato de vídeo ainda não tem animações: não há campo para gravar nem operação de edição.',
    brand: 'O kit de marca ainda não pode armazenar clipes.',
    roundCorners: 'Ainda não é possível gravar o raio dos cantos de vídeos e imagens (a operação de aparência não aceita raio).',
    filters: 'Filtros (LUT) são um nome reservado no formato de vídeo e são rejeitados ao gravar.',
    crop: 'O recorte inteligente precisa de um modelo e ainda não tem ponto de entrada. Em breve.',
    replace: 'Ainda não há operação para trocar a mídia de um clipe.',
    detach: 'Desvincular áudio ainda não foi conectado: é preciso adicionar um clipe de áudio e silenciar o vídeo na mesma edição.',
    speed: 'Este clipe não reproduz em velocidade constante, então a velocidade não pode ser alterada aqui.',
    sound: 'Este clipe não tem som.',
  },
  arrange: { front: 'Trazer para a frente', forward: 'Avançar', backward: 'Recuar', back: 'Enviar para trás', label: 'Alterar ordem de sobreposição' },
  textStyleLocked: (schema: string) => `Este texto usa o formato de estilo ${schema} e ainda não pode ser editado aqui.`,
};
