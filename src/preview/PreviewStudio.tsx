import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check,
  CircleHelp, Flag, Pause, Play, RotateCcw, Sparkles, Zap,
} from "lucide-react";
import ArcadeHero from "@/components/lobby/ArcadeHero";
import ArcadeRules from "@/components/lobby/ArcadeRules";
import { useReducedMotion } from "@/v2/hooks/useReducedMotion";
import "@/styles/arcade.css";

const cards = [
  { value: "asso", suit: "denari", label: "Asso di denari" },
  { value: "tre", suit: "spade", label: "Tre di spade" },
  { value: "re", suit: "coppe", label: "Re di coppe" },
  { value: "cavallo", suit: "bastoni", label: "Cavallo di bastoni" },
  { value: "due", suit: "denari", label: "Due di denari" },
];

const rooms = [
  { name: "La gang del mazzo", initials: ["G", "L", "M"], tone: "sage", type: "Porta il socio. Lascia fuori la noia.", level: "CHILL", seats: 3 },
  { name: "Ancora una, poi basta.", initials: ["F", "A"], tone: "peach", type: "Spoiler: non sarà l'ultima.", level: "PER TUTTI", seats: 2 },
  { name: "Zero pietà, solo prese.", initials: ["S", "R", "E"], tone: "lilac", type: "Il tre non si gioca da solo.", level: "HARD MODE", seats: 3 },
];

function CardImage({ card, className = "" }: { card: typeof cards[number]; className?: string }) {
  return <img className={`club-card ${className}`} src={`/images/cards/${card.value}_${card.suit}.png`} alt={card.label} width={126} height={200} draggable={false} />;
}

export default function PreviewStudio() {
  const [view, setView] = useState<"club" | "table">("club");
  const [room, setRoom] = useState(rooms[0].name);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [played, setPlayed] = useState<number[]>([]);
  const [signal, setSignal] = useState("Niente");
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const reduceMotion = useReducedMotion();
  const motionStopped = reduceMotion || !effectsEnabled;
  const heading = useRef<HTMLHeadingElement>(null);
  const lastCard = played.length ? cards[played[played.length - 1]] : null;

  const openTable = (name = rooms[0].name) => {
    setRoom(name);
    setPlayed([]);
    setSignal("Niente");
    setView("table");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => heading.current?.focus());
  };

  const openClub = () => {
    setView("club");
    requestAnimationFrame(() => document.getElementById("club-title")?.focus());
  };

  return (
    <MotionConfig reducedMotion={motionStopped ? "always" : "user"}>
      <div className="club-preview" lang="it" data-motion={motionStopped ? "off" : "on"}>
        <a className="club-skip" href="#club-content">Vai al contenuto</a>
        <div className="club-preview-bar">
          <span><Zap size={12} /> BECCA PLAYGROUND <span className="club-bar-separator">/</span> TAKE 02</span>
          <span>Concept interattivo · dati demo <a href="/">Versione attuale <ArrowUpRight size={12} /></a></span>
        </div>

        <header className="club-header">
          <button className="club-brand" onClick={openClub} aria-label="BECCA, torna alla lobby">
            <span className="club-brand-symbol" aria-hidden="true"><Zap size={31} fill="currentColor" /></span>
            <span>BECCA<span className="club-brand-caption">OLD SCHOOL. NEW RULE OF COOL.</span></span>
          </button>
          <nav aria-label="Navigazione anteprima">
            <button aria-current={view === "club" ? "page" : undefined} onClick={openClub}>La lobby</button>
            <button aria-current={view === "table" ? "page" : undefined} onClick={() => openTable()}>Tavolo demo</button>
            <button onClick={() => setRulesOpen(true)}>Le regole <ArrowUpRight size={13} /></button>
          </nav>
          <div className="club-header-actions">
            <button className="club-motion-toggle" aria-pressed={effectsEnabled} onClick={() => setEffectsEnabled((enabled) => !enabled)}>
              {effectsEnabled ? <Pause size={14} /> : <Play size={14} />}
              {effectsEnabled ? "Pausa effetti" : "Attiva effetti"}
            </button>
            <button className="club-button club-button-small" onClick={() => openTable()}>LET'S PLAY <ArrowUpRight size={17} /></button>
          </div>
        </header>

        <main id="club-content" className="club-main" tabIndex={-1}>
          {view === "club" ? (
            <>
              <ArcadeHero onPlay={() => openTable()} onRules={() => setRulesOpen(true)} motionStopped={motionStopped} />

              <section className="club-lounge" aria-labelledby="club-lounge-title">
                <div className="club-section-heading">
                  <div><span className="club-eyebrow"><Zap size={14} /> SCEGLI LA TUA ARENA</span><h2 id="club-lounge-title">TROVA LA TUA <em>GANG.</em></h2></div>
                  <span className="club-sample-label"><span className="club-status-dot" /> Tavoli dimostrativi</span>
                </div>
                <div className="club-room-grid">
                  {rooms.map((item, index) => (
                    <article className={`club-room club-room-${item.tone}`} key={item.name}>
                      <div className="club-room-top"><span className="club-eyebrow">TAVOLO 0{index + 1}</span><span className="club-room-level">{item.level}</span></div>
                      <div className="club-room-illustration" aria-hidden="true">
                        <span className="club-mini-table" />
                        <span className="club-room-card club-room-card-first"><CardImage card={cards[index]} /></span>
                        <span className="club-room-card club-room-card-second"><CardImage card={cards[index + 1]} /></span>
                      </div>
                      <h3>{item.name}</h3><p>{item.type}</p>
                      <div className="club-room-bottom">
                        <div><span className="club-people">{item.initials.map((initial) => <i key={initial}>{initial}</i>)}<i className="club-empty-seat">+</i></span><span className="club-seat-count">{item.seats}/4 posti</span></div>
                        <button className="club-icon-button" onClick={() => openTable(item.name)} aria-label={`Prova ${item.name}`}><ArrowUpRight size={22} /></button>
                      </div>
                    </article>
                  ))}
                  <article className="club-invite">
                    <Sparkles size={28} strokeWidth={1.2} />
                    <span className="club-eyebrow">FIRST TIME?</span>
                    <h3>NIENTE PANICO.<br /><em>BUTTA<br />UNA CARTA.</em></h3>
                    <p>Nessuno nasce con il tre in mano.<br />Fai un giro di prova.</p>
                    <button className="club-text-button" onClick={() => openTable("La tua prima mano")}>Prova il tavolo <ArrowRight size={19} /></button>
                  </article>
                </div>
              </section>

              <section className="club-bottom-note">
                <span className="club-brand-symbol" aria-hidden="true"><Zap size={38} fill="currentColor" /></span>
                <p>ESCI DALLA CHAT.<br /><em>ENTRA IN PARTITA.</em></p>
                <button className="club-text-button" onClick={() => openTable()}>IL PROSSIMO GIRO È TUO <ArrowUpRight size={22} /></button>
              </section>
            </>
          ) : (
            <section className="club-game" aria-labelledby="club-table-title">
              <div className="club-game-heading">
                <div><button className="club-back" onClick={openClub}><ArrowLeft size={15} /> Tutti i tavoli</button><h1 id="club-table-title" ref={heading} tabIndex={-1}>{room}</h1></div>
                <span className="club-sample-label"><span className="club-status-dot" /> Tavolo demo · nessuna partita reale</span>
              </div>
              <div className="club-game-layout">
                <div className="club-game-board">
                  <div className="club-board-topline"><span>BECCACCINO <span> / </span> MANO DIMOSTRATIVA</span><span><Flag size={13} /> Briscola: denari</span></div>
                  <div className="club-table">
                    <div className="club-table-line" />
                    <div className="club-player club-player-top"><span className="club-avatar club-avatar-peach">G</span><span>Giulia<small>IL TUO SOCIO</small></span><span className="club-card-backs">▥ ▥ ▥</span></div>
                    <div className="club-player club-player-left"><span className="club-avatar club-avatar-lilac">L</span><span>Luca<small>AVVERSARIO</small></span></div>
                    <div className="club-player club-player-right"><span className="club-avatar club-avatar-peach">M</span><span>Marta<small>AVVERSARIA</small></span></div>
                    <div className="club-table-wordmark" aria-hidden="true">BECCA<span>!</span><small>MAKE YOUR MOVE.</small></div>
                    <div className="club-center-cards">
                      <CardImage card={{ value: "sette", suit: "denari", label: "Sette di denari di Giulia" }} className="club-center-card-one" />
                      <CardImage card={{ value: "fante", suit: "denari", label: "Fante di denari di Luca" }} className="club-center-card-two" />
                      <AnimatePresence mode="wait">
                        {lastCard && <motion.div key={lastCard.label} className="club-played-card" initial={{ opacity: 0, y: motionStopped ? 0 : 110, rotate: -8 }} animate={{ opacity: 1, y: 0, rotate: -8 }} exit={{ opacity: 0 }} transition={{ type: "spring", duration: 0.35, bounce: 0 }}><CardImage card={lastCard} /><motion.span className="club-card-impact" aria-hidden="true" initial={{ opacity: 0 }} animate={motionStopped ? { opacity: 0 } : { opacity: [0, 1, 1, 0], y: [0, -12, -24, -45], scale: [0.8, 1.1, 1, 1] }} transition={{ duration: 1 }}>BOOM.</motion.span></motion.div>}
                      </AnimatePresence>
                    </div>
                    <div className="club-player club-player-bottom"><span className="club-avatar">Tu</span><span>Il tuo posto<small>{lastCard ? "CARTA IN TAVOLA" : "PROVA A GIOCARE UNA CARTA"}</small></span><span className="club-turn-dot" /></div>
                  </div>
                  <div className="club-hand-area">
                    <div className="club-hand-label"><span>LA TUA MANO</span><span>{cards.length - played.length} carte demo</span></div>
                    <div className="club-hand">
                      {cards.map((card, index) => !played.includes(index) && (
                        <motion.button key={card.label} className="club-hand-card" aria-label={`Gioca ${card.label}`}
                          whileHover={motionStopped ? undefined : { y: -24, rotate: 0 }} whileTap={motionStopped ? undefined : { scale: 0.96 }}
                          style={{ "--hand-rotation": `${(index - 2) * 5}deg` } as CSSProperties}
                          onClick={() => setPlayed((current) => [...current, index])}><CardImage card={card} /></motion.button>
                      ))}
                      {played.length === cards.length && <div className="club-hand-empty"><Check size={22} /><span>Hai provato tutte le carte.</span><button className="club-text-button" onClick={() => setPlayed([])}>Distribuisci di nuovo <RotateCcw size={16} /></button></div>}
                    </div>
                    <p className="club-play-status" role="status" aria-live="polite">{lastCard ? `${lastCard.label} in tavola${signal !== "Niente" ? ` · ${signal}` : ""}. Puoi provare un'altra carta.` : "Scegli una carta e guarda come si muove sul tavolo."}</p>
                  </div>
                </div>
                <aside className="club-game-aside" aria-label="Dettagli del tavolo demo">
                  <section className="club-score-panel"><span className="club-eyebrow">IL SEGNAPUNTI</span><div><span>Noi<small>Tu e Giulia</small></span><strong>24</strong></div><div><span>Loro<small>Luca e Marta</small></span><strong>18</strong></div><p>Si arriva a 41. Insieme.</p><span className="club-demo-caption">Punteggi di esempio</span></section>
                  <section className="club-signal-panel"><span className="club-eyebrow">FAI UN SEGNO AL SOCIO</span><h2>Le parole giuste.</h2><p>Prova i segnali dell'interfaccia.</p><div className="club-signals">{["Niente", "Striscio", "Busso", "Volo"].map((item) => <button key={item} aria-pressed={signal === item} onClick={() => setSignal(item)}>{item}{signal === item && <Check size={13} />}</button>)}</div><span className="club-demo-caption">Qui puoi provarli liberamente. In partita li dichiara solo chi apre la presa.</span></section>
                  <div className="club-table-tools"><button className="club-text-button" onClick={() => { setPlayed([]); setSignal("Niente"); }}><RotateCcw size={16} /> Ricomincia</button><button className="club-icon-button" onClick={() => setRulesOpen(true)} aria-label="Apri le regole"><CircleHelp size={19} /></button></div>
                  <p className="club-demo-disclaimer">Un assaggio del nuovo design. Carte, persone e punteggi sono dimostrativi; nessuna azione viene inviata al server.</p>
                </aside>
              </div>
            </section>
          )}
        </main>
        <footer className="club-footer"><span>BECCA <span>©</span> 2026</span><span>LA TRADIZIONE HA CAMBIATO SERVER.</span><a href="/">Torna alla versione attuale <ArrowUpRight size={14} /></a></footer>
        <ArcadeRules open={rulesOpen} onOpenChange={setRulesOpen} />
      </div>
    </MotionConfig>
  );
}
