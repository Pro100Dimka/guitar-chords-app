import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  readTablatureDraft,
  writeTablatureDraft,
  TablatureDraft
} from "../../components/tablature-draft";

export type TabDraftStatus =
  | "loading"
  | "saving"
  | "saved"
  | "restored"
  | "readError"
  | "writeError";

/** Keep a recoverable working copy separate from the user's saved library. */
export function useTablatureDraft(
  draft: TablatureDraft,
  active: boolean,
  onRestore: (draft: TablatureDraft) => void
) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<TabDraftStatus>("loading");
  const serialized = useMemo(() => JSON.stringify(draft), [draft]);
  const current = useRef({ draft, serialized, onRestore });
  current.current = { draft, serialized, onRestore };
  const mounted = useRef(false);
  const hydrated = useRef(false);
  const saved = useRef<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstUnsavedAt = useRef<number | null>(null);
  const request = useRef(0);
  const write = useRef(0);
  const savedWrite = useRef(0);
  const inFlight = useRef<{ key: string; result: Promise<void> } | null>(null);

  const clearPending = useCallback(() => {
    if (pending.current !== undefined) clearTimeout(pending.current);
    pending.current = undefined;
  }, []);

  const flush = useCallback((): Promise<void> => {
    clearPending();
    if (!hydrated.current) return Promise.resolve();
    const { draft: value, serialized: key } = current.current;
    if (inFlight.current?.key === key) return inFlight.current.result;
    if (!inFlight.current && saved.current === key) {
      firstUnsavedAt.current = null;
      if (mounted.current)
        setStatus((value) =>
          value === "saving" || value === "writeError" ? "saved" : value
        );
      return Promise.resolve();
    }
    const generation = ++write.current;
    firstUnsavedAt.current = null;
    if (mounted.current) setStatus("saving");
    const result = writeTablatureDraft(value).then(
      () => {
        // An earlier queued write can commit even when a newer one fails.
        // Track what is actually on disk before updating the latest UI status.
        if (generation >= savedWrite.current) {
          savedWrite.current = generation;
          saved.current = key;
        }
        if (generation !== write.current) return;
        inFlight.current = null;
        if (mounted.current && current.current.serialized === key)
          setStatus("saved");
      },
      () => {
        if (generation !== write.current) return;
        inFlight.current = null;
        if (mounted.current) setStatus("writeError");
      }
    );
    inFlight.current = { key, result };
    return result;
  }, [clearPending]);

  const restore = useCallback(() => {
    const generation = ++request.current;
    hydrated.current = false;
    clearPending();
    setReady(false);
    setStatus("loading");
    void readTablatureDraft().then(
      (stored) => {
        if (!mounted.current || generation !== request.current) return;
        if (stored) current.current.onRestore(stored);
        saved.current = stored
          ? JSON.stringify(stored)
          : current.current.serialized;
        hydrated.current = true;
        setReady(true);
        setStatus(stored ? "restored" : "saved");
      },
      () => {
        if (mounted.current && generation === request.current)
          setStatus("readError");
      }
    );
  }, [clearPending]);

  // A corrupt or unavailable draft is never silently replaced on startup.
  const startNew = useCallback(async () => {
    if (hydrated.current) return;
    const generation = ++request.current;
    setStatus("loading");
    try {
      await writeTablatureDraft(null);
      if (!mounted.current || generation !== request.current) return;
      saved.current = current.current.serialized;
      hydrated.current = true;
      setReady(true);
      setStatus("saved");
    } catch {
      if (mounted.current && generation === request.current)
        setStatus("readError");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    restore();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flush();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      void flush();
    };
  }, [flush, restore]);

  useEffect(() => {
    if (!ready) return;
    if (serialized === saved.current && !inFlight.current) {
      firstUnsavedAt.current = null;
      setStatus((value) =>
        value === "saving" || value === "writeError" ? "saved" : value
      );
      return;
    }
    setStatus("saving");
    if (active) {
      firstUnsavedAt.current ??= Date.now();
      // Continuous playing must still checkpoint without waiting for silence.
      const delay = Math.max(
        0,
        Math.min(500, 2000 - (Date.now() - firstUnsavedAt.current))
      );
      pending.current = setTimeout(() => void flush(), delay);
    } else void flush();
    return clearPending;
  }, [active, clearPending, flush, ready, serialized]);

  return {
    ready,
    status,
    retry: () => {
      if (hydrated.current) void flush();
      else restore();
    },
    startNew
  };
}
