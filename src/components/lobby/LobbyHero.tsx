import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { ArrowDown, ArrowRight, Crosshair, Sparkles, Swords } from "lucide-react";
import type { PointerEvent } from "react";
import { Button } from "@/components/ui/button";

interface LobbyHeroProps {
  isAuthenticated: boolean;
  onCreateRoom: () => void;
  onPractice: () => void;
  onAuthenticate: () => void;
}

const orbitingCards = [
  {
    src: "/images/cards/asso_denari.png",
    alt: "Asso di denari",
    depth: 135,
    zIndex: 30,
    delay: 0,
    x: [-210, -110, 38, 178, 220, -210],
    y: [28, -104, -142, -52, 42, 28],
    rotate: [-28, -13, 7, 22, 36, -28],
    rotateY: [18, -14, 10, -16, 20, 18],
  },
  {
    src: "/images/cards/tre_spade.png",
    alt: "Tre di spade",
    depth: 30,
    zIndex: 10,
    delay: 1.35,
    x: [-220, -154, -15, 140, 218, -220],
    y: [18, -78, -164, -84, 26, 18],
    rotate: [-42, -24, -6, 16, 34, -42],
    rotateY: [10, -20, 16, -18, 12, 10],
  },
  {
    src: "/images/cards/cavallo_coppe.png",
    alt: "Cavallo di coppe",
    depth: 175,
    zIndex: 40,
    delay: 2.7,
    x: [-205, -45, 116, 220, 72, -205],
    y: [45, -118, -122, 8, 72, 45],
    rotate: [-18, 5, 18, 34, 8, -18],
    rotateY: [24, -16, 14, -12, 22, 24],
  },
  {
    src: "/images/cards/re_bastoni.png",
    alt: "Re di bastoni",
    depth: 50,
    zIndex: 12,
    delay: 4.05,
    x: [-208, -172, -54, 112, 216, -208],
    y: [-6, -96, -155, -98, -4, -6],
    rotate: [-35, -16, 4, 24, 40, -35],
    rotateY: [14, -12, 20, -20, 14, 14],
  },
  {
    src: "/images/cards/sette_denari.png",
    alt: "Sette di denari",
    depth: 150,
    zIndex: 34,
    delay: 5.4,
    x: [-206, -106, 50, 188, 216, -206],
    y: [54, -36, -143, -112, 25, 54],
    rotate: [-12, -29, -7, 17, 32, -12],
    rotateY: [18, -20, 11, -17, 24, 18],
  },
];

export default function LobbyHero({
  isAuthenticated,
  onCreateRoom,
  onPractice,
  onAuthenticate,
}: LobbyHeroProps) {
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(pointerY, { damping: 24, stiffness: 120 });
  const rotateY = useSpring(pointerX, { damping: 24, stiffness: 120 });
  const primaryAction = isAuthenticated ? onCreateRoom : onAuthenticate;

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - bounds.left) / bounds.width - 0.5) * 9);
    pointerY.set(((event.clientY - bounds.top) / bounds.height - 0.5) * -8);
  };

  const resetPointer = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <section className="relative isolate overflow-hidden bg-[#061d20] pb-16 pt-28 text-[#fff8ec] sm:pb-24 sm:pt-36">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(255,192,87,.2),transparent_19%),radial-gradient(circle_at_86%_24%,rgba(31,204,143,.17),transparent_26%),linear-gradient(120deg,#061d20_8%,#0b3834_54%,#05191d_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.1)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="pointer-events-none absolute left-1/2 top-[14%] h-[35rem] w-[35rem] -translate-x-1/2 rounded-full bg-[#e8b866]/10 blur-[100px]" />

      <div className="relative mx-auto grid max-w-7xl gap-10 px-5 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-8">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 max-w-2xl"
        >
          <div className="mb-7 flex items-center gap-3 text-[0.67rem] font-bold uppercase tracking-[0.22em] text-[#f2c56f]">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-[#f2c56f]/45 bg-[#f2c56f]/10">
              <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Partita italiana in tempo reale
          </div>

          <h1 className="font-display max-w-2xl text-5xl font-bold leading-[0.87] tracking-[-0.065em] text-[#fffaf1] sm:text-6xl lg:text-7xl">
            Ogni carta
            <span className="block bg-gradient-to-r from-[#f7d485] via-[#fff0c8] to-[#c7ffca] bg-clip-text text-transparent">
              cambia il tavolo.
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-[#d8dfd3] sm:text-lg">
            Briscola, segnali, prese e sangue freddo. Riunisci il socio, leggi gli avversari e conquista ogni mano.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              onClick={primaryAction}
              className="h-13 rounded-full bg-[#f0bc5b] px-7 text-[#09201f] shadow-[0_14px_40px_rgba(240,188,91,.28)] transition-transform hover:-translate-y-1 hover:bg-[#ffe0a0] focus-visible:ring-[#fff8ec]"
              data-testid="hero-primary-action"
            >
              <Swords className="h-5 w-5" />
              {isAuthenticated ? "Crea il tuo tavolo" : "Entra in partita"}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={onPractice}
              className="h-13 rounded-full border-[#d6f1c7]/35 bg-white/[0.05] px-7 text-[#fff8ec] backdrop-blur-sm hover:border-[#d6f1c7]/70 hover:bg-white/[0.12] hover:text-white"
            >
              Prova contro i bot <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-11 flex flex-wrap gap-3 text-xs font-semibold text-[#d8dfd3]">
            {["4 giocatori", "2 squadre", "40 carte"].map((item) => (
              <span key={item} className="rounded-full border border-white/10 bg-black/10 px-3.5 py-2 backdrop-blur-sm">
                {item}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.9, y: 28 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.9, delay: reduceMotion ? 0 : 0.1, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={handlePointerMove}
          onPointerLeave={resetPointer}
          className="relative mx-auto h-[25rem] w-full max-w-[42rem] touch-pan-y sm:h-[34rem]"
          style={{ perspective: 1300 }}
          aria-label="Carte italiane sospese sopra un tavolo da gioco"
        >
          <motion.div
            className="absolute inset-0"
            style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
          >
            <div
              className="absolute inset-x-[2%] bottom-[7%] h-[57%] rounded-[50%] border border-[#f4d281]/40 bg-[radial-gradient(ellipse_at_50%_40%,#126557,#08362f_62%,#041d20)] shadow-[inset_0_0_0_1px_rgba(255,240,196,.08),inset_0_0_70px_rgba(0,0,0,.45),0_40px_80px_rgba(0,0,0,.45)]"
              style={{ transform: "rotateX(63deg) translateZ(-58px)" }}
            />
            <div
              className="absolute inset-x-[11%] bottom-[19%] h-[34%] rounded-[50%] border border-[#f8d77f]/25"
              style={{ transform: "rotateX(63deg) translateZ(-53px)" }}
            />
            <div
              className="absolute left-1/2 top-[45%] h-32 w-[24rem] -translate-x-1/2 rounded-full bg-[#e2ffb9]/20 blur-[34px]"
              style={{ transform: "translateZ(10px)" }}
            />

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65, delay: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-1/2 top-[47%] h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#f7d485]/30"
              style={{ transform: "translateZ(-12px) rotateX(64deg)" }}
            />

            {orbitingCards.map((card, index) => (
              <motion.div
                key={card.src}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.5 }}
                animate={reduceMotion
                  ? { opacity: 1, x: card.x[0], y: card.y[0], rotate: card.rotate[0] }
                  : {
                      opacity: 1,
                      x: card.x,
                      y: card.y,
                      rotate: card.rotate,
                      rotateY: card.rotateY,
                    }}
                transition={reduceMotion
                  ? { duration: 0.45, delay: index * 0.08 }
                  : {
                      duration: 10.5,
                      delay: card.delay,
                      ease: "linear",
                      repeat: Infinity,
                      repeatDelay: 0.4,
                    }}
                className="absolute left-1/2 top-[47%] z-10"
                style={{ zIndex: card.zIndex, transformStyle: "preserve-3d" }}
              >
                <div style={{ transform: `translateZ(${card.depth}px)` }}>
                  <img
                    src={card.src}
                    alt={card.alt}
                    width={63}
                    height={100}
                    className="w-[54px] rounded-[5px] border border-[#fff8ec]/70 shadow-[0_15px_17px_rgba(0,0,0,.34),0_1px_0_rgba(255,255,255,.5)_inset] sm:w-[63px]"
                  />
                </div>
              </motion.div>
            ))}

            <div
              className="absolute left-1/2 top-[50%] z-20 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#ffe5a5]/60 bg-[#092d2d]/90 text-center shadow-[0_0_0_7px_rgba(237,187,86,.08),0_0_45px_rgba(239,194,102,.24)] backdrop-blur-md"
              style={{ transform: "translateZ(210px)" }}
            >
              <Sparkles className="h-5 w-5 text-[#f3c76f]" aria-hidden="true" />
              <span className="mt-1 text-[0.54rem] font-bold uppercase tracking-[0.14em] text-[#fff5dd]">Tavolo live</span>
            </div>
          </motion.div>

          <div className="absolute bottom-0 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#f5d686]/25 bg-[#061d20]/75 px-4 py-2 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#f6d88d] backdrop-blur-md">
            Muovi il cursore sul tavolo
          </div>
        </motion.div>
      </div>

      <a href="#entra-al-tavolo" className="absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 text-xs font-semibold text-[#cad5c9]/75 transition-colors hover:text-[#f3ca78] sm:inline-flex">
        Scopri il gioco <ArrowDown className="h-4 w-4" />
      </a>
    </section>
  );
}
