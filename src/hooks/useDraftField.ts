import { useEffect, useRef, useState } from "preact/hooks";

// Debounced text-field binding: keeps a local `draft` that updates instantly
// on every keystroke, but only calls `commit` after `delay` ms of inactivity
// (or immediately on blur/unmount if a commit is still pending). Used by the
// AI接続/AI Network settings tabs so typing into Base URL/API key/Room ID/etc.
// doesn't write to the shared llm config on every keystroke. Ported from
// tc-translate's src/hooks/useDraftField.ts.
export function useDraftField(value: string, commit: (next: string) => void, delay = 400) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!dirtyRef.current && !focusedRef.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current);
      if (dirtyRef.current) {
        dirtyRef.current = false;
        commitRef.current(draftRef.current);
      }
    };
  }, []);

  function onInput(next: string): void {
    setDraft(next);
    dirtyRef.current = true;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      dirtyRef.current = false;
      commitRef.current(next);
    }, delay);
  }

  function onFocus(): void {
    focusedRef.current = true;
  }

  function onBlur(): void {
    focusedRef.current = false;
    window.clearTimeout(timerRef.current);
    if (dirtyRef.current) {
      dirtyRef.current = false;
      commitRef.current(draftRef.current);
    }
  }

  return { draft, onInput, onFocus, onBlur };
}
