import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export default function ArcadeRules({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trigger = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="club-dialog-backdrop" />
        <Dialog.Content className="club-dialog"
          onOpenAutoFocus={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
          <span className="club-eyebrow">SI IMPARA GIOCANDO</span>
          <Dialog.Title>Tre dritte.<br /><em>Poi si gioca.</em></Dialog.Title>
          <Dialog.Description>Quattro giocatori, due squadre e un mazzo italiano da 40 carte. Il resto si impara al tavolo.</Dialog.Description>
          <ol>
            <li><span>01</span><div><strong>Siediti di fronte al tuo socio.</strong><p>Giocate insieme, contro gli altri due. Si distribuiscono dieci carte a testa.</p></div></li>
            <li><span>02</span><div><strong>Segui il seme, se puoi.</strong><p>La briscola batte gli altri semi. Tra le carte dello stesso seme, il tre viene prima del due e dell'asso.</p></div></li>
            <li><span>03</span><div><strong>Fai parlare le carte.</strong><p>Chi apre la presa può dichiarare Striscio, Busso o Volo. I segnali sono visibili a tutti, anche agli avversari.</p></div></li>
          </ol>
          <p className="club-dialog-note">Una partita, tante smazzate. L'ultima presa di ogni smazzata vale un punto in più.</p>
          <Dialog.Close className="club-icon-button club-dialog-close" aria-label="Chiudi le regole"><X size={20} /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
