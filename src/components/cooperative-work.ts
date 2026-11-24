/** Let input and paint run between bounded pieces of non-transactional work. */
export function cooperativeWork(
  nextTurn = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    })
) {
  let deadline = Date.now() + 4;
  let units = 0;
  return (): Promise<void> | undefined => {
    if (++units < 16 && Date.now() < deadline) return;
    return nextTurn().then(() => {
      deadline = Date.now() + 4;
      units = 0;
    });
  };
}
