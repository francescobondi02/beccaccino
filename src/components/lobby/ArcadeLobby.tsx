import { useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { ArrowUpRight, Pause, Play, Zap } from "lucide-react";
import { useReducedMotion } from "@/v2/hooks/useReducedMotion";
import ArcadeHero from "./ArcadeHero";
import ArcadeRules from "./ArcadeRules";

export default function ArcadeLobby({ children, onPlay }: { children: ReactNode; onPlay: () => void }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const reducedMotion = useReducedMotion();
  const motionStopped = reducedMotion || !effectsEnabled;

  return (
    <MotionConfig reducedMotion={motionStopped ? "always" : "user"}>
      <div className="arcade-lobby">
        <a className="club-skip" href="#main-content">Vai al contenuto</a>
        <main id="main-content" tabIndex={-1}>
          <div className="club-preview arcade-live-hero" data-motion={motionStopped ? "off" : "on"}>
            <div className="club-main">
              <div className="arcade-effects">
                <button className="club-motion-toggle" aria-pressed={effectsEnabled} onClick={() => setEffectsEnabled((enabled) => !enabled)}>
                  {effectsEnabled ? <Pause size={14} /> : <Play size={14} />}
                  {effectsEnabled ? "Pausa effetti" : "Attiva effetti"}
                </button>
              </div>
              <ArcadeHero onPlay={onPlay} onRules={() => setRulesOpen(true)} motionStopped={motionStopped} />
            </div>
          </div>
          <section id="entra-al-tavolo" className="arcade-lounge" aria-labelledby="arcade-lounge-title">
            <span className="club-eyebrow"><Zap size={14} /> SCEGLI LA TUA ARENA</span>
            <h2 id="arcade-lounge-title">TROVA IL TUO <em>SOCIO.</em></h2>
            <p>Crea una stanza, entra con il codice degli amici o allenati contro i bot.</p>
            <div className="arcade-lobby-grid">{children}</div>
          </section>
          <section className="club-bottom-note arcade-bottom-note">
            <span className="club-brand-symbol" aria-hidden="true"><Zap size={38} fill="currentColor" /></span>
            <p>ESCI DALLA CHAT.<br /><em>ENTRA IN PARTITA.</em></p>
            <button className="club-text-button" onClick={onPlay}>IL PROSSIMO GIRO È TUO <ArrowUpRight size={22} /></button>
          </section>
        </main>
        <footer className="club-footer"><span>BECCA <span>©</span> {new Date().getFullYear()}</span><span>IL BECCACCINO, DOVE VUOI TU.</span></footer>
        <ArcadeRules open={rulesOpen} onOpenChange={setRulesOpen} />
      </div>
    </MotionConfig>
  );
}
