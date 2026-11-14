export function guitarLayout(width: number, height: number) {
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
  const scale = landscape
    ? Math.max(width / source.width, (height * 0.84) / 560)
    : Math.max(width / source.width, height / source.height);
  const artWidth = source.width * scale;
  const artHeight = source.height * scale;
  const left = landscape
    ? width / 2 - (source.hole.x + source.hole.width / 2) * scale
    : (width - artWidth) / 2;
  const top = landscape
    ? height / 2 - (source.hole.y + source.hole.height / 2) * scale
    : height - artHeight;
  return {
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
