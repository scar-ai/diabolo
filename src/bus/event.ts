import * as z from "zod";

export namespace BusEvent {
  export type Definition = ReturnType<typeof define>;

  const registry = new Map<string, Definition>();

  export function define<Type extends string, Properties extends z.ZodType>(
    type: Type,
    properties: Properties,
  ) {
    const result = { properties, type };
    registry.set(type, result);
    return result;
  }

  export function payloads() {
    const entries = [...registry.entries()].map(([type, def]) =>
      z
        .object({
          properties: def.properties,
          type: z.literal(type),
        })
        .meta({ ref: `Event.${def.type}` }),
    );

    return z
      .discriminatedUnion("type", entries as [(typeof entries)[number], ...typeof entries])
      .meta({
        ref: "Event",
      });
  }
}
