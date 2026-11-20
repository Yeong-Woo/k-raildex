/** 뒤쪽 디바운스: 마지막 호출 뒤 waitMs 동안 조용하면 fn 을 한 번 부른다(maxWaitMs 가 지나면 강제로) */
export class Debouncer {
  private timer: NodeJS.Timeout | null = null;
  private firstAt: number | null = null;
  private pending = 0;

  constructor(
    private readonly fn: (count: number) => void | Promise<void>,
    private readonly waitMs: number,
    private readonly maxWaitMs = waitMs * 10,
    private readonly now: () => number = Date.now,
  ) {}

  trigger(): void {
    this.pending++;
    this.firstAt ??= this.now();
    if (this.timer) clearTimeout(this.timer);
    const elapsed = this.now() - this.firstAt;
    const wait = Math.max(0, Math.min(this.waitMs, this.maxWaitMs - elapsed));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const n = this.pending;
    this.pending = 0;
    this.firstAt = null;
    if (n > 0) void Promise.resolve(this.fn(n)).catch((e: unknown) => console.error('[debounce]', e));
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = 0;
    this.firstAt = null;
  }
}
