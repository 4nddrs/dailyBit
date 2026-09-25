import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'dailybit-theme';

function readInitialTheme(): Theme {
  // index.html sets the attribute before first paint, so the DOM is the source of truth.
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage can be unavailable (private mode); the theme still applies for this session.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
