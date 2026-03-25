import * as z from "zod";

import { Identifier } from "@/id/id";

type Brand<Name extends string> = string & { readonly __brand: Name };

const defineId = <Name extends string, Prefix extends keyof typeof Identifier.prefixes>(
  _name: Name,
  prefix: Prefix,
) => ({
  ascending: (id?: string) => Identifier.ascending(prefix, id) as Brand<Name>,
  descending: (id?: string) => Identifier.descending(prefix, id) as Brand<Name>,
  make: (id: string) => id as Brand<Name>,
  zod: Identifier.schema(prefix).transform((id) => id as Brand<Name>),
});

export const ProjectID = defineId("ProjectID", "project");
export type ProjectID = Brand<"ProjectID">;

export const TaskID = defineId("TaskID", "task");
export type TaskID = Brand<"TaskID">;

export const TaskMessageID = defineId("TaskMessageID", "taskMessage");
export type TaskMessageID = Brand<"TaskMessageID">;
