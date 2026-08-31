import { useEffect, useRef, useState } from "react";

export function usePortalTheme<T extends HTMLElement>() {
  const anchorRef = useRef<T | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const shell = anchorRef.current?.closest(".mumo-theme-shell");
    if (!shell) return;

    const syncTheme = () => setDarkMode(shell.classList.contains("dark"));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(shell, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return { anchorRef, darkMode };
}
