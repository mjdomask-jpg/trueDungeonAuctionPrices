import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const prefersDark = (): Theme =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

// Reads the theme already stamped onto <html> by the inline script in
// index.html (seeded from localStorage, else the OS preference).
const readTheme = (): Theme =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

// App-wide light/dark theme. Follows the OS until the visitor makes an
// explicit choice, which is then persisted in localStorage.
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Keep following the OS while the visitor hasn't made an explicit choice.
  useEffect(() => {
    if (localStorage.getItem('theme')) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(prefersDark());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next); // an explicit choice; stop following the OS
      return next;
    });
  };

  return [theme, toggle];
}
