/**
 * Connection / async generation guard (essence from DeepSeek ConnectionController).
 */

export class GenerationGuard {
  private generation = 0;

  /** Start a new generation; returns the token for this generation. */
  bump(): number {
    this.generation += 1;
    return this.generation;
  }

  current(): number {
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  /**
   * Run async work; if generation changed before settle, return undefined
   * (caller must ignore).
   */
  async run<T>(fn: (token: number) => Promise<T>): Promise<T | undefined> {
    const token = this.bump();
    const result = await fn(token);
    if (!this.isCurrent(token)) return undefined;
    return result;
  }
}
