import { useEffect, useRef } from "react";

/** Moves focus to the element behind the returned ref when the screen mounts (a heading with tabIndex -1). */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
