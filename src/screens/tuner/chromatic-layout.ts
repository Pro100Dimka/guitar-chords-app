export function chromaticLayout(width: number, height: number) {
  const landscape = width > height;
  const landscapeDiameter = Math.max(
    80,
    Math.min(width * 0.52, height - 40, 2 * (width * 0.71 - 236))
  );
  // Keep the note panel outside the dial and the right-side audio controls.
  const panelLeft = landscape ? (width * 0.58 + landscapeDiameter) / 2 + 20 : 16;
  const panelWidth = Math.max(16, width - panelLeft - (landscape ? 68 : 16));
  const availableRows = height - (landscape ? 86 : 252);
  // Prefer 44-point touch targets in both dimensions; when the viewport is
  // constrained, choose the grid that maximizes the smaller target dimension.
  let columns = 12;
  let rowHeight = 24;
  let bestTarget = 0;
  for (const count of [12, 6, 4, 3]) {
    const candidateHeight = Math.max(
      24,
      Math.min(44, Math.floor(availableRows / (12 / count)))
    );
    const target = Math.min(44, (panelWidth - 16) / count, candidateHeight);
    if (target > bestTarget) {
      bestTarget = target;
      columns = count;
      rowHeight = candidateHeight;
    }
  }
  const panelHeight = (12 / columns) * rowHeight + 16;
  const diameter = landscape
    ? landscapeDiameter
    : Math.max(80, Math.min(width - 40, height - panelHeight - 156));
  const hole = {
    x: landscape ? (width * 0.58 - diameter) / 2 : (width - diameter) / 2,
    y: landscape
      ? (height - diameter) / 2
      : Math.max(
          64,
          Math.min(
            (height - 160 - diameter) / 2,
            height - diameter - panelHeight - 92
          )
        ),
    width: diameter,
    height: diameter
  };
  const panelTop = landscape
    ? Math.max(0, (height - panelHeight - 62) / 2)
    : hole.y + diameter + 22;
  return {
    hole,
    panelWidth,
    panelHeight,
    panelLeft,
    panelTop,
    columns,
    rowHeight,
    octaveTop: panelTop + panelHeight + 18,
    octaveLeft: panelLeft + panelWidth * 0.15,
    octaveWidth: panelWidth * 0.7
  };
}
