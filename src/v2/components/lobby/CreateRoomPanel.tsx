import { Bot, Plus } from "lucide-react";
import V2Panel from "@/v2/components/ui/V2Panel";
import V2Button from "@/v2/components/ui/V2Button";

interface CreateRoomPanelProps {
  onCreate: () => void;
  onPractice: () => void;
  creating: boolean;
}

const CreateRoomPanel = ({
  onCreate,
  onPractice,
  creating,
}: CreateRoomPanelProps) => (
  <V2Panel
    title="Nuova partita"
    description="Apri un tavolo e invita tre giocatori, oppure allenati contro i bot."
    icon={<Plus className="h-5 w-5" />}
    className="becca-anim-rise"
  >
    <div className="flex flex-col gap-2 sm:flex-row">
      <V2Button className="flex-1" onClick={onCreate} disabled={creating}>
        <Plus className="h-4 w-4" />
        {creating ? "Creazione..." : "Crea stanza"}
      </V2Button>
      <V2Button variant="secondary" className="flex-1" onClick={onPractice}>
        <Bot className="h-4 w-4" />
        Allenamento
      </V2Button>
    </div>
    <p className="mt-3 text-xs text-[hsl(var(--becca-ink-soft))]">
      La pratica non influisce sulla classifica.
    </p>
  </V2Panel>
);

export default CreateRoomPanel;
