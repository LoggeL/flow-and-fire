import { untracked } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Tooltip contents refresh at 4 Hz while open (ui.md §9.1 "Tooltip-Inhalt: beim Öffnen, danach 4 Hz"). */
export const TOOLTIP_SAMPLE_MS = 250;

/**
 * Samples `read` (which may read hot signals) at mount and then every `intervalMs`, without subscribing the
 * calling component to those signals. The component re-renders only when the sampled `key(view)` changes,
 * so a 10 Hz economy never re-renders a tooltip more than 4 times per second.
 */
export function useSampled<T>(read: () => T, key: (view: T) => string, intervalMs: number = TOOLTIP_SAMPLE_MS): T {
  const readRef = useRef(read);
  readRef.current = read;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [view, setView] = useState<T>(() => untracked(read));
  const lastKey = useRef<string>(key(view));
  useEffect(() => {
    const id = setInterval(() => {
      const next = untracked(readRef.current);
      const k = keyRef.current(next);
      if (k === lastKey.current) return;
      lastKey.current = k;
      setView(() => next);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return view;
}
