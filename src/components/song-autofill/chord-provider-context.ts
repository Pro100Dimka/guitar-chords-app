import type { DomHandler, DomUtils } from "htmlparser2";

// New providers share the existing request limits, cooldowns and identity
// checks without importing the lookup coordinator at runtime.
export interface ChordProviderContext {
  fetchSource(
    url: string,
    signal?: AbortSignal,
    timeout?: number,
    form?: URLSearchParams
  ): Promise<string | null>;
  parseSource(html: string, signal?: AbortSignal): Promise<DomHandler["root"]>;
  sourceBody(
    body: Parameters<typeof DomUtils.getChildren>[0],
    inlineChords: boolean,
    signal?: AbortSignal
  ): Promise<string>;
  normalizeSourceText(text: string, signal?: AbortSignal): Promise<string>;
  sourceWork(signal?: AbortSignal): () => void | Promise<void>;
  matchingIdentity(expected: string, actual: string): boolean;
  sameArtist(expected: string, actual: string): boolean;
  trackTitle(value: string): string;
  primaryArtist(value: string): string;
}
