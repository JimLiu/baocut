import type { ToolOutputsMessages } from './tool-outputs.ts';

export const pl: ToolOutputsMessages = {
  actionLabel: { 'open-movie': "Otwórz w edytorze", 'new-movie': "Nowe wideo z tego" },
  blockTextOnly: "Utworzenie nowego wideo z transkrypcji i napisów wymaga pliku wideo lub audio; tutaj nie jest to jeszcze możliwe",
  blockTrashed: "Najpierw przywróć ten element z kosza",
  blockGenerating: "Trwa generowanie; dostępne po ukończeniu",
  blockMissing: "Nie można znaleźć pliku tego wyniku na tym komputerze",
  handover: {
    subtitle: "Przetłumacz te napisy na inny język, zachowując kody czasowe.",
    document: "Napisz podsumowanie tej transkrypcji.",
    audio: "Utwórz wideo z tym audio.",
    image: "Utwórz wideo z tym obrazem jako okładką.",
    'video-file': "Dodaj napisy do tego wideo.",
    export: "Dodaj napisy do tego wideo.",
    video: "Kontynuuj edycję tego wideo.",
  },
  handoverDefault: "Kontynuuj pracę nad tym wynikiem.",
};
