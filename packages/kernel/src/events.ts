export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export type WaterfallNext<T> = (payload: T) => Promise<T>;

export type WaterfallHandler<T = unknown> = (
  payload: T,
  next: WaterfallNext<T>,
) => Promise<T>;

export interface EventBus {
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  emit<T = unknown>(event: string, payload: T): Promise<void>;
  onWaterfall<T = unknown>(
    event: string,
    handler: WaterfallHandler<T>,
  ): () => void;
  /** Handlers must call next(); failing to call next rejects. */
  waterfall<T = unknown>(event: string, payload: T): Promise<T>;
  onSerial<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  /** Run listeners in registration order; no next(). */
  serial<T = unknown>(event: string, payload: T): Promise<void>;
}

export function createEventBus(): EventBus {
  const plain = new Map<string, Set<EventHandler>>();
  const waterfalls = new Map<string, WaterfallHandler[]>();
  const serials = new Map<string, EventHandler[]>();

  return {
    on<T>(event: string, handler: EventHandler<T>): () => void {
      let set = plain.get(event);
      if (!set) {
        set = new Set();
        plain.set(event, set);
      }
      set.add(handler as EventHandler);
      return () => {
        set?.delete(handler as EventHandler);
      };
    },

    async emit<T>(event: string, payload: T): Promise<void> {
      const set = plain.get(event);
      if (!set) return;
      for (const handler of [...set]) {
        await handler(payload);
      }
    },

    onWaterfall<T>(event: string, handler: WaterfallHandler<T>): () => void {
      let list = waterfalls.get(event);
      if (!list) {
        list = [];
        waterfalls.set(event, list);
      }
      list.push(handler as WaterfallHandler);
      return () => {
        const idx = list?.indexOf(handler as WaterfallHandler) ?? -1;
        if (idx >= 0) list?.splice(idx, 1);
      };
    },

    async waterfall<T>(event: string, payload: T): Promise<T> {
      const list = waterfalls.get(event) ?? [];
      let index = -1;

      const dispatch = async (current: T): Promise<T> => {
        index += 1;
        if (index >= list.length) {
          return current;
        }
        const handler = list[index];
        if (!handler) {
          return current;
        }
        let nextCalled = false;
        const next: WaterfallNext<T> = async (nextPayload) => {
          if (nextCalled) {
            throw new Error(`waterfall "${event}": next() called more than once`);
          }
          nextCalled = true;
          return dispatch(nextPayload);
        };
        const result = await handler(current, next as WaterfallNext<unknown>);
        if (!nextCalled) {
          throw new Error(
            `waterfall "${event}": handler must call next() (or short-circuit by throwing)`,
          );
        }
        return result as T;
      };

      return dispatch(payload);
    },

    onSerial<T>(event: string, handler: EventHandler<T>): () => void {
      let list = serials.get(event);
      if (!list) {
        list = [];
        serials.set(event, list);
      }
      list.push(handler as EventHandler);
      return () => {
        const idx = list?.indexOf(handler as EventHandler) ?? -1;
        if (idx >= 0) list?.splice(idx, 1);
      };
    },

    async serial<T>(event: string, payload: T): Promise<void> {
      const list = serials.get(event) ?? [];
      for (const handler of list) {
        await handler(payload);
      }
    },
  };
}
