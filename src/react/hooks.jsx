/**
 * Thin React bindings over the framework-free backend. Screens use these; nothing here holds logic
 * that isn't in `src/backend`.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { backupStatus, buildDayModel, db, getMeta, getSettings, loadDayData, startApp, toDateStr } from '../backend/index.js';

const AppContext = createContext(null);

/** Starts the clock, chime engine and wake lock once, and shares them with the tree. */
export function AppProvider({ children }) {
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let instance;
    let cancelled = false;
    startApp()
      .then((a) => (cancelled ? a.stop() : ((instance = a), setApp(a))))
      .catch(setError);
    return () => {
      cancelled = true;
      instance?.stop();
    };
  }, []);
  if (error) return <p role="alert">Could not open the on-device database: {String(error.message ?? error)}</p>;
  if (!app) return null;
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);

/** Epoch ms, updated once a second while the app is visible. */
export function useNow() {
  const { clock } = useApp();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => clock.subscribe(setNow), [clock]);
  return now;
}

/** Live view model for one day (re-renders on data changes and every second for today). */
export function useDay(date) {
  const now = useNow();
  const data = useLiveQuery(() => loadDayData(date), [date]);
  return useMemo(() => (data ? buildDayModel(data, now) : null), [data, now]);
}

export const useSettings = () => useLiveQuery(getSettings, []);

/** 'on' | 'muted' | 'needs-tap' */
export function useSoundState() {
  const { player } = useApp();
  const [state, setState] = useState(player.state());
  useEffect(() => player.subscribe(setState), [player]);
  return state;
}

/** Latest "while you were away" report from the chime engine (null once dismissed). */
export function useCatchUp() {
  const { engine } = useApp();
  const [report, setReport] = useState(null);
  useEffect(() => engine.subscribe((e) => e.type === 'catchup' && setReport(e)), [engine]);
  return [report, () => setReport(null)];
}

export function useBackupStatus() {
  const now = useNow();
  return useLiveQuery(async () => {
    const [settings, firstUseAt, taskCount] = await Promise.all([getSettings(), getMeta('firstUseAt'), db.tasks.count()]);
    return backupStatus({ settings, firstUseAt, hasData: taskCount > 0, now });
  }, [toDateStr(now)]);
}
