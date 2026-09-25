/** Выполняет задачи строго по одной, в порядке поступления */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /** Когда закончилась последняя задача (мс) */
  lastActivity = 0;

  run<T>(task: () => Promise<T>): Promise<T> {
    const tracked = async () => {
      try {
        return await task();
      } finally {
        this.lastActivity = Date.now();
      }
    };
    const result = this.tail.then(tracked, tracked);
    this.tail = result.catch(() => {});
    return result;
  }
}
