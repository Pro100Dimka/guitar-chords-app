export const MIN_GUITAR_ZOOM = 1;
export const MAX_GUITAR_ZOOM = 1.5;

export function guitarLayout(
  width: number,
  height: number,
  zoom?: number,
  complete = false
) {
  const landscape = width > height;
  const source = complete
    ? {
        width: 887,
        height: 1774,
        hole: { x: 320, y: 1120, width: 232, height: 225 },
        stringLeft: 302,
        stringWidth: 267,
        stringBottom: 1592
      }
    : landscape
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
  const baseScale = complete
    ? Math.min(
        landscape
          ? Math.max(width / 1400, height / 600)
          : Math.max(width / 650, height / 1250),
        Math.min(width / source.width, height / source.height) / 0.3
      )
    : landscape
      ? Math.max(width / source.width, (height * 0.84) / 560)
      : Math.max(width / source.width, height / source.height);
  const center = complete
    ? source.width / 2
    : landscape
      ? source.hole.x + source.hole.width / 2
      : source.width / 2;
  const outerString = Math.max(
    center - source.stringLeft,
    source.stringLeft + source.stringWidth - center
  );
  // Leave room for the outer strings' labels and touch targets. A very narrow
  // stage gets a fitted 100% baseline instead of an unreachable sixth string.
  // Keep the tuner dial visible as well as its outer string labels.
  const outerDial = Math.max(
    center - source.hole.x,
    source.hole.x + source.hole.width - center
  );
  const dialScale =
    zoom === undefined && !complete
      ? Math.min(
          Math.max(1, width / 2 - 8) / outerDial,
          landscape
            ? Math.max(1, height - 16) / source.hole.height
            : Math.max(1, height - 8) / (source.height - source.hole.y)
        )
      : Infinity;
  const fittedScale =
    !width || !height || (complete && zoom === undefined)
      ? baseScale
      : Math.min(baseScale, Math.max(1, width / 2 - 26) / outerString, dialScale);
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
  const left = complete
    ? (width - artWidth) / 2
    : landscape
      ? width / 2 - (source.hole.x + source.hole.width / 2) * scale
      : (width - artWidth) / 2;
  const top = complete
    ? Math.min(
        (height - artHeight) / 2,
        height - (source.stringBottom + 56) * scale
      )
    : landscape
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
    stringTop: complete
      ? top + 314 * scale
      : Math.min(
          -height,
          top + source.stringBottom * scale - source.stringWidth * scale * 12
        ),
    stringTopLeft: complete
      ? left + 393 * scale
      : left + source.stringLeft * scale,
    stringTopWidth: complete ? 103 * scale : source.stringWidth * scale,
    stringLeft: left + source.stringLeft * scale,
    stringWidth: source.stringWidth * scale,
    stringBottom: top + source.stringBottom * scale
  };
}

/** The drawn strings and their hit areas use the same nut-to-bridge projection. */
export function guitarStringSpan(
  frame: ReturnType<typeof guitarLayout>,
  y: number
) {
  "worklet";
  const progress = Math.max(
    0,
    Math.min(
      1,
      (y - frame.stringTop) / Math.max(1, frame.stringBottom - frame.stringTop)
    )
  );
  return {
    left:
      frame.stringTopLeft + (frame.stringLeft - frame.stringTopLeft) * progress,
    width:
      frame.stringTopWidth +
      (frame.stringWidth - frame.stringTopWidth) * progress
  };
}
