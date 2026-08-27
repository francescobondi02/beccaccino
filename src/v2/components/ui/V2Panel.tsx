import type { ReactNode } from "react";
import { cn } from "@/v2/lib/cn";

interface V2PanelProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
  title?: string;
  description?: string;
  icon?: ReactNode;
}

/**
 * Ivory paper surface. Single level of depth — never nest a panel in a panel.
 */
const V2Panel = ({
  children,
  className,
  as: Tag = "section",
  title,
  description,
  icon,
}: V2PanelProps) => (
  <Tag
    className={cn(
      "becca-paper rounded-[var(--becca-radius)] border border-[hsl(var(--becca-line))] p-5",
      "shadow-[var(--becca-shadow-panel)] text-[hsl(var(--becca-ink))]",
      className,
    )}
  >
    {(title || description) && (
      <header className="mb-4 flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 text-[hsl(var(--becca-accent))]">{icon}</span>
        )}
        <div>
          {title && (
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          )}
          {description && (
            <p className="text-sm text-[hsl(var(--becca-ink-soft))]">
              {description}
            </p>
          )}
        </div>
      </header>
    )}
    {children}
  </Tag>
);

export default V2Panel;
