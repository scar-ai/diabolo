import * as z from "zod";

import type { BusEvent } from "@/bus/event";
import { GlobalBus } from "@/bus/global";

export namespace Bus {
  export async function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) {
    GlobalBus.emit("event", {
      payload: {
        properties,
        type: def.type,
      },
    });
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { properties: z.output<D["properties"]>; type: D["type"] }) => void,
  ) {
    const listener = (event: { directory?: string; payload: unknown }) => {
      const payload = event.payload as { properties: unknown; type: string };

      if (payload.type !== def.type) {
        return;
      }

      callback(payload as { properties: z.output<D["properties"]>; type: D["type"] });
    };

    GlobalBus.on("event", listener);

    return () => {
      GlobalBus.off("event", listener);
    };
  }

  export function once<D extends BusEvent.Definition>(
    def: D,
    callback: (event: {
      properties: z.output<D["properties"]>;
      type: D["type"];
    }) => "done" | undefined,
  ) {
    const unsubscribe = subscribe(def, (event) => {
      if (callback(event) === "done") {
        unsubscribe();
      }
    });

    return unsubscribe;
  }

  export function subscribeAll(
    callback: (event: { directory?: string; payload: unknown }) => void,
  ) {
    GlobalBus.on("event", callback);

    return () => {
      GlobalBus.off("event", callback);
    };
  }
}
