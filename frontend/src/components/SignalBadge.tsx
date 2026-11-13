const SIGNAL_COLORS: Record<string, string> = {
  striscio: "bg-green-500/20 text-green-600",
  busso: "bg-amber-500/20 text-amber-600",
  volo: "bg-red-500/20 text-red-600",
};

/**
 * The signal ("busso" / "striscio" / "volo") the trick leader just declared.
 *
 * Extracted so every seat can show it. It used to be inlined on the top seat
 * only, which meant a bot leading from the left or right declared invisibly —
 * fine when the top seat was the only opponent that mattered, useless for
 * watching three bots.
 */
const SignalBadge = ({ signal }: { signal: string }) => (
  <span
    className={`text-[10px] font-bold mt-1 px-2 py-0.5 rounded-full uppercase tracking-wide ${
      SIGNAL_COLORS[signal] ?? "bg-muted text-muted-foreground"
    }`}
    data-testid="signal-badge"
  >
    {signal}
  </span>
);

export default SignalBadge;
