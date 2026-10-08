import { PromptField, PromptTokenField, PromptFieldToolbar } from '@react-spectrum/ai';
import { Button } from '@react-spectrum/s2';
import { usePromptValue } from '../use-prompt-value.ts';
import { IMAGE as M } from '../image-preview-copy.ts';
export function ImageEditPrompt({
  text,
  onText,
  onQueue,
  disabled,
}: {
  text: string;
  onText: (text: string) => void;
  onQueue: () => void;
  disabled: boolean;
}) {
  const [value, setValue] = usePromptValue(text, onText);
  return (
    <div
      className="bc-image-prompt"
      onKeyDownCapture={(e) => {
        if (!text && (e.key === 'Home' || e.key === 'End')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <PromptField value={value} onChange={setValue} size="S" variant="subtle" aiDisclaimer={<></>}>
        <PromptTokenField placeholder={M.editPrompt} />
        <PromptFieldToolbar>
          <span style={{ flex: 1 }} />
          <Button slot={null} size="S" variant="primary" isDisabled={disabled} onPress={onQueue}>
            {M.queue}
          </Button>
        </PromptFieldToolbar>
      </PromptField>
    </div>
  );
}
