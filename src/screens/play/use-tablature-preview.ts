import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import {
  guitarNoteKey,
  tabNoteExpression,
  warmGuitar
} from "../../components/guitar-audio";
import { performanceAudio } from "../../components/performance-audio";
import { TAB_TUNING, TabNote } from "../../components/tablature";

/** Audition successful note edits without changing the score or transport. */
export function useTablaturePreview(
  enabled: boolean,
  tempo = 80,
  tuning: readonly number[] = TAB_TUNING
) {
  const context = useMemo(
    () => ({ enabled, tempo, tuning }),
    [enabled, tempo, tuning]
  );
  const liveContext = useRef<typeof context | null>(null);
  const foreground = useRef(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive"
  );
  const pending = useRef<AbortController | null>(null);
  const soundingStrings = useRef<number[]>([]);

  const abortPending = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
  }, []);
  const relinquish = useCallback(() => {
    abortPending();
    // Shared string voices may already belong to playback by the time React
    // runs cleanup. Only an explicit cancellation before handoff may stop one.
    soundingStrings.current = [];
  }, [abortPending]);

  useLayoutEffect(() => {
    liveContext.current = context;
    return () => {
      liveContext.current = null;
      relinquish();
    };
  }, [context, relinquish]);
  useLayoutEffect(() => {
    const appState = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (!foreground.current) relinquish();
    });
    const audio = performanceAudio.listen((event) => {
      if (
        event.state === "playbackInterrupted" ||
        event.state === "interrupted"
      )
        relinquish();
    });
    return () => {
      appState.remove();
      audio.remove();
    };
  }, [relinquish]);

  const cancelPreview = useCallback(() => {
    if (liveContext.current !== context) return;
    abortPending();
    soundingStrings.current.forEach((string) =>
      performanceAudio.stopGuitarString(string)
    );
    soundingStrings.current = [];
  }, [abortPending, context]);

  const preview = useCallback(
    (notes: TabNote | TabNote[]) => {
      const chord = (Array.isArray(notes) ? notes : [notes]).filter(
        ({ string, fret }) =>
          Number.isInteger(string) &&
          string >= 0 &&
          string < TAB_TUNING.length &&
          Number.isInteger(fret) &&
          fret >= 0 &&
          fret <= 24
      );
      if (
        liveContext.current !== context ||
        !context.enabled ||
        !foreground.current ||
        !chord.length
      )
        return;

      abortPending();
      const request = new AbortController();
      pending.current = request;
      const current = () =>
        !request.signal.aborted &&
        pending.current === request &&
        liveContext.current === context &&
        foreground.current;
      void (async () => {
        // A native cache probe avoids synthesizing or resending a prepared WAV.
        // Never assume JS cache residency means the bounded native cache is warm.
        await Promise.all(
          chord.map(async (note) => {
            const key = guitarNoteKey(note, tempo, tuning);
            const ready =
              performanceAudio.preparedFingeringSupported &&
              (await performanceAudio.prepareFingering(key, ""));
            if (!current() || ready) return;
            await warmGuitar(
              [tuning[note.string] + note.fret],
              440,
              request.signal,
              note.string,
              tabNoteExpression(note, tempo)
            );
          })
        );
        if (!current()) return;
        soundingStrings.current.forEach((string) =>
          performanceAudio.stopGuitarString(string)
        );
        chord.forEach((note) =>
          performanceAudio.guitarString(
            guitarNoteKey(note, tempo, tuning),
            note.string
          )
        );
        soundingStrings.current = chord.map((note) => note.string);
      })()
        .catch(() => {
          // A failed audition must not reject the edit or prevent the next tap.
        })
        .finally(() => {
          if (pending.current === request) pending.current = null;
        });
    },
    [abortPending, context, tempo, tuning]
  );

  return { preview, cancelPreview };
}
