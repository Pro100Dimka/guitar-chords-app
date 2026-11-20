import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { warmGuitar } from "../../components/guitar-audio";
import { performanceAudio } from "../../components/performance-audio";
import {
  emptyTablature,
  normalizeTablature,
  tablatureLength,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  TAB_TUNING,
  TabNote,
  Tablature
} from "../../components/tablature";

export type TabRange = { start: number; end: number };
type Status = "idle" | "preparing" | "playing" | "recording";
interface Snapshot {
  tab: Tablature;
  status: Status;
  tick: number;
  error: string | null;
  speed: number;
  loop: boolean;
  range: TabRange | null;
}
const clock = globalThis as typeof globalThis & {
  performance: { now: () => number };
};
const now = () => clock.performance.now();
const keyFor = (note: TabNote) =>
  `440:${TAB_TUNING[note.string] + note.fret}:string${note.string}`;
// Native sample caches hold 32 keys. Leave space for the six live strings.
const WINDOW_KEYS = 12;

export class TablatureTransport {
  private state: Snapshot = {
    tab: emptyTablature(),
    status: "idle",
    tick: 0,
    error: null,
    speed: 1,
    loop: false,
    range: null
  };
  private listeners = new Set<() => void>();
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private position = 0;
  private clock = { time: 0, tick: 0 };
  private recordStart: number | undefined;
  private cursor = 0;
  private consumedTick = -1;
  private ready = new Set<string>();
  private warming: Promise<void> | undefined;

  constructor(private onNotes: (notes: TabNote[]) => void) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private bounds(): TabRange {
    return (
      this.state.range ?? { start: 0, end: tablatureLength(this.state.tab) }
    );
  }
  private rate() {
    return (
      (this.state.tab.tempo * this.state.speed * TAB_TICKS_PER_BEAT) / 60000
    );
  }
  private currentPosition() {
    return this.state.status === "playing"
      ? this.clock.tick + (now() - this.clock.time) * this.rate()
      : this.position;
  }
  private cancel() {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    this.warming = undefined;
    if (["playing", "preparing"].includes(this.state.status)) {
      for (let string = 0; string < 6; string++)
        performanceAudio.stopGuitarString(string);
      this.onNotes([]);
    }
  }
  setActive = (active: boolean) => {
    this.active = active;
    if (!active) this.pause();
  };
  setTab = (value: Tablature) => {
    const tab = normalizeTablature(value);
    if (!tab) {
      this.update({ error: "TabInvalidData" });
      return;
    }
    this.cancel();
    this.position = 0;
    this.consumedTick = -1;
    this.recordStart = undefined;
    this.update({ tab, range: null, tick: 0, status: "idle", error: null });
  };
  pause = () => {
    if (this.state.status === "recording") {
      this.stopRecording();
      return;
    }
    const bounds = this.bounds();
    const position = this.currentPosition();
    if (this.state.loop && position >= bounds.end)
      this.consumedTick = bounds.start - 1;
    this.position =
      this.state.loop && position >= bounds.end
        ? bounds.start +
          ((position - bounds.start) % (bounds.end - bounds.start))
        : Math.min(bounds.end, position);
    this.cancel();
    this.update({ status: "idle", tick: Math.floor(this.position) });
  };
  rewind = () => {
    this.pause();
    this.position = this.bounds().start;
    this.consumedTick = this.position - 1;
    this.update({ tick: this.position });
  };
  setSpeed = (speed: number) => {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 2) return;
    const resume = ["preparing", "playing"].includes(this.state.status);
    if (resume) this.pause();
    this.update({ speed });
    if (resume) void this.play();
  };
  setLoop = (loop: boolean) => this.update({ loop });
  setRange = (range: TabRange | null) => {
    if (
      range &&
      (!Number.isInteger(range.start) ||
        !Number.isInteger(range.end) ||
        range.start < 0 ||
        range.end > tablatureLength(this.state.tab) ||
        range.start >= range.end)
    ) {
      this.update({ error: "TabInvalidRange" });
      return;
    }
    const resume = ["preparing", "playing"].includes(this.state.status);
    this.pause();
    this.update({ range: range && { ...range }, error: null });
    const bounds = this.bounds();
    this.position = bounds.start;
    this.consumedTick = bounds.start - 1;
    this.update({ tick: Math.floor(this.position) });
    if (resume) void this.play();
  };

  private window() {
    const { notes } = this.state.tab;
    const bounds = this.bounds();
    const desired = new Map<string, TabNote>();
    const add = (start: number) => {
      for (let i = start; i < notes.length && desired.size < WINDOW_KEYS; i++) {
        const note = notes[i];
        if (note.tick >= bounds.end) break;
        if (note.tick >= bounds.start) desired.set(keyFor(note), note);
      }
    };
    add(this.cursor);
    if (this.state.loop && desired.size < WINDOW_KEYS) add(0);
    return desired;
  }
  private prepare(signal: AbortSignal, generation: number) {
    if (this.warming) return this.warming;
    const desired = this.window();
    this.ready.forEach((key) => {
      if (!desired.has(key)) this.ready.delete(key);
    });
    const work = (async () => {
      for (const [key, note] of desired) {
        if (signal.aborted || generation !== this.generation) return;
        if (this.ready.has(key)) continue;
        await warmGuitar(
          [TAB_TUNING[note.string] + note.fret],
          440,
          signal,
          note.string
        );
        if (signal.aborted || generation !== this.generation) return;
        this.ready.add(key);
      }
    })();
    this.warming = work;
    void work
      .finally(() => {
        if (this.warming === work) this.warming = undefined;
      })
      .catch(() => {});
    return work;
  }
  private fail = (error = "TabPlaybackFailed") => {
    this.pause();
    this.update({ error });
  };
  private begin = async (position: number) => {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.position = position;
    this.cursor = this.state.tab.notes.findIndex(
      (note) => note.tick >= position && note.tick > this.consumedTick
    );
    if (this.cursor < 0) this.cursor = this.state.tab.notes.length;
    this.ready.clear();
    this.update({
      status: "preparing",
      tick: Math.floor(position),
      error: null
    });
    try {
      await this.prepare(controller.signal, generation);
      if (
        !this.active ||
        controller.signal.aborted ||
        generation !== this.generation
      )
        return;
      for (let string = 0; string < 6; string++)
        performanceAudio.stopGuitarString(string);
      this.clock = { time: now(), tick: position };
      this.update({ status: "playing" });
      this.advance();
    } catch {
      if (generation === this.generation && !controller.signal.aborted)
        this.fail();
    }
  };
  play = async () => {
    if (!this.active || ["playing", "preparing"].includes(this.state.status))
      return;
    if (this.state.status === "recording") this.stopRecording();
    if (!this.state.tab.notes.length) {
      this.update({ error: "TabEmpty" });
      return;
    }
    const bounds = this.bounds();
    if (this.position < bounds.start || this.position >= bounds.end) {
      this.position = bounds.start;
      this.consumedTick = bounds.start - 1;
    }
    await this.begin(this.position);
  };
  private soundUntil(position: number, end: number) {
    const { notes } = this.state.tab;
    // Discard missed events after a stalled JS frame instead of sounding a burst.
    const cutoff = position - 100 * this.rate();
    const sounded: TabNote[] = [];
    while (this.cursor < notes.length) {
      const first = notes[this.cursor];
      if (first.tick > position || first.tick >= end) break;
      const group: TabNote[] = [];
      while (
        this.cursor < notes.length &&
        notes[this.cursor].tick === first.tick
      )
        group.push(notes[this.cursor++]);
      if (first.tick < cutoff) {
        this.consumedTick = first.tick;
        continue;
      }
      if (group.some((note) => !this.ready.has(keyFor(note)))) {
        if (sounded.length) this.onNotes(sounded);
        void this.begin(first.tick);
        return false;
      }
      try {
        group.forEach((note) =>
          performanceAudio.guitarString(keyFor(note), note.string)
        );
      } catch {
        this.fail();
        return false;
      }
      this.consumedTick = first.tick;
      sounded.push(...group);
    }
    if (sounded.length) this.onNotes(sounded);
    return true;
  }
  private advance = () => {
    if (!this.active || this.state.status !== "playing") return;
    const bounds = this.bounds();
    let position = this.currentPosition();
    if (!this.soundUntil(position, bounds.end)) return;
    if (position >= bounds.end) {
      if (!this.state.loop) {
        this.position = bounds.end;
        this.cancel();
        this.update({ status: "idle", tick: bounds.end });
        return;
      }
      position =
        bounds.start +
        ((position - bounds.start) % (bounds.end - bounds.start));
      this.clock = { time: now(), tick: position };
      this.cursor = this.state.tab.notes.findIndex(
        (note) => note.tick >= bounds.start
      );
      if (this.cursor < 0) this.cursor = this.state.tab.notes.length;
      this.consumedTick = bounds.start - 1;
      for (let string = 0; string < 6; string++)
        performanceAudio.stopGuitarString(string);
      if (!this.soundUntil(position, bounds.end)) return;
    }
    this.position = position;
    const tick = Math.floor(position);
    if (tick !== this.state.tick) this.update({ tick });
    const controller = this.controller;
    const generation = this.generation;
    if (controller)
      void this.prepare(controller.signal, generation).catch(() => {
        if (generation === this.generation && !controller.signal.aborted)
          this.fail();
      });
    this.timer = setTimeout(this.advance, 25);
  };

  startRecording = () => {
    if (!this.active) return;
    this.cancel();
    this.recordStart = undefined;
    this.position = 0;
    this.consumedTick = -1;
    this.update({
      tab: emptyTablature(this.state.tab.tempo, this.state.tab.beatsPerBar),
      range: null,
      tick: 0,
      status: "recording",
      error: null
    });
  };
  private recordProgress = () => {
    if (this.state.status !== "recording" || this.recordStart === undefined)
      return;
    const { tempo, beatsPerBar } = this.state.tab;
    this.position =
      ((now() - this.recordStart) * tempo * TAB_TICKS_PER_BEAT) / 60000;
    if (this.position >= TAB_MAX_BARS * beatsPerBar * TAB_TICKS_PER_BEAT) {
      this.stopRecording();
      this.update({ error: "TabRecordingLimit" });
      return;
    }
    this.update({ tick: Math.floor(this.position) });
    this.timer = setTimeout(this.recordProgress, 50);
  };
  capture = (notes: Array<{ string: number; fret: number }>) => {
    if (!this.active || this.state.status !== "recording") return;
    const timestamp = now();
    const valid = notes.filter(
      (note) =>
        Number.isInteger(note.string) &&
        note.string >= 0 &&
        note.string < 6 &&
        Number.isInteger(note.fret) &&
        note.fret >= 0 &&
        note.fret <= 24
    );
    if (!valid.length) return;
    if (this.recordStart === undefined) {
      this.recordStart = timestamp;
      this.timer = setTimeout(this.recordProgress, 50);
    }
    const tab = this.state.tab;
    const tick = Math.round(
      ((timestamp - this.recordStart) * tab.tempo * TAB_TICKS_PER_BEAT) / 60000
    );
    if (tick >= TAB_MAX_BARS * tab.beatsPerBar * TAB_TICKS_PER_BEAT) {
      this.stopRecording();
      this.update({ error: "TabRecordingLimit" });
      return;
    }
    const simultaneous = new Map<number, TabNote>();
    const recorded = tab.notes.filter((note) => {
      if (note.tick !== tick) return true;
      simultaneous.set(note.string, note);
      return false;
    });
    valid.forEach((note) => simultaneous.set(note.string, { ...note, tick }));
    recorded.push(
      ...[...simultaneous.values()].sort((a, b) => a.string - b.string)
    );
    if (recorded.length > TAB_MAX_NOTES) {
      this.stopRecording();
      this.update({ error: "TabRecordingLimit" });
      return;
    }
    this.position = tick;
    this.update({ tab: { ...tab, notes: recorded }, tick });
  };
  stopRecording = () => {
    if (this.state.status !== "recording") return;
    this.cancel();
    this.recordStart = undefined;
    this.position = 0;
    this.consumedTick = -1;
    this.update({ status: "idle", tick: 0 });
  };
}

export function useTablature(
  active: boolean,
  onNotes: (notes: TabNote[]) => void
) {
  const listener = useRef(onNotes);
  listener.current = onNotes;
  const [transport] = useState(
    () => new TablatureTransport((notes) => listener.current(notes))
  );
  const snapshot = useSyncExternalStore(
    transport.subscribe,
    transport.getSnapshot,
    transport.getSnapshot
  );
  useEffect(() => {
    transport.setActive(active);
    return () => transport.setActive(false);
  }, [active, transport]);
  return {
    ...snapshot,
    setTab: transport.setTab,
    play: transport.play,
    pause: transport.pause,
    rewind: transport.rewind,
    startRecording: transport.startRecording,
    stopRecording: transport.stopRecording,
    capture: transport.capture,
    setSpeed: transport.setSpeed,
    setLoop: transport.setLoop,
    setRange: transport.setRange
  };
}
