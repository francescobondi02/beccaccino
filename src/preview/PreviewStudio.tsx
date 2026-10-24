import { useState } from "react";
import { MotionConfig } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Pause, Play, Sparkles, Zap,
} from "lucide-react";
import ArcadeHero from "@/components/lobby/ArcadeHero";
import ArcadeRules from "@/components/lobby/ArcadeRules";
import { useReducedMotion } from "@/v2/hooks/useReducedMotion";
import PreviewGameTable from "./PreviewGameTable";
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
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const reduceMotion = useReducedMotion();
  const motionStopped = reduceMotion || !effectsEnabled;

  const openTable = (name = rooms[0].name) => {
    setRoom(name);
    setView("table");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => document.querySelector<HTMLHeadingElement>(".club-match-preview h1")?.focus());
  };

  const openClub = () => {
    setView("club");
    requestAnimationFrame(() => document.getElementById("club-title")?.focus());
  };

  if (view === "table") {
    return <PreviewGameTable
      room={room} onBack={openClub} effectsEnabled={effectsEnabled} motionStopped={motionStopped}
      onToggleEffects={() => setEffectsEnabled((enabled) => !enabled)}
    />;
  }

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
            <button aria-current="page" onClick={openClub}>La lobby</button>
            <button onClick={() => openTable()}>Tavolo demo</button>
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
          <ArcadeHero onPlay={() => openTable()} onRules={() => setRulesOpen(true)} motionStopped={motionStopped} />

          <section className="club-lounge" aria-labelledby="club-lounge-title">
            <div className="club-section-heading">
              <div><span className="club-eyebrow"><Zap size={14} /> SCEGLI LA TUA ARENA</span><h2 id="club-lounge-title">TROVA IL TUO <em>SOCIO.</em></h2></div>
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
        </main>
        <footer className="club-footer"><span>BECCA <span>©</span> 2026</span><span>LA TRADIZIONE HA CAMBIATO SERVER.</span><a href="/">Torna alla versione attuale <ArrowUpRight size={14} /></a></footer>
        <ArcadeRules open={rulesOpen} onOpenChange={setRulesOpen} />
      </div>
    </MotionConfig>
  );
}
