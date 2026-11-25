import { sourceArrangement } from "../../screens/song/rhythms";

/** Only explicit tempo declarations in the verified arrangement, never page UI. */
export function sourceTempo(text: string): number | undefined {
  const lines = text.normalize("NFKC").split(/\r?\n/);
  const tempos = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].trim();
    if (
      (line.startsWith("{") && line.endsWith("}")) ||
      (line.startsWith("[") && line.endsWith("]"))
    )
      line = line
        .slice(1, -1)
        .trim()
        .replace(/^meta:\s*/i, "");
    const label = line.match(
      /^(?:tempo|bpm|темп|andamento)(?=\s|[:=]|$)\s*[:=]?\s*(.*)$/iu
    );
    const value = label
      ? label[1].trim() || lines[index + 1]?.trim() || ""
      : /^(?:\d+(?:[.,]\d+)?\s*bpm\b|♩\s*=)/iu.test(line)
        ? line
        : undefined;
    if (value === undefined) continue;
    const match = value.match(
      /^(?:♩\s*=\s*)?(\d+(?:[.,]\d+)?)\s*(?:bpm|уд(?:аров)?\.?\s*(?:\/|в)\s*мин(?:уту)?\.?)?$/iu
    );
    const tempo = match ? Number(match[1].replace(",", ".")) : NaN;
    // Do not pick one declaration from a range, unsupported unit or conflict.
    if (!Number.isFinite(tempo) || tempo < 40 || tempo > 200) return;
    tempos.add(Math.round(tempo));
  }
  if (tempos.size === 1) return [...tempos][0];
}

export function sourceMetadata(text: string) {
  const tempo = sourceTempo(text);
  const rhythm = sourceArrangement(text);
  return {
    ...(tempo !== undefined ? { tempo } : {}),
    ...(rhythm ? { rhythm } : {})
  };
}
