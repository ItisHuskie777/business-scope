import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stopped changing for `delayMs`. Used so the
 * search box sends one request per pause in typing, not one per keystroke.
 */
export default function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
