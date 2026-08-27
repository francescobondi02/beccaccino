import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/v2/lib/cn";

export interface V2FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean;
}

const V2Field = forwardRef<HTMLInputElement, V2FieldProps>(
  ({ label, hint, hideLabel, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;

    return (
      <div className="w-full">
        <label
          htmlFor={inputId}
          className={cn(
            "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[hsl(var(--becca-ink-soft))]",
            hideLabel && "sr-only",
          )}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-describedby={hintId}
          className={cn(
            "h-11 w-full rounded-[calc(var(--becca-radius)-0.15rem)] border border-[hsl(var(--becca-line))]",
            "bg-[hsl(var(--becca-surface))] px-3 text-sm text-[hsl(var(--becca-ink))]",
            "placeholder:text-[hsl(var(--becca-ink-soft))] transition-colors",
            "focus:border-[hsl(var(--becca-accent))] focus:outline-none",
            className,
          )}
          {...props}
        />
        {hint && (
          <p id={hintId} className="mt-1.5 text-xs text-[hsl(var(--becca-ink-soft))]">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
V2Field.displayName = "V2Field";

export default V2Field;
