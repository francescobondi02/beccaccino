import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/v2/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline";

export interface V2ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Renders on the felt instead of on an ivory panel. */
  onFelt?: boolean;
}

const base =
  "becca-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[calc(var(--becca-radius)-0.15rem)] px-4 text-sm font-semibold tracking-tight disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary:
    "bg-[hsl(var(--becca-accent))] text-[hsl(var(--becca-accent-ink))] shadow-[var(--becca-shadow-card)] hover:bg-[hsl(var(--becca-accent-strong))]",
  secondary:
    "bg-[hsl(var(--becca-surface-2))] text-[hsl(var(--becca-ink))] border border-[hsl(var(--becca-line))] hover:bg-[hsl(var(--becca-surface))]",
  outline:
    "border border-[hsl(var(--becca-line))] bg-transparent text-[hsl(var(--becca-ink))] hover:bg-[hsl(var(--becca-surface-2))]",
  ghost: "bg-transparent text-[hsl(var(--becca-ink))] hover:bg-[hsl(var(--becca-surface-2))]",
};

const feltVariants: Partial<Record<Variant, string>> = {
  outline:
    "border border-[hsl(var(--becca-on-felt)/0.35)] text-[hsl(var(--becca-on-felt))] hover:bg-[hsl(var(--becca-on-felt)/0.12)]",
  ghost:
    "text-[hsl(var(--becca-on-felt))] hover:bg-[hsl(var(--becca-on-felt)/0.12)]",
};

const V2Button = forwardRef<HTMLButtonElement, V2ButtonProps>(
  ({ variant = "primary", onFelt = false, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        base,
        (onFelt && feltVariants[variant]) || variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
V2Button.displayName = "V2Button";

export default V2Button;
