import { createContext, useContext, useEffect, useState } from 'react';
import { getFormats } from './api.js';

const Ctx = createContext({ ready: false, formats: {}, conversions: {}, capabilities: {}, limits: {} });

export function FormatsProvider({ children }) {
  const [state, setState] = useState({ ready: false, formats: {}, conversions: {}, capabilities: {}, limits: {} });
  useEffect(() => {
    let alive = true;
    const load = (attempt = 0) =>
      getFormats()
        .then((d) => alive && setState({ ready: true, ...d }))
        .catch((e) => {
          if (!alive) return;
          setState((s) => ({ ...s, error: e.message }));
          setTimeout(() => load(attempt + 1), Math.min(10000, 1000 * 2 ** attempt));
        });
    load();
    return () => {
      alive = false;
    };
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useFormats = () => useContext(Ctx);
