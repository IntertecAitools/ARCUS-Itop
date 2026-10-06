import { useEffect, useRef } from 'react';

/**
 * Bind a keyboard shortcut such as "mod+k" (mod = Ctrl, or ⌘ on macOS) or "escape".
 */
export function useHotkeys(combo: string, handler: (event: KeyboardEvent) => void, enabled = true): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needsMod = parts.includes('mod');
    const needsShift = parts.includes('shift');

    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (needsMod !== mod || needsShift !== event.shiftKey) return;
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      handlerRef.current(event);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo, enabled]);
}
