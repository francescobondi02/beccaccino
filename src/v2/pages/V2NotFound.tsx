import { useNavigate } from "react-router-dom";
import V2Panel from "@/v2/components/ui/V2Panel";
import V2Button from "@/v2/components/ui/V2Button";
import { v2Path } from "@/v2/lib/paths";

const V2NotFound = () => {
  const navigate = useNavigate();

  return (
    <V2Panel className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-bold tracking-tight">Pagina non trovata</h1>
      <p className="mt-2 text-sm text-[hsl(var(--becca-ink-soft))]">
        Questa pagina non esiste o è stata spostata.
      </p>
      <V2Button className="mt-5" onClick={() => navigate(v2Path.lobby())}>
        Torna alla lobby
      </V2Button>
    </V2Panel>
  );
};

export default V2NotFound;
