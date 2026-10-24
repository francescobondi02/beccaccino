import { ArrowRight, ArrowUpRight, Bot, Hash, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

interface LobbyActionsProps {
  roomCode: string;
  onRoomCodeChange: (roomCode: string) => void;
  onCreateRoom: () => void;
  onPractice: () => void;
  onJoinByCode: () => void;
}

export default function LobbyActions({
  roomCode,
  onRoomCodeChange,
  onCreateRoom,
  onPractice,
  onJoinByCode,
}: LobbyActionsProps) {
  return (
    <div className="arcade-lobby-actions">
      <button type="button" className="arcade-entry arcade-entry-create" onClick={onCreateRoom} data-testid="create-room-button">
        <span className="arcade-entry-top" aria-hidden="true"><Plus size={32} /><ArrowUpRight size={25} /></span>
        <span className="arcade-entry-copy"><strong>Crea una stanza.</strong><span>Chiama gli amici. Al tavolo ci pensi tu.</span></span>
        <span className="arcade-entry-link">Si gioca <ArrowRight size={19} aria-hidden="true" /></span>
      </button>
      <button type="button" className="arcade-entry arcade-entry-practice" onClick={onPractice} data-testid="practice-button">
        <span className="arcade-entry-top" aria-hidden="true"><Bot size={32} /><ArrowUpRight size={25} /></span>
        <span className="arcade-entry-copy"><strong>Scalda la mano.</strong><span>Fai pratica con un socio e due avversari bot.</span></span>
        <span className="arcade-entry-link">Allenati con i bot <ArrowRight size={19} aria-hidden="true" /></span>
      </button>
      <form className="arcade-entry arcade-entry-join" onSubmit={(event) => { event.preventDefault(); onJoinByCode(); }}>
        <span className="arcade-entry-top" aria-hidden="true"><Hash size={32} /><span>INVITO IN TASCA?</span></span>
        <div className="arcade-entry-copy"><label htmlFor="room-code" className="arcade-entry-title">Hai il codice?</label><span>Il tuo posto ti aspetta.</span></div>
        <div className="arcade-code-row">
          <Input
            id="room-code"
            aria-label="Codice stanza"
            placeholder="ABC123"
            value={roomCode}
            onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())}
            className="arcade-code-input"
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            data-testid="room-code-input"
          />
          <button type="submit" className="arcade-code-submit" aria-label="Entra con il codice" data-testid="join-by-code-button"><ArrowRight size={24} aria-hidden="true" /></button>
        </div>
      </form>
    </div>
  );
}
