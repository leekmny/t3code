import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as CodexAccountSwitch from "./CodexAccountSwitch.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const codex = ProviderInstanceId.make("codex");
const codexWork = ProviderInstanceId.make("codex-work");
const codexManaged = ProviderInstanceId.make("codex-managed");
const claude = ProviderInstanceId.make("claude");
const codexDriver = ProviderDriverKind.make("codex");
const claudeDriver = ProviderDriverKind.make("claude");

const provider = (
  instanceId: ProviderInstanceId,
  auth: ServerProviderAuth,
  driver = codexDriver,
): ServerProvider => ({
  instanceId,
  driver,
  enabled: true,
  installed: true,
  version: "0.171.0",
  status: "ready",
  auth,
  checkedAt: "2026-11-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
});

const signedIn = (email: string, workspaceId?: string): ServerProviderAuth => ({
  status: "authenticated",
  type: "chatgpt",
  email,
  ...(workspaceId === undefined ? {} : { workspaceId }),
});

const managed = (email: string) =>
  provider(codexManaged, { ...signedIn(email), subscriptionSharing: true });

const buildWatcher = (
  snapshotChanges: Stream.Stream<ReadonlyArray<ServerProvider>>,
  closed: Queue.Queue<ProviderInstanceId>,
) =>
  Layer.build(
    CodexAccountSwitch.layer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.mock(ProviderRegistry.ProviderRegistry)({ snapshotChanges }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
            closeInstance: (instanceId) => Queue.offer(closed, instanceId).pipe(Effect.asVoid),
          }),
        ),
      ),
    ),
  );

it.effect("releases only externally authenticated Codex instances whose account switched", () =>
  Effect.gen(function* () {
    const closed = yield* Queue.unbounded<ProviderInstanceId>();
    const drained = yield* Deferred.make<void>();
    const initial = [
      provider(codex, signedIn("alice@example.test", "personal")),
      provider(codexWork, signedIn("work@example.test", "workspace-a")),
      managed("first@example.test"),
      provider(claude, signedIn("first@example.test"), claudeDriver),
    ];
    const snapshots = [
      [
        ...initial.slice(0, 2),
        managed("second@example.test"),
        provider(claude, signedIn("second@example.test"), claudeDriver),
      ],
      [provider(codex, signedIn("alice@example.test")), provider(codexWork, { status: "unknown" })],
      [
        provider(codex, signedIn("alice@example.test", "workspace-b")),
        provider(codexWork, { status: "unauthenticated" }),
      ],
      [
        provider(codex, signedIn("alice@example.test", "workspace-b")),
        provider(codexWork, signedIn("bob@example.test")),
      ],
    ];
    yield* buildWatcher(
      Stream.fromIterable([initial, ...snapshots]).pipe(
        Stream.onEnd(Deferred.succeed(drained, undefined)),
      ),
      closed,
    );

    yield* Deferred.await(drained);
    assert.deepStrictEqual(yield* Queue.clear(closed), [codex, codexWork]);
  }).pipe(Effect.scoped),
);

it.effect("observes an account switch published while processing the initial snapshot", () =>
  Effect.gen(function* () {
    const closed = yield* Queue.unbounded<ProviderInstanceId>();
    const oldAccount = [provider(codex, signedIn("alice@example.test"))];
    const newAccount = [provider(codex, signedIn("bob@example.test"))];
    const snapshots = yield* SubscriptionRef.make<ReadonlyArray<ServerProvider>>(oldAccount);
    yield* buildWatcher(
      SubscriptionRef.changes(snapshots).pipe(
        Stream.tap((snapshot) =>
          snapshot === oldAccount ? SubscriptionRef.set(snapshots, newAccount) : Effect.void,
        ),
      ),
      closed,
    );

    assert.strictEqual(yield* Queue.take(closed), codex);
  }).pipe(Effect.scoped),
);

it.effect("releases the old app-server when the same account signs in after a logout", () =>
  Effect.gen(function* () {
    const closed = yield* Queue.unbounded<ProviderInstanceId>();
    const drained = yield* Deferred.make<void>();
    const signedInSnapshot = [provider(codex, signedIn("alice@example.test"))];
    yield* buildWatcher(
      Stream.make(
        signedInSnapshot,
        [provider(codex, { status: "unauthenticated" })],
        signedInSnapshot,
        signedInSnapshot,
      ).pipe(Stream.onEnd(Deferred.succeed(drained, undefined))),
      closed,
    );

    yield* Deferred.await(drained);
    assert.deepStrictEqual(yield* Queue.clear(closed), [codex]);
  }).pipe(Effect.scoped),
);
