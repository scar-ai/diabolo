import * as z from "zod";

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType;
  abstract toObject(): { data: unknown; name: string };

  static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({ ref: name });

    const result = class extends NamedError {
      static readonly Schema = schema;

      override readonly name = name;

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions,
      ) {
        super(name, options);
      }

      static isInstance(input: unknown): input is InstanceType<typeof result> {
        return (
          typeof input === "object" && input !== null && "name" in input && input.name === name
        );
      }

      schema() {
        return schema;
      }

      toObject() {
        return { data: this.data, name };
      }
    };

    Object.defineProperty(result, "name", { value: name });

    return result;
  }

  static readonly Unknown = NamedError.create(
    "UnknownError",
    z.object({
      message: z.string(),
    }),
  );
}
