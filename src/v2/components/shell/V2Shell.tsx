import type { ReactNode } from "react";
import { cn } from "@/v2/lib/cn";
import V2Header from "./V2Header";
import V2ConnectionBanner from "./V2ConnectionBanner";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import type { AuthUser } from "@/hooks/useAuth";

interface V2ShellProps {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
  onLogin: () => void;
  children: ReactNode;
  /** Decorative layer rendered behind the content (ambient cards). */
  backdrop?: ReactNode;
  className?: string;
}

/**
 * Felt-covered frame shared by every V2 route. The .becca-v2 class is applied
 * once here so no V2 token leaks into V1.
 */
const V2Shell = ({
  user,
  onLogout,
  onLogin,
  children,
  backdrop,
  className,
}: V2ShellProps) => {
  const status = useConnectionStatus();

  return (
    <div className="becca-v2 becca-felt-bg relative min-h-screen">
      <V2ConnectionBanner status={status} />
      {backdrop}
      <V2Header user={user} onLogout={onLogout} onLogin={onLogin} />
      <main
        className={cn(
          "relative mx-auto w-full max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
};

export default V2Shell;
