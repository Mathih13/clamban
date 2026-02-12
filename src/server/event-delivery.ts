export interface EventDeliveryOptions {
  /** Action to invoke on each delivery attempt */
  action: () => void | Promise<void>;
  /** Max retries before giving up. Default: 3 */
  maxRetries?: number;
  /** Base delay between retries in ms (exponential backoff). Default: 500 */
  baseDelayMs?: number;
  /** Called after all retries are exhausted */
  onExhausted?: (attempts: number, error?: unknown) => void;
  /** Called on each successful delivery */
  onDelivered?: () => void;
  /** Confirmation predicate — if provided, delivery is only confirmed when this returns true */
  confirm?: () => boolean | Promise<boolean>;
}

export interface EventDelivery {
  /** Attempt delivery with retry logic. Resolves true if confirmed, false if exhausted. */
  deliver(): Promise<boolean>;
  /** Number of deliveries successfully confirmed */
  readonly deliveredCount: number;
  /** Number of deliveries that exhausted retries */
  readonly failedCount: number;
}

export function createEventDelivery(options: EventDeliveryOptions): EventDelivery {
  const {
    action,
    maxRetries = 3,
    baseDelayMs = 500,
    onExhausted,
    onDelivered,
    confirm,
  } = options;

  let deliveredCount = 0;
  let failedCount = 0;

  async function deliver(): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await action();

        // If no confirmation predicate, treat action success as confirmed
        if (!confirm) {
          deliveredCount++;
          onDelivered?.();
          return true;
        }

        const confirmed = await confirm();
        if (confirmed) {
          deliveredCount++;
          onDelivered?.();
          return true;
        }
      } catch (err) {
        if (attempt === maxRetries) {
          failedCount++;
          onExhausted?.(attempt + 1, err);
          return false;
        }
      }

      // Exponential backoff before retry
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    failedCount++;
    onExhausted?.(maxRetries + 1);
    return false;
  }

  return {
    deliver,
    get deliveredCount() { return deliveredCount; },
    get failedCount() { return failedCount; },
  };
}
