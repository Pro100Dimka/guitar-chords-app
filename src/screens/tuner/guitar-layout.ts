export const MIN_GUITAR_ZOOM = 0.75;
export const MAX_GUITAR_ZOOM = 1.5;

export function guitarLayout(width: number, height: number, zoom?: number) {
  const landscape = width > height;
  const source = landscape
    ? {
        width: 2100,
        height: 749,
        hole: { x: 788, y: 150, width: 486, height: 491 },
        stringLeft: 916,
        stringWidth: 268,
        stringBottom: 900
      }
    : {
        width: 852,
        height: 1846,
        hole: { x: 119, y: 846, width: 592, height: 588 },
        stringLeft: 197,
        stringWidth: 456,
        stringBottom: 1748
      };
  const baseScale = landscape
    ? Math.max(width / source.width, (height * 0.84) / 560)
    : Math.max(width / source.width, height / source.height);
  const center = landscape
    ? source.hole.x + source.hole.width / 2
    : source.width / 2;
  const outerString = Math.max(
    center - source.stringLeft,
    source.stringLeft + source.stringWidth - center
  );
  // Leave room for the outer strings' labels and touch targets. A very narrow
  // stage gets a fitted 100% baseline instead of an unreachable sixth string.
  // The tuner omits zoom and keeps its existing framing.
  const fittedScale =
    zoom === undefined || !width || !height
      ? baseScale
      : Math.min(baseScale, Math.max(1, width / 2 - 26) / outerString);
  const maximumZoom =
    fittedScale > 0 && zoom !== undefined
      ? Math.min(
          MAX_GUITAR_ZOOM,
          Math.max(
            1,
            Math.floor(
              (Math.max(1, width / 2 - 26) / (outerString * fittedScale)) * 100
            ) / 100
          )
        )
      : MAX_GUITAR_ZOOM;
  const effectiveZoom = Math.max(
    MIN_GUITAR_ZOOM,
    Math.min(maximumZoom, Number.isFinite(zoom) ? zoom! : 1)
  );
  const scale = fittedScale * effectiveZoom;
  const artWidth = source.width * scale;
  const artHeight = source.height * scale;
  const left = landscape
    ? width / 2 - (source.hole.x + source.hole.width / 2) * scale
    : (width - artWidth) / 2;
  const top = landscape
    ? height / 2 - (source.hole.y + source.hole.height / 2) * scale
    : height - artHeight;
  return {
    zoom: effectiveZoom,
    maximumZoom,
    artwork: { width: artWidth, height: artHeight, left, top },
    hole: {
      x: left + source.hole.x * scale,
      y: top + source.hole.y * scale,
      width: source.hole.width * scale,
      height: source.hole.height * scale
    },
    stringLeft: left + source.stringLeft * scale,
    stringWidth: source.stringWidth * scale,
    stringBottom: top + source.stringBottom * scale
  };
}
