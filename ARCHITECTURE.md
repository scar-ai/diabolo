# TypeScript Project Architecture Guide

Patterns extracted from the opencode codebase, adapted for a new project that uses **Effect everywhere**.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Namespaces](#2-namespaces)
3. [Effect Services](#3-effect-services)
4. [Branded IDs](#4-branded-ids)
5. [Zod & Validation](#5-zod--validation)
6. [Errors](#6-errors)
7. [Event Bus](#7-event-bus)
8. [Database (Drizzle)](#8-database-drizzle)
9. [Logging](#9-logging)
10. [Utilities](#10-utilities)
11. [Config](#11-config)
12. [Testing](#12-testing)

---

## 1. Project Structure

```
src/
├── bus/                  # Event bus (typed pub/sub)
│   ├── event.ts          # BusEvent.define() helper
│   ├── global.ts         # Process-wide EventEmitter
│   └── index.ts          # export namespace Bus { ... }
├── config/
│   └── config.ts         # export namespace Config { ... }
├── db/
│   ├── db.ts             # Database namespace, migrations
│   ├── schema.sql.ts     # Shared column helpers (Timestamps)
│   └── migrate.ts
├── id/
│   └── id.ts             # export namespace Identifier { ... }
├── user/
│   ├── index.ts          # export namespace User { ... }        — main logic
│   ├── schema.ts         # UserID branded type (leaf file)
│   └── user.sql.ts       # Drizzle table definition
├── order/
│   ├── index.ts          # export namespace Order { ... }
│   ├── schema.ts         # OrderID
│   ├── order.sql.ts
│   └── status.ts         # export namespace OrderStatus { ... } — sub-concern
├── util/
│   ├── context.ts         # AsyncLocalStorage wrapper
│   ├── lazy.ts
│   ├── lock.ts            # Read-write lock with `using`
│   ├── signal.ts
│   ├── queue.ts           # AsyncQueue + work()
│   ├── defer.ts           # Disposable cleanup
│   ├── abort.ts           # AbortController helpers
│   ├── timeout.ts
│   └── log.ts             # export namespace Log { ... }
├── error.ts               # NamedError base class
└── index.ts               # Entry point
```

### File naming rules

| File                       | Contains                                            | Example                                     |
| -------------------------- | --------------------------------------------------- | ------------------------------------------- |
| `index.ts`                 | The main namespace for a domain                     | `export namespace User { ... }`             |
| `schema.ts`                | Branded IDs, shared types (leaf file, no namespace) | `export const UserID = ...`                 |
| `*.sql.ts`                 | Drizzle table definitions only                      | `export const UserTable = sqliteTable(...)` |
| `status.ts` / `summary.ts` | Sub-concern gets its own namespace                  | `export namespace OrderStatus { ... }`      |

---

## 2. Namespaces

### Core rules

1. **One namespace per file.** Never merge namespaces across files (even though TS allows it).
2. **The "main" namespace goes in `index.ts`** so consumers get a clean import: `import { User } from "@/user"`.
3. **Sub-concerns get their own namespace in their own file** — `UserStatus`, `UserSummary`, etc.
4. **Shared primitives (IDs, SQL tables) live outside namespaces** as plain exports in leaf files.
5. **No barrel re-exports.** Each namespace is self-contained.

### What goes inside a namespace

```ts
// src/user/index.ts
import z from "zod";
import { Effect, Layer, ServiceMap } from "effect";
import { BusEvent } from "@/bus/event";
import { UserID } from "./schema";
import { UserTable } from "./user.sql";

export namespace User {
  // 1. Zod schemas & types
  export const Info = z
    .object({
      id: UserID.zod,
      name: z.string(),
      email: z.string().email(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "User" });
  export type Info = z.output<typeof Info>;

  // 2. Events (typed bus events)
  export const Event = {
    Created: BusEvent.define("user.created", z.object({ info: Info })),
    Updated: BusEvent.define("user.updated", z.object({ info: Info })),
    Deleted: BusEvent.define("user.deleted", z.object({ id: UserID.zod })),
  };

  // 3. Errors
  export const NotFoundError = NamedError.create("UserNotFoundError", z.object({ id: z.string() }));

  // 4. Effect service interface
  export interface Interface {
    readonly get: (id: UserID) => Effect.Effect<Info, InstanceType<typeof NotFoundError>>;
    readonly create: (input: CreateInput) => Effect.Effect<Info>;
    readonly list: () => Effect.Effect<Info[]>;
  }

  // 5. Service tag
  export class Service extends ServiceMap.Service<Service, Interface>()("@app/User") {}

  // 6. Layer (implementation)
  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const get = Effect.fn("User.get")(function* (id: UserID) {
        // ...implementation
      });
      const create = Effect.fn("User.create")(function* (input: CreateInput) {
        // ...implementation
      });
      const list = Effect.fn("User.list")(function* () {
        // ...implementation
      });
      return Service.of({ get, create, list });
    }),
  );

  // 7. Runtime bridge (async facade)
  const run = makeRunPromise(Service, layer);

  export async function get(id: UserID) {
    return run((svc) => svc.get(id));
  }
  export async function create(input: CreateInput) {
    return run((svc) => svc.create(input));
  }
  export async function list() {
    return run((svc) => svc.list());
  }
}
```

### Why namespaces

- **Single import surface**: `User.get()`, `User.Info`, `User.Event.Created` — no import bloat.
- **Co-location**: types, events, errors, service, and facade all live together.
- **IDE autocomplete**: type `User.` and see everything available.
- **No classes, no `this`**: it's just a bag of functions and types.

---

## 3. Effect Services

### Architecture overview

```
┌──────────────────────────┐
│  Async facade functions  │   ← What external code calls (plain async)
│  User.get(), User.list() │
├──────────────────────────┤
│  makeRunPromise(Service) │   ← Bridge: lazily creates ManagedRuntime
├──────────────────────────┤
│  Layer.effect(Service)   │   ← Implementation wired via Effect layers
├──────────────────────────┤
│  Effect.fn("User.get")   │   ← Named/traced Effect generators
└──────────────────────────┘
```

### Service template

```ts
import { Effect, Layer, ServiceMap } from "effect";

export namespace Foo {
  // 1. Interface — defines the service contract
  export interface Interface {
    readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>;
    readonly list: () => Effect.Effect<FooInfo[]>;
  }

  // 2. Service tag — Effect uses this for dependency injection
  export class Service extends ServiceMap.Service<Service, Interface>()("@app/Foo") {}

  // 3. Layer — the implementation
  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      // Use Effect.fn for named + traced functions
      const get = Effect.fn("Foo.get")(function* (id: FooID) {
        // yield* other effects, access dependencies, etc.
      });

      const list = Effect.fn("Foo.list")(function* () {
        // ...
      });

      return Service.of({ get, list });
    }),
  );

  // 4. Optional: compose layers if you have dependencies
  export const live = layer.pipe(Layer.provide(Bar.layer), Layer.provide(Baz.layer));

  // 5. Runtime bridge
  const run = makeRunPromise(Service, live);

  // 6. Async facade — plain async functions for non-Effect callers
  export async function get(id: FooID) {
    return run((svc) => svc.get(id));
  }
  export async function list() {
    return run((svc) => svc.list());
  }
}
```

### `makeRunPromise` — the bridge

This lazily creates a single `ManagedRuntime` per service and shares layers via a global `memoMap`:

```ts
import { Effect, Layer, ManagedRuntime } from "effect";
import * as ServiceMap from "effect/ServiceMap";

export const memoMap = Layer.makeMemoMapUnsafe();

export function makeRunPromise<I, S, E>(
  service: ServiceMap.Service<I, S>,
  layer: Layer.Layer<I, E>,
) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined;
  return <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) => {
    rt ??= ManagedRuntime.make(layer, { memoMap });
    return rt.runPromise(service.use(fn), options);
  };
}
```

### Effect naming conventions

```ts
// Always name your Effect functions for tracing:
const get = Effect.fn("User.get")(function* (id: UserID) { ... })

// For internal helpers that don't need tracing:
const parse = Effect.fnUntraced(function* (raw: string) { ... })

// Composition uses Effect.gen:
const result = yield* Effect.gen(function* () {
  const user = yield* get(id)
  const orders = yield* Order.list(user.id)
  return { user, orders }
})
```

### Per-instance (scoped) state

When each "project" / "tenant" / "workspace" needs its own copy of a service's state:

```ts
import { InstanceState } from "@/effect/instance-state";

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // ScopedCache keyed by directory — each instance gets its own state
    const cache = yield* InstanceState.make<State>(
      Effect.fn("Foo.state")(function* (ctx) {
        // Initialize per-instance state
        const data = new Map<string, FooInfo>();

        // Subscriptions auto-cleanup on disposal
        yield* Effect.acquireRelease(
          Effect.sync(() => Bus.subscribe(SomeEvent, handler)),
          (unsub) => Effect.sync(unsub),
        );

        // Background fibers are interrupted on disposal
        yield* Effect.forkScoped(
          Effect.repeat(
            Effect.fn("Foo.sync")(function* () {
              /* periodic work */
            }),
            Schedule.spaced("30 seconds"),
          ),
        );

        return { data };
      }),
    );

    const get = Effect.fn("Foo.get")(function* (id: FooID) {
      const state = yield* InstanceState.get(cache);
      return state.data.get(id);
    });

    return Service.of({ get });
  }),
);
```

### When to use InstanceState vs global

| Question                            | Global service             | InstanceState                   |
| ----------------------------------- | -------------------------- | ------------------------------- |
| Does it need per-directory state?   | No                         | Yes                             |
| Should two projects share one copy? | Yes                        | No                              |
| Does it have cleanup logic?         | Rarely                     | Usually                         |
| Examples                            | Auth, Logger, Installation | FileWatcher, Permissions, Cache |

### Preferred Effect services

Inside effectified code, prefer Effect's built-in services over raw platform APIs:

| Instead of            | Use                                       |
| --------------------- | ----------------------------------------- |
| `fs/promises`         | `FileSystem.FileSystem`                   |
| `fetch`               | `HttpClient.HttpClient`                   |
| `child_process.spawn` | `ChildProcessSpawner.ChildProcessSpawner` |
| `new Date()`          | `DateTime.nowAsDate` or `Clock`           |
| `path.join()`         | `Path.Path`                               |
| `process.env`         | `Config`                                  |

### Error handling in Effect

```ts
// Define typed errors with Schema.TaggedErrorClass
class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()("UserNotFound", {
  id: Schema.String,
}) {}

// In Effect.fn, yield* the error directly (no Effect.fail needed)
const get = Effect.fn("User.get")(function* (id: UserID) {
  const row = yield* loadFromDb(id);
  if (!row) yield* new UserNotFound({ id });
  return row;
});

// For defect-like causes, use Schema.Defect instead of unknown
```

---

## 4. Branded IDs

Branded IDs prevent accidentally passing an `OrderID` where a `UserID` is expected.

### ID definition (leaf file)

```ts
// src/user/schema.ts
import { Schema } from "effect";
import z from "zod";
import { Identifier } from "@/id/id";
import { withStatics } from "@/util/schema";

export const UserID = Schema.String.pipe(
  Schema.brand("UserID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    descending: (id?: string) => s.makeUnsafe(Identifier.descending("user", id)),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("user", id)),
    zod: Identifier.schema("user").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
);
export type UserID = Schema.Schema.Type<typeof UserID>;
```

### The `withStatics` helper

```ts
// Attaches static methods to a schema object via .pipe()
export const withStatics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema));
```

### The Identifier system (time-sortable prefixed IDs)

```ts
export namespace Identifier {
  const prefixes = {
    user: "usr",
    order: "ord",
    item: "itm",
    session: "ses",
  } as const;

  // Generates: usr_1a2b3c4d5e6fRandomChars
  // Time-sortable, monotonic, with prefix for debugging
  export function ascending(prefix: keyof typeof prefixes, given?: string): string;
  export function descending(prefix: keyof typeof prefixes, given?: string): string;

  // Extract creation timestamp from an ascending ID
  export function timestamp(id: string): number;
}
```

### Usage

```ts
// Creating IDs
const id = UserID.descending()         // "usr_fffe..." (newest first in DB)
const id2 = UserID.ascending()         // "usr_0001..." (oldest first in DB)
const id3 = UserID.make("usr_custom")  // wrap an existing string

// In Zod schemas
const schema = z.object({ id: UserID.zod })   // validates "usr_" prefix

// In Drizzle tables
const UserTable = sqliteTable("user", {
  id: text().$type<UserID>().primaryKey(),
})

// Type safety
function getUser(id: UserID) { ... }
getUser(orderId) // TS error! OrderID is not UserID
```

---

## 5. Zod & Validation

### Schema conventions

```ts
// Schemas serve triple duty:
// 1. Runtime validation
// 2. TypeScript type inference
// 3. OpenAPI spec generation (via .meta({ ref: "..." }))

export const Info = z
  .object({
    id: UserID.zod,
    name: z.string(),
    email: z.string().email(),
    role: z.enum(["admin", "member"]),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  .meta({ ref: "User" }); // ← ref for OpenAPI $ref

export type Info = z.output<typeof Info>; // ← same name pattern: schema + type
```

### The `fn()` wrapper (validated functions)

Wraps any function with Zod input validation. Useful for domain functions that receive external input:

```ts
import { fn } from "@/util/fn"

// Validates input at runtime, throws ZodError on bad input
export const create = fn(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  async (input) => {
    // input is fully typed and validated here
    return db.insert(UserTable).values({ ...input, id: UserID.descending() })
  },
)

// Also exposes:
create.schema     // the Zod schema
create.force(...) // skip validation (for internal trusted calls)
```

### Effect Schema ↔ Zod interop

When a service uses Effect Schema internally but needs Zod for HTTP routes:

```ts
import { zod } from "@/util/effect-zod";

// Derive a Zod schema from an Effect Schema
export const ZodInfo = zod(EffectInfo);
```

---

## 6. Errors

### `NamedError` — serializable, typed, Zod-validated

```ts
import z from "zod";

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType;
  abstract toObject(): { name: string; data: any };

  static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({ ref: name });

    const result = class extends NamedError {
      public static readonly Schema = schema;
      public override readonly name = name as Name;

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions,
      ) {
        super(name, options);
        this.name = name;
      }

      static isInstance(input: any): input is InstanceType<typeof result> {
        return typeof input === "object" && "name" in input && input.name === name;
      }

      schema() {
        return schema;
      }
      toObject() {
        return { name, data: this.data };
      }
    };
    Object.defineProperty(result, "name", { value: name });
    return result;
  }

  public static readonly Unknown = NamedError.create(
    "UnknownError",
    z.object({ message: z.string() }),
  );
}
```

### Defining errors

```ts
// In your namespace — co-located with the domain
export namespace User {
  export const NotFoundError = NamedError.create("UserNotFoundError", z.object({ id: z.string() }));

  export const ValidationError = NamedError.create(
    "UserValidationError",
    z.object({ field: z.string(), message: z.string() }),
  );
}
```

### Throwing and catching

```ts
// Throw
throw new User.NotFoundError({ id: "usr_abc123" });

// Type-safe catch
if (User.NotFoundError.isInstance(err)) {
  console.log(err.data.id); // typed!
}

// Serialize for API responses
app.onError((err, c) => {
  if (err instanceof NamedError) {
    const status = err instanceof NotFoundError ? 404 : 500;
    return c.json(err.toObject(), { status });
    // → { name: "UserNotFoundError", data: { id: "usr_abc123" } }
  }
});
```

### Effect errors (inside Effect services)

For errors that stay within the Effect world, use `Schema.TaggedErrorClass`:

```ts
class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()("UserNotFound", {
  id: Schema.String,
}) {}

// Yield directly — no Effect.fail() wrapper needed
const get = Effect.fn("User.get")(function* (id: UserID) {
  const row = yield* loadFromDb(id);
  if (!row) yield* new UserNotFound({ id });
  return row;
});
```

---

## 7. Event Bus

### Event definition

```ts
// src/bus/event.ts
import z from "zod";

export namespace BusEvent {
  export type Definition = ReturnType<typeof define>;

  const registry = new Map<string, Definition>();

  export function define<Type extends string, Properties extends z.ZodType>(
    type: Type,
    properties: Properties,
  ) {
    const result = { type, properties };
    registry.set(type, result);
    return result;
  }

  // Auto-generates a Zod discriminated union of ALL registered events
  // Useful for OpenAPI specs, SSE schemas, etc.
  export function payloads() {
    return z
      .discriminatedUnion(
        "type",
        registry
          .entries()
          .map(([type, def]) =>
            z
              .object({
                type: z.literal(type),
                properties: def.properties,
              })
              .meta({ ref: "Event." + def.type }),
          )
          .toArray() as any,
      )
      .meta({ ref: "Event" });
  }
}
```

### Defining events in your namespace

```ts
export namespace Order {
  export const Event = {
    Created: BusEvent.define("order.created", z.object({ info: Info })),
    Shipped: BusEvent.define(
      "order.shipped",
      z.object({
        id: OrderID.zod,
        tracking: z.string(),
      }),
    ),
    Cancelled: BusEvent.define(
      "order.cancelled",
      z.object({
        id: OrderID.zod,
        reason: z.string(),
      }),
    ),
  };
}
```

### Publishing and subscribing

```ts
// src/bus/index.ts
export namespace Bus {
  // Publish — type-safe, properties must match the event schema
  export async function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) { ... }

  // Subscribe — callback is fully typed
  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: {
      type: D["type"]
      properties: z.infer<D["properties"]>
    }) => void,
  ) { ... }  // returns unsubscribe function

  // One-shot listener (return "done" to unsubscribe)
  export function once<D extends BusEvent.Definition>(
    def: D,
    callback: (event: ...) => "done" | undefined,
  ) { ... }

  // Wildcard — subscribe to all events
  export function subscribeAll(callback: (event: any) => void) { ... }
}
```

### Usage

```ts
// Publishing
await Bus.publish(Order.Event.Created, { info: order });

// Subscribing
const unsub = Bus.subscribe(Order.Event.Shipped, (event) => {
  console.log(event.properties.tracking); // typed!
});

// Cleanup
unsub();
```

### Global bus (cross-process / cross-instance)

For events that need to cross instance boundaries:

```ts
// src/bus/global.ts
import { EventEmitter } from "events";

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string;
      payload: any;
    },
  ];
}>();
```

---

## 8. Database (Drizzle)

### Table definitions

```ts
// src/user/user.sql.ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import type { UserID } from "./schema";
import { Timestamps } from "@/db/schema.sql";

export const UserTable = sqliteTable(
  "user",
  {
    id: text().$type<UserID>().primaryKey(),
    name: text().notNull(),
    email: text().notNull(),
    role: text().notNull().default("member"),
    ...Timestamps, // time_created, time_updated
  },
  (table) => [index("user_email_idx").on(table.email)],
);
```

### Shared column helpers

```ts
// src/db/schema.sql.ts
import { integer } from "drizzle-orm/sqlite-core";

export const Timestamps = {
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
  time_updated: integer()
    .notNull()
    .$onUpdate(() => Date.now()),
};
```

### Naming conventions

| Thing        | Convention                          | Example                                          |
| ------------ | ----------------------------------- | ------------------------------------------------ |
| Tables       | snake_case singular                 | `user`, `order_item`                             |
| Columns      | snake_case                          | `project_id`, `time_created`                     |
| Join columns | `<entity>_id`                       | `user_id`, `order_id`                            |
| Indexes      | `<table>_<column>_idx`              | `user_email_idx`                                 |
| JSON columns | `text({ mode: "json" }).$type<T>()` | `data: text({ mode: "json" }).$type<Settings>()` |

### Database namespace with transaction context

```ts
// src/db/db.ts
export namespace Database {
  // Lazy init with WAL mode + optimized pragmas
  export const Client = lazy(() => {
    const db = init(Path)
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    migrate(db, entries)
    return db
  })

  // AsyncLocalStorage-based transaction context
  // Automatically joins existing transaction or creates new one
  export function use<T>(callback: (db: TxOrDb) => T): T { ... }

  // Deferred side-effects that run AFTER transaction commits
  export function effect(fn: () => any) { ... }

  // Explicit transaction boundary
  export function transaction<T>(callback: (tx: TxOrDb) => T): T { ... }
}
```

### Usage

```ts
// Simple query — auto-creates context
Database.use((db) => {
  return db.select().from(UserTable).where(eq(UserTable.id, id)).get();
});

// Transaction with deferred side-effects
Database.transaction((tx) => {
  tx.insert(UserTable).values(user).run();
  tx.insert(AuditTable).values(audit).run();

  // This runs AFTER the transaction commits successfully
  Database.effect(() => Bus.publish(User.Event.Created, { info: user }));
});
```

### Migrations

- Schema lives in `src/**/*.sql.ts`
- Migrations generated via `drizzle-kit generate --name <slug>`
- Output: `migration/<timestamp>_<slug>/migration.sql`
- Applied on startup via `migrate(db, entries)`

---

## 9. Logging

### Logger implementation

```ts
export namespace Log {
  export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

  export type Logger = {
    debug(message?: any, extra?: Record<string, any>): void;
    info(message?: any, extra?: Record<string, any>): void;
    error(message?: any, extra?: Record<string, any>): void;
    warn(message?: any, extra?: Record<string, any>): void;
    tag(key: string, value: string): Logger;
    clone(): Logger;
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      stop(): void;
      [Symbol.dispose](): void; // ← works with `using`
    };
  };

  // Loggers are cached by service name
  export function create(tags?: Record<string, any>): Logger;

  // Default logger
  export const Default = create({ service: "default" });
}
```

### Usage

```ts
export namespace Order {
  const log = Log.create({ service: "order" })

  export async function create(input: CreateInput) {
    log.info("creating order", { input })

    // Timed operation with auto-dispose
    using timer = log.time("db.insert")
    const result = await db.insert(...)
    // timer auto-stops at block exit and logs duration

    // Or manual stop
    const t = log.time("external.api")
    await callApi()
    t.stop()
    // → "INFO  service=order external.api status=completed duration=142"
  }
}
```

### Log output format

```
INFO  2025-03-25T10:15:23 +42ms service=order creating order input={...}
INFO  2025-03-25T10:15:23 +0ms  service=order db.insert status=started
INFO  2025-03-25T10:15:23 +15ms service=order db.insert status=completed duration=15
```

Each line shows: level, timestamp, delta since last log, tags, message, and extras.

---

## 10. Utilities

### Copy-paste ready utilities for any TS project

#### `lazy(fn)` — memoize with reset

```ts
export function lazy<T>(fn: () => T) {
  let value: T | undefined;
  let loaded = false;
  const result = (): T => {
    if (loaded) return value as T;
    try {
      value = fn();
      loaded = true;
      return value as T;
    } catch (e) {
      throw e;
    }
  };
  result.reset = () => {
    loaded = false;
    value = undefined;
  };
  return result;
}
```

#### `Context.create()` — typed AsyncLocalStorage

```ts
import { AsyncLocalStorage } from "async_hooks";

export namespace Context {
  export class NotFound extends Error {
    constructor(public override readonly name: string) {
      super(`No context found for ${name}`);
    }
  }
  export function create<T>(name: string) {
    const storage = new AsyncLocalStorage<T>();
    return {
      use() {
        const result = storage.getStore();
        if (!result) throw new NotFound(name);
        return result;
      },
      provide<R>(value: T, fn: () => R) {
        return storage.run(value, fn);
      },
    };
  }
}
```

#### `Lock` — read-write lock with `using`

```ts
// Supports Symbol.dispose for automatic cleanup
using _ = await Lock.read("resource-key"); // shared read access
using _ = await Lock.write("resource-key"); // exclusive write access
// Lock auto-releases at block exit
```

Features:

- Writer-priority to prevent starvation
- Multiple concurrent readers
- Automatic cleanup of empty lock entries

#### `signal()` — one-shot promise trigger

```ts
export function signal() {
  let resolve: any;
  const promise = new Promise((r) => (resolve = r));
  return {
    trigger() {
      return resolve();
    },
    wait() {
      return promise;
    },
  };
}
```

#### `AsyncQueue<T>` — push/pull async iterable

```ts
export class AsyncQueue<T> implements AsyncIterable<T> {
  push(item: T); // add item (resolves waiting consumer, or buffers)
  async next(): Promise<T>; // pull next item (waits if empty)
  [Symbol.asyncIterator](); // use in for-await-of
}

// Usage
const queue = new AsyncQueue<Job>();
queue.push({ type: "email", to: "..." });

for await (const job of queue) {
  await process(job);
}
```

#### `work(concurrency, items, fn)` — bounded parallel execution

```ts
export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop();
        if (item === undefined) return;
        await fn(item);
      }
    }),
  );
}

// Usage
await work(5, urls, async (url) => {
  await fetch(url);
});
```

#### `defer(fn)` — disposable cleanup

```ts
export function defer<T extends () => void | Promise<void>>(fn: T) {
  return {
    [Symbol.dispose]() {
      fn();
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn());
    },
  };
}

// Usage
using _ = defer(() => connection.close());
// connection auto-closes at block exit
```

#### `abortAfter(ms)` — AbortController + timeout (no closure leaks)

```ts
export function abortAfter(ms: number) {
  const controller = new AbortController();
  // Uses .bind() instead of arrow fn to avoid capturing scope in closures
  const id = setTimeout(controller.abort.bind(controller), ms);
  return {
    controller,
    signal: controller.signal,
    clearTimeout: () => globalThis.clearTimeout(id),
  };
}

export function abortAfterAny(ms: number, ...signals: AbortSignal[]) {
  const timeout = abortAfter(ms);
  return {
    signal: AbortSignal.any([timeout.signal, ...signals]),
    clearTimeout: timeout.clearTimeout,
  };
}
```

#### `iife(fn)` — inline async expressions

```ts
export function iife<T>(fn: () => T) {
  return fn();
}

// Usage — run async work in sync context
const result = iife(async () => {
  const data = await fetch(url);
  return data.json();
});
```

#### `retry(fn, opts)` — exponential backoff

```ts
export async function retry<T>(
  fn: () => Promise<T>,
  options?: {
    attempts?: number; // default 3
    delay?: number; // default 500ms
    factor?: number; // default 2
    maxDelay?: number; // default 10000ms
    retryIf?: (error: unknown) => boolean; // default: transient network errors
  },
): Promise<T>;
```

#### `withTimeout(promise, ms)`

```ts
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>;
```

---

## 11. Config

### Layered config with precedence

```
Source (low → high priority):
1. Default values
2. Global config (~/.config/app/config.json)
3. Environment variables
4. Project config (./app.json)
5. .app/ directory overrides
6. Inline config (APP_CONFIG_CONTENT env var)
```

### Config namespace

```ts
export namespace Config {
  // Zod schema doubles as type + validation + documentation
  export const Info = z
    .object({
      database: z
        .object({
          path: z.string().optional(),
          wal: z.boolean().default(true),
        })
        .optional(),
      log: z
        .object({
          level: Log.Level.optional(),
        })
        .optional(),
      // ...
    })
    .strict()
    .meta({ ref: "Config" });
  export type Info = z.output<typeof Info>;

  // Instance-scoped state — reloads on config change
  export const state = Instance.state(async () => {
    let result: Info = {};
    result = mergeDeep(result, await loadFile(globalConfigPath));
    result = mergeDeep(result, await loadFile(projectConfigPath));
    return { config: result };
  });

  export async function get() {
    return state().then((x) => x.config);
  }
}
```

---

## 12. Testing

### Principles

- **Avoid mocks.** Test real implementations.
- **Don't duplicate logic into tests.** Assert behavior, not implementation.
- **Run from package dirs**, never from repo root.
- **Use real databases** (SQLite in-memory or temp file).

### Testing Effect services

```ts
import { Effect, Layer } from "effect";

test("User.get returns user", async () => {
  const program = Effect.gen(function* () {
    const user = yield* User.Service.use((svc) => svc.create({ name: "Alice" }));
    const found = yield* User.Service.use((svc) => svc.get(user.id));
    expect(found.name).toBe("Alice");
  });

  await Effect.runPromise(program.pipe(Effect.provide(User.layer)));
});
```

### Or test via the async facade

```ts
test("User.get returns user", async () => {
  const user = await User.create({ name: "Alice" });
  const found = await User.get(user.id);
  expect(found.name).toBe("Alice");
});
```

---

## Quick Reference: File ↔ Pattern Map

```
index.ts     → namespace + Effect service + layer + facade
schema.ts    → branded IDs (plain exports, no namespace)
*.sql.ts     → Drizzle table (plain exports, no namespace)
status.ts    → sub-concern namespace (e.g., OrderStatus)
summary.ts   → sub-concern namespace (e.g., OrderSummary)
```

## Quick Reference: Import Style

```ts
// Consumers see clean, single-surface imports:
import { User } from "@/user"
import { Order } from "@/order"
import { Bus } from "@/bus"
import { Database } from "@/db"
import { Log } from "@/util/log"

User.get(id)
User.Info.parse(raw)
User.Event.Created
User.NotFoundError.isInstance(err)

Order.create({ userId: id, items: [...] })
Bus.publish(Order.Event.Created, { info: order })
Database.transaction((tx) => { ... })
```
