import { useEffect, useState } from "react";

const QUERY = "(orientation: landscape) and (max-height: 540px) and (pointer: coarse)";

export function useMobileTable() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(QUERY).matches ?? false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia(QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile;
}
