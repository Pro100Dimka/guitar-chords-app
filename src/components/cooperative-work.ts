/** Let input and paint run between bounded pieces of non-transactional work. */
export function cooperativeWork() {
  let deadline = Date.now() + 4;
  let units = 0;
  return (): Promise<void> | undefined => {
    if (++units < 16 && Date.now() < deadline) return;
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        deadline = Date.now() + 4;
        units = 0;
        resolve();
      }, 0)
    );
  };
}
