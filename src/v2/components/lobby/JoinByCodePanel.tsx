import { Hash } from "lucide-react";
import V2Panel from "@/v2/components/ui/V2Panel";
import V2Button from "@/v2/components/ui/V2Button";
import V2Field from "@/v2/components/ui/V2Field";

interface JoinByCodePanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  onSubmit: () => void;
}

const JoinByCodePanel = ({
  code,
  onCodeChange,
  onSubmit,
}: JoinByCodePanelProps) => (
  <V2Panel
    title="Entra con un codice"
    description="Hai ricevuto un invito? Inserisci il codice della stanza."
    icon={<Hash className="h-5 w-5" />}
    className="becca-anim-rise"
  >
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <V2Field
        label="Codice stanza"
        placeholder="ES. 4KJ2"
        value={code}
        maxLength={12}
        autoComplete="off"
        onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
        className="uppercase tracking-[0.2em]"
      />
      <V2Button type="submit" variant="secondary" className="sm:w-32">
        Entra
      </V2Button>
    </form>
  </V2Panel>
);

export default JoinByCodePanel;
