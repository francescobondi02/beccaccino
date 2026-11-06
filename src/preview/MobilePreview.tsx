import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bot, Check, CircleHelp, Hash, LogIn, Maximize2, Plus, RotateCw, Trophy, Users, Zap } from "lucide-react";
import ArcadeRules from "@/components/lobby/ArcadeRules";
import LandingCardArtwork from "@/components/lobby/LandingCardArtwork";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { canEnterGameFullscreen, enterGameFullscreen } from "@/lib/fullscreen";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import PreviewGameTable from "./PreviewGameTable";
import MobilePages from "./MobilePages";
import "./mobile-preview.css";

const PORTRAIT_TOUCH = "(pointer: coarse) and (orientation: portrait)";

function subscribeToOrientation(onChange: () => void) {
  const media = window.matchMedia(PORTRAIT_TOUCH);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export default function MobilePreview() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const view = pathname.slice("/preview/mobile".length).replace(/^\/|\/$/g, "") || "home";
  const portrait = useSyncExternalStore(subscribeToOrientation, () => window.matchMedia(PORTRAIT_TOUCH).matches);
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<"friends" | "practice">("friends");
  const [joining, setJoining] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [roomCode, setRoomCode] = useState("BECCA1");
  const [team, setTeam] = useState(0);
  const [botTier, setBotTier] = useState("");
  const [ready, setReady] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [username, setUsername] = useState<string | null>("Alex");
  const playerName = username ?? "Ospite";

  useEffect(() => {
    document.querySelector<HTMLElement>(".mobile-preview h1, .mobile-table-preview h1")?.focus();
  }, [pathname]);

  const home = () => {
    setJoining(false);
    navigate("/preview/mobile");
  };
  const openRoom = (code: string) => {
    setRoomCode(code);
    setTeam(0);
    setBotTier("");
    setReady(false);
    setJoining(false);
    navigate("/preview/mobile/room");
  };
  const openTable = () => navigate("/preview/mobile/table");
  const teams = team === 0
    ? [[playerName, "Giulia"], ["Luca", null]]
    : [["Giulia", null], ["Luca", playerName]];

  return (
    <>
      {view === "table" ? (
        <PreviewGameTable
          mobile
          localUsername={playerName}
          room={mode === "practice" ? "Allenamento demo" : `Stanza ${roomCode}`}
          onBack={home}
          onFinish={() => navigate("/preview/mobile/result")}
          effectsEnabled={effectsEnabled}
          motionStopped={reducedMotion || !effectsEnabled}
          onToggleEffects={() => setEffectsEnabled((enabled) => !enabled)}
        />
      ) : (
        <div className="mobile-preview">
          <header className="mobile-preview-header">
            <button type="button" className="mobile-brand" onClick={home} aria-label="BECCA, torna alla home mobile">
              <span aria-hidden="true"><Zap size={24} fill="currentColor" /></span>
              BECCA
            </button>
            <span className="mobile-preview-label">ANTEPRIMA <span>· DATI DEMO</span></span>
            <div className="mobile-header-tools">
              <Button asChild variant="ghost" size="icon">
                <Link to="/preview/mobile/lobby" aria-label="Tavoli aperti" aria-current={view === "lobby" ? "page" : undefined}><Users size={21} /></Link>
              </Button>
              <Button asChild variant="ghost" size="icon">
                <Link to="/preview/mobile/leaderboard" aria-label="Classifica" aria-current={view === "leaderboard" ? "page" : undefined}><Trophy size={21} /></Link>
              </Button>
              {canEnterGameFullscreen() && (
                <Button variant="ghost" size="icon" aria-label="Schermo intero" onClick={() => void enterGameFullscreen()}>
                  <Maximize2 size={20} />
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Come si gioca" onClick={(event) => {
                event.currentTarget.focus();
                setRulesOpen(true);
              }}>
                <CircleHelp size={22} />
              </Button>
              <Link className="mobile-profile" to={`/preview/mobile/${username ? "profile" : "account"}`} aria-label={username ? `Profilo demo di ${username}` : "Accedi alla demo"}>
                {username ? username.slice(0, 2).toUpperCase() : <LogIn size={20} />}
              </Link>
            </div>
          </header>

          {view === "home" ? (
            <main key="home" className="mobile-preview-main mobile-home">
              <section className="mobile-lobby-art" aria-labelledby="mobile-home-title">
                <span className="mobile-kicker">VECCHIA SCUOLA. NUOVA ENERGIA.</span>
                <h1 id="mobile-home-title" tabIndex={-1}><span>LA PRESA</span><em>È TUA.</em></h1>
                <div className="mobile-card-fan" aria-hidden="true">
                  <LandingCardArtwork card="tre_spade" className="mobile-art-card" />
                  <LandingCardArtwork card="asso_denari" className="mobile-art-card" />
                  <LandingCardArtwork card="re_coppe" className="mobile-art-card" />
                </div>
              </section>

              <section className="mobile-play-panel" aria-label="Scegli come giocare">
                {joining ? (
                  <>
                    <button className="mobile-text-action" type="button" onClick={() => setJoining(false)}>
                      <ArrowLeft size={18} /> Indietro
                    </button>
                    <h2>Ti hanno tenuto<br /><em>un posto.</em></h2>
                    <form className="mobile-join-form" onSubmit={(event) => {
                      event.preventDefault();
                      openRoom(inviteCode);
                    }}>
                      <label htmlFor="mobile-room-code">Codice stanza</label>
                      <Input
                        id="mobile-room-code"
                        autoFocus
                        required
                        pattern="[A-Z0-9]{6}"
                        title="Inserisci le 6 lettere o cifre del codice stanza"
                        placeholder="ABC123"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={6}
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                      />
                      <Button type="submit">Entra nella stanza <ArrowRight size={20} /></Button>
                    </form>
                  </>
                ) : (
                  <>
                    <div className="mobile-panel-heading">
                      <span className="mobile-kicker">IL PROSSIMO GIRO È TUO</span>
                      <h2>Fatti un <em>Becca.</em></h2>
                    </div>
                    <div className="mobile-mode-picker" role="group" aria-label="Modalità di gioco">
                      <button type="button" aria-pressed={mode === "friends"} onClick={() => setMode("friends")}>
                        <Users size={26} aria-hidden="true" />
                        <strong>Con amici</strong>
                        <span>Il tuo socio ti aspetta.</span>
                      </button>
                      <button type="button" aria-pressed={mode === "practice"} onClick={() => setMode("practice")}>
                        <Bot size={26} aria-hidden="true" />
                        <strong>Allenamento</strong>
                        <span>Tu e tre bot. Si impara.</span>
                      </button>
                    </div>
                    <div className="mobile-home-actions">
                      <Button onClick={() => mode === "friends" ? openRoom("BECCA1") : navigate("/preview/mobile/practice")}>
                        {mode === "friends" ? <Plus size={20} /> : <Bot size={20} />}
                        {mode === "friends" ? "Crea stanza" : "Prova contro i bot"}
                        <ArrowRight size={20} />
                      </Button>
                      {mode === "friends" ? (
                        <Button variant="outline" onClick={() => setJoining(true)}><Hash size={18} /> Ho un codice</Button>
                      ) : (
                        <p className="mobile-practice-note">Tavolo dimostrativo.<br />Nessun effetto sulla classifica.</p>
                      )}
                    </div>
                  </>
                )}
              </section>
            </main>
          ) : view === "room" ? (
            <main key="room" className="mobile-preview-main mobile-room">
              <div className="mobile-room-heading">
                <button type="button" className="mobile-text-action" onClick={home}><ArrowLeft size={18} /> Esci</button>
                <h1 tabIndex={-1}>CHIAMA IL <em>SOCIO.</em></h1>
                <span className="mobile-room-code"><Hash size={16} aria-hidden="true" />{roomCode}</span>
              </div>
              <div className="mobile-teams" role="group" aria-label="Scegli la tua squadra">
                {teams.map((members, index) => (
                  <button
                    key={index}
                    type="button"
                    className="mobile-team"
                    aria-label={`Scegli squadra ${index + 1}`}
                    aria-pressed={team === index}
                    onClick={() => {
                      if (team === index) return;
                      setTeam(index);
                      setReady(false);
                    }}
                  >
                    <span className="mobile-team-heading">
                      <strong>Squadra {index + 1}</strong>
                      <span>{team === index ? "LA TUA" : "SCEGLI"} {team === index && <Check size={14} />}</span>
                    </span>
                    {members.map((name, seat) => {
                      const isLocal = index === team && seat === team;
                      return (
                        <span className="mobile-room-player" key={seat}>
                          <span className="mobile-player-avatar" aria-hidden="true">
                            {name ? name[0] : botTier ? <Bot size={22} /> : <Plus size={22} />}
                          </span>
                          <span>
                            <strong>{name ?? (botTier ? "Bot alla partenza" : "Posto libero")}{isLocal && " (tu)"}</strong>
                            <span>{isLocal ? ready ? "Pronto" : "Non pronto" : name ? "Pronto · demo" : botTier ? "Posto aperto anche agli amici" : "Manca solo un amico"}</span>
                          </span>
                          {(name && (!isLocal || ready)) && <Check className="mobile-player-ready" size={18} aria-label="Pronto" />}
                        </span>
                      );
                    })}
                  </button>
                ))}
              </div>
              <div className="mobile-room-footer">
                <label className="mobile-bot-picker">
                  Completa il posto libero
                  <select value={botTier} onChange={(event) => { setBotTier(event.target.value); setReady(false); }}>
                    <option value="">Aspetta un amico</option>
                    <option value="facile">Bot facile</option>
                    <option value="medio">Bot medio</option>
                    <option value="forte">Bot forte</option>
                    <option value="esperto">Bot esperto</option>
                  </select>
                </label>
                <div className="mobile-ready-actions">
                  <p className="mobile-ready-status" role="status">
                    {ready ? botTier ? "Tutti pronti. Prova il tavolo demo." : "Sei pronto. Un posto è ancora libero." : "Scegli squadra e mettiti pronto."}
                    <span>Cambiare squadra o bot azzera il tuo pronto.</span>
                  </p>
                  <Button onClick={() => ready && botTier ? openTable() : setReady(!ready)}>
                    <Check size={20} />
                    {ready && botTier ? "Entra nel tavolo demo" : ready ? "Non sono pronto" : "Sono pronto"}
                  </Button>
                </div>
              </div>
            </main>
          ) : (
            <MobilePages
              key={view}
              page={view}
              username={username}
              onAccount={setUsername}
              onOpenRoom={(code) => { setMode("friends"); openRoom(code); }}
              onStartPractice={() => { setMode("practice"); openTable(); }}
            />
          )}
        </div>
      )}

      <ArcadeRules open={rulesOpen} onOpenChange={setRulesOpen} />
      <Dialog open={portrait} onOpenChange={() => {}}>
        <DialogContent
          className="mobile-orientation-dialog [&>button]:hidden"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <RotateCw className="arcade-rotate-icon" aria-hidden="true" />
          <DialogHeader className="text-center sm:text-center">
            <DialogTitle>Gira il telefono</DialogTitle>
            <DialogDescription>BECCA si gioca in orizzontale. Ruota il telefono per continuare.</DialogDescription>
          </DialogHeader>
          {canEnterGameFullscreen() && (
            <div><Button onClick={() => void enterGameFullscreen()}><Maximize2 size={18} /> Apri a schermo intero</Button></div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
