import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const MoonveilFX = lazy(() => import('../components/MoonveilFX.jsx'));
const SakuraFX = lazy(() => import('../components/SakuraFX.jsx'));
const SunsetEmberFX = lazy(() => import('../components/SunsetEmberFX.jsx'));
const AuroraFX = lazy(() => import('../components/AuroraFX.jsx'));
const OceanFX = lazy(() => import('../components/OceanFX.jsx'));
const NebulaFX = lazy(() => import('../components/NebulaFX.jsx'));
const DreamCloudFX = lazy(() => import('../components/DreamCloudFX.jsx'));

const STORAGE_KEYS = ['theme', 'qc-theme'];

export const APP_ICONS = [
  { id: 'original',   label: 'Original',   file: '/logo.png',              swatch: '#7dd3fc' },
  { id: 'emerald',    label: 'Emerald',    file: '/icon-emerald.png',      swatch: '#6ee7b7' },
  { id: 'violet',     label: 'Violet',     file: '/icon-violet.png',       swatch: '#c4b5fd' },
  { id: 'sunset',     label: 'Sunset',     file: '/icon-sunset.png',       swatch: '#fdba74' },
  { id: 'rose',       label: 'Rose',       file: '/icon-rose.png',         swatch: '#f9a8d4' },
  { id: 'crimson',    label: 'Crimson',    file: '/icon-crimson.png',      swatch: '#fca5a5' },
  { id: 'gold',       label: 'Gold',       file: '/icon-gold.png',         swatch: '#fcd34d' },
  { id: 'lime',       label: 'Lime',       file: '/icon-lime.png',         swatch: '#bef264' },
  { id: 'mono-dark',  label: 'Mono Dark',  file: '/icon-mono-dark.png',    swatch: '#d1d5db' },
  { id: 'mono-light', label: 'Mono Light', file: '/icon-mono-light.png',   swatch: '#f9fafb' },
  { id: 'cyber',      label: 'Cyber',      file: '/icon-cyber.png',        swatch: '#67e8f9' },
];
const DEFAULT_ICON = 'original';
const ICON_STORAGE_KEY = 'qc-app-icon';

function applyAppIcon(iconId) {
  const icon = APP_ICONS.find((i) => i.id === iconId) || APP_ICONS[0];
  document.querySelectorAll("link[rel~='icon']").forEach((el) => el.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = `${icon.file}?v=${Date.now()}`;
  document.head.appendChild(link);
}

function getPreferredIcon() {
  try {
    const stored = localStorage.getItem(ICON_STORAGE_KEY);
    if (APP_ICONS.some((i) => i.id === stored)) return stored;
  } catch {}
  return DEFAULT_ICON;
}

// "Mode" themes are the practical/accessibility trio — always shown together.
export const MODE_THEMES = ['light', 'dark', 'eyecare'];
// "Fun" themes are dreamy skins — shown in a separate picker. Add new ones here.
export const FUN_THEMES = ['moonveil', 'sakura', 'sunset', 'aurora', 'ocean', 'nebula', 'dreamcloud'];
export const VALID_THEMES = [...MODE_THEMES, ...FUN_THEMES];

const ThemeContext = createContext(null);

function getPreferredTheme() {
  try {
    for (const key of STORAGE_KEYS) {
      const stored = localStorage.getItem(key);
      if (VALID_THEMES.includes(stored)) return stored;
    }
  } catch {
    // localStorage may be unavailable
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const lightLike = theme === 'light' || theme === 'sakura' || theme === 'dreamcloud';
  document.documentElement.style.colorScheme = lightLike ? 'light' : 'dark';
  document.body.classList.remove(...VALID_THEMES.map((t) => `theme-${t}`));
  document.body.classList.add(`theme-${theme}`);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof document !== 'undefined') {
      const existing = document.documentElement.getAttribute('data-theme');
      if (VALID_THEMES.includes(existing)) return existing;
    }
    return getPreferredTheme();
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      STORAGE_KEYS.forEach((key) => localStorage.setItem(key, theme));
    } catch {
      // ignore quota / private mode errors
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (VALID_THEMES.includes(next)) {
      setThemeState(next);
    }
  }, []);

  // Kept as the original 3-way cycle across Light/Dark/Eyecare only —
  // fun themes are deliberately not part of this cycle, since ThemeToggle
  // is used elsewhere (e.g. auth pages) as a quick mode flip, not a skin picker.
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'eyecare';
      return 'dark';
    });
  }, []);

  const [appIcon, setAppIconState] = useState(getPreferredIcon);

  useEffect(() => {
    applyAppIcon(appIcon);
    try {
      localStorage.setItem(ICON_STORAGE_KEY, appIcon);
    } catch {
      // ignore quota / private mode errors
    }
  }, [appIcon]);

  const setAppIcon = useCallback((next) => {
    if (APP_ICONS.some((i) => i.id === next)) {
      setAppIconState(next);
    }
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme !== 'light' && theme !== 'sakura' && theme !== 'dreamcloud',
      isFunTheme: FUN_THEMES.includes(theme),
      setTheme,
      toggleTheme,
      appIcon,
      setAppIcon,
    }),
    [theme, setTheme, toggleTheme, appIcon, setAppIcon]
  );

  return (
    <ThemeContext.Provider value={value}>
      <Suspense fallback={null}>
        {theme === 'moonveil' && <MoonveilFX />}
        {theme === 'sakura' && <SakuraFX />}
        {theme === 'sunset' && <SunsetEmberFX />}
        {theme === 'aurora' && <AuroraFX />}
        {theme === 'ocean' && <OceanFX />}
        {theme === 'dreamcloud' && <DreamCloudFX />}
        {theme === 'nebula' && <NebulaFX />}
      </Suspense>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}