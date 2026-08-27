import type { ReactNode } from "react";
import { cn } from "@/v2/lib/cn";

type Tone = "neutral" | "accent" | "cobalt" | "brass";

const tones: Record<Tone, string> = {
  neutral:
    "bg-[hsl(var(--becca-surface-2))] text-[hsl(var(--becca-ink-soft))] border-[hsl(var(--becca-line))]",
  accent:
    "bg-[hsl(var(--becca-accent)/0.12)] text-[hsl(var(--becca-accent-strong))] border-[hsl(var(--becca-accent)/0.35)]",
  cobalt:
    "bg-[hsl(var(--becca-cobalt)/0.12)] text-[hsl(var(--becca-cobalt))] border-[hsl(var(--becca-cobalt)/0.35)]",
  brass:
    "bg-[hsl(var(--becca-brass)/0.16)] text-[hsl(30 45% 30%)] border-[hsl(var(--becca-brass)/0.4)]",
};

const V2Badge = ({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
      tones[tone],
      className,
    )}
  >
    {children}
  </span>
);

export default V2Badge;
