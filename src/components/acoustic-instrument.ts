import { acousticBank, recordedChordFrets } from "./acoustic-player";

type Note = { frequency: number; string: number };
export interface AcousticInstrument {
  chords: string[];
  frequencies: Note[][];
  previewKeys: string[];
  preview: boolean;
}

const messageSize = 64 * 1024;
const tuning = [40, 45, 50, 55, 59, 64];
const recordingOrder = Object.values(recordedChordFrets).map((frets) =>
  frets
    .flatMap((fret, string) =>
      fret === null ? [] : [`${string}:${tuning[string] + fret}`]
    )
    .join(",")
);

function nextTurn(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve(!signal.aborted);
    };
    const timer = setTimeout(finish, 0);
    signal.addEventListener("abort", finish, { once: true });
  });
}

// Build one voicing at a time and never join the complete multi-megabyte
// instrument on React Native's JS thread. The WebView assembles the chunks.
export async function prepareAcousticInstrument(
  instrument: AcousticInstrument,
  signal: AbortSignal
): Promise<string[] | undefined> {
  if (!(await nextTurn(signal))) return;
  const { frequencies, preview } = instrument;
  let bank: ReturnType<typeof acousticBank> | undefined;
  const samples = new Map<
    string,
    ReturnType<typeof acousticBank>["samples"][number]
  >();
  const recordings = new Map<
    string,
    ReturnType<typeof acousticBank>["recordings"][number]
  >();
  const seen = new Set<string>();
  let started = Date.now();
  for (const group of frequencies) {
    if (signal.aborted) return;
    const key = JSON.stringify(group);
    if (!seen.has(key)) {
      seen.add(key);
      bank = acousticBank(group, [group], preview);
      bank.samples.forEach((sample) =>
        samples.set(`${sample.string}:${sample.midi}`, sample)
      );
      bank.recordings.forEach((recording) =>
        recordings.set(recording.key, recording)
      );
      // Loading a recorded voicing can evaluate an asset module for the first
      // time. Give touches/navigation a turn before loading another one.
      if (!(await nextTurn(signal))) return;
      started = Date.now();
    } else if (Date.now() - started >= 4) {
      if (!(await nextTurn(signal))) return;
      started = Date.now();
    }
  }
  bank ??= acousticBank([], [], preview);
  const chunks: string[] = [];
  let pending = "";
  const append = (text: string) => {
    let offset = 0;
    while (offset < text.length) {
      const take = Math.min(messageSize - pending.length, text.length - offset);
      pending += text.slice(offset, offset + take);
      offset += take;
      if (pending.length === messageSize) {
        chunks.push(pending);
        pending = "";
      }
    }
  };
  const checkpoint = async () => {
    if (signal.aborted) return false;
    if (Date.now() - started < 4) return true;
    if (!(await nextTurn(signal))) return false;
    started = Date.now();
    return true;
  };
  const array = async (values: unknown[]) => {
    append("[");
    for (let index = 0; index < values.length; index++) {
      if (index) append(",");
      append(JSON.stringify(values[index]));
      if (!(await checkpoint())) return false;
    }
    append("]");
    return true;
  };
  append('{"chords":');
  if (!(await array(instrument.chords))) return;
  append(',"frequencies":');
  if (!(await array(frequencies))) return;
  append(',"previewKeys":');
  if (!(await array(instrument.previewKeys))) return;
  append(',"bank":{"samples":');
  if (!(await array([...samples.values()]))) return;
  append(',"impulse":');
  append(JSON.stringify(bank.impulse));
  if (!(await checkpoint())) return;
  append(',"wetGain":' + JSON.stringify(bank.wetGain));
  append(',"recordings":[');
  let count = 0;
  for (const key of recordingOrder) {
    const recording = recordings.get(key);
    if (!recording) continue;
    if (count++) append(",");
    append('{"key":' + JSON.stringify(key) + ',"down":');
    if (!(await array(recording.down))) return;
    append(',"up":');
    if (!(await array(recording.up))) return;
    append("}");
  }
  append("]}}");
  if (signal.aborted) return;
  if (pending) chunks.push(pending);
  return chunks;
}

export async function transferAcousticInstrument(
  chunks: string[],
  token: number,
  inject: (script: string) => void,
  signal: AbortSignal
) {
  if (signal.aborted) return;
  inject(`window.beginInstrument(${token});true;`);
  for (let index = 0; index < chunks.length; ) {
    if (!(await nextTurn(signal))) return;
    const started = Date.now();
    let batch = 0;
    do {
      inject(
        `window.appendInstrument(${token},${JSON.stringify(chunks[index++])});true;`
      );
    } while (
      index < chunks.length &&
      ++batch < 4 &&
      Date.now() - started < 4 &&
      !signal.aborted
    );
  }
  if (!signal.aborted) inject(`window.finishInstrument(${token});true;`);
}
