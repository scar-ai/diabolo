export type JobStore<TValue> = {
  get: (key: string) => TValue | undefined;
  set: (key: string, value: TValue) => void;
};

export const createInMemoryJobStore = <TValue>(): JobStore<TValue> => {
  const store = new Map<string, TValue>();

  return {
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
    },
  };
};
