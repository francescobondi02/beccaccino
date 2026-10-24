import { motion, useMotionValue, useSpring } from "framer-motion";
import { ArrowDown, ArrowUpRight, Layers3, Play, Zap } from "lucide-react";
import LandingCardArtwork from "@/components/lobby/LandingCardArtwork";

const heroCards = ["asso_denari", "tre_spade", "re_coppe", "cavallo_bastoni", "due_denari"] as const;

interface ArcadeHeroProps {
  onPlay: () => void;
  onRules: () => void;
  motionStopped: boolean;
}

export default function ArcadeHero({ onPlay, onRules, motionStopped }: ArcadeHeroProps) {
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const tiltX = useSpring(pointerY, { stiffness: 100, damping: 20 });
  const tiltY = useSpring(pointerX, { stiffness: 100, damping: 20 });

  return (
    <>
      <section className="club-hero" aria-labelledby="club-title">
        <motion.div className="club-hero-copy" initial={{ opacity: 0, y: motionStopped ? 0 : 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <span className="club-eyebrow"><span className="club-tiny-star" aria-hidden="true">✳</span> CARTE DI SEMPRE. ENERGIA NUOVA.</span>
          <h1 id="club-title" tabIndex={-1}><span>NON È </span><span className="club-title-outline">SOLO </span><em>FORTUNA.</em></h1>
          <p>Sfida la chat di gruppo. Trova il tuo socio.<br />Fai quella presa che non si scordano.</p>
          <div className="club-hero-actions">
            <button className="club-button" onClick={onPlay} data-testid="hero-primary-action">FAMMI GIOCARE <Zap size={20} fill="currentColor" /></button>
            <button className="club-text-button" onClick={onRules}><span className="club-play-icon" aria-hidden="true"><Play size={12} fill="currentColor" /></span> Come si gioca</button>
          </div>
          <div className="club-hero-note"><span className="club-people" aria-hidden="true"><i>G</i><i>L</i><i>M</i><i>Tu</i></span><span>4 giocatori. 2 squadre.<br /><strong>Un sacco di «te l'avevo detto».</strong></span></div>
        </motion.div>
        <motion.div className="club-hero-art" aria-hidden="true"
          style={{ rotateX: motionStopped ? 0 : tiltX, rotateY: motionStopped ? 0 : tiltY }}
          onPointerMove={(event) => {
            if (motionStopped || event.pointerType !== "mouse") return;
            const bounds = event.currentTarget.getBoundingClientRect();
            pointerX.set(((event.clientX - bounds.left) / bounds.width - 0.5) * 12);
            pointerY.set(((event.clientY - bounds.top) / bounds.height - 0.5) * -12);
          }}
          onPointerLeave={() => { pointerX.set(0); pointerY.set(0); }}>
          <div className="club-art-grid" />
          <span className="club-art-label"><span className="club-status-dot" /> LA TUA PROSSIMA BELLA ABITUDINE</span>
          <div className="club-art-orbit" />
          <span className="club-art-type">GIOCA<br />LE TUE<br />CARTE.</span>
          <div className="club-fan">
            {heroCards.map((card, index) => (
              <motion.div key={card} className="club-fan-card"
                initial={{ opacity: 0, y: motionStopped ? 0 : 90, rotate: motionStopped ? (index - 2) * 17 : -30 }}
                animate={{ opacity: 1, y: Math.abs(index - 2) * 15, rotate: (index - 2) * 17 }}
                transition={{ type: "spring", duration: 0.8, bounce: 0, delay: motionStopped ? 0 : 0.1 + index * 0.07 }}
                whileHover={motionStopped ? undefined : { y: Math.abs(index - 2) * 15 - 35, scale: 1.08 }}>
                <div className="club-card-float" style={{ animationDelay: `${index * -0.65}s` }}>
                  <LandingCardArtwork className="club-card" card={card} />
                </div>
              </motion.div>
            ))}
          </div>
          <div className="club-roundel"><span>TUTTA</span><Zap size={27} fill="currentColor" /><span>L'ENERGIA DI BECCA</span></div>
          <span className="club-art-caption"><span><Layers3 size={15} /> 40 CARTE. DUE SQUADRE.</span><span>2 VS 2 <ArrowUpRight size={15} /></span></span>
          <span className="club-handwritten">LA PRESA<br />È TUA. <ArrowDown size={25} /></span>
          <span className="club-art-spark club-art-spark-one">✳</span>
          <span className="club-art-spark club-art-spark-two">✳</span>
        </motion.div>
      </section>
      <div className="club-manifesto" aria-label="Quattro amici. Due squadre. Quaranta carte. Zero noia.">
        <div className="club-ticker" aria-hidden="true">
          {[0, 1].map((copy) => <span key={copy}>QUATTRO AMICI <span>✳</span> DUE SQUADRE <span>✳</span> QUARANTA CARTE <span>✳</span> ZERO NOIA <span>✳</span> </span>)}
        </div>
      </div>
    </>
  );
}
