import { useNavigate } from "react-router-dom";
import V2Panel from "@/v2/components/ui/V2Panel";
import V2Button from "@/v2/components/ui/V2Button";
import { v2Path } from "@/v2/lib/paths";

/** Temporary landing for V2 routes whose screen arrives in a later phase. */
const V2Placeholder = ({ title }: { title: string }) => {
  const navigate = useNavigate();

  return (
    <V2Panel className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-[hsl(var(--becca-ink-soft))]">
        Questa schermata della nuova interfaccia è in arrivo.
      </p>
      <V2Button className="mt-5" onClick={() => navigate(v2Path.lobby())}>
        Torna alla lobby
      </V2Button>
    </V2Panel>
  );
};

export default V2Placeholder;
