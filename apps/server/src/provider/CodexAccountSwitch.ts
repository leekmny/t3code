import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const CODEX_DRIVER = ProviderDriverKind.make("codex");

interface Account {
  readonly email: string;
  readonly workspaceId: string | undefined;
}

const recordAccounts = (
  accounts: Map<ProviderInstanceId, Account | null>,
  providers: ReadonlyArray<ServerProvider>,
) => {
  const changed: Array<ProviderInstanceId> = [];
  for (const { instanceId, driver, enabled, auth } of providers) {
    // Managed sign-in coordinates session release itself.
    if (driver !== CODEX_DRIVER || !enabled || auth.subscriptionSharing === true) {
      accounts.delete(instanceId);
      continue;
    }
    if (auth.status === "unauthenticated") {
      accounts.set(instanceId, null);
      continue;
    }
    if (auth.status !== "authenticated" || auth.email === undefined) continue;

    const previous = accounts.get(instanceId);
    const sameEmail = previous?.email === auth.email;
    // An optional rate-limit read supplies workspaceId and can fail independently of sign-in.
    if (
      previous === null ||
      (previous !== undefined &&
        (!sameEmail ||
          (previous.workspaceId !== undefined &&
            auth.workspaceId !== undefined &&
            previous.workspaceId !== auth.workspaceId)))
    ) {
      changed.push(instanceId);
    }
    accounts.set(instanceId, {
      email: auth.email,
      workspaceId: auth.workspaceId ?? (sameEmail ? previous?.workspaceId : undefined),
    });
  }
  return changed;
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
    const accounts = new Map<ProviderInstanceId, Account | null>();

    // The shared Codex app-server holds the old credentials in memory after an external login.
    yield* providers.snapshotChanges.pipe(
      Stream.runForEach((snapshot) =>
        Effect.forEach(
          recordAccounts(accounts, snapshot),
          (instanceId) =>
            sessions.closeInstance(instanceId, "Codex account changed.").pipe(
              Effect.catch(() =>
                Effect.logWarning("Failed to release sessions after Codex account change", {
                  instanceId,
                }),
              ),
            ),
          { discard: true },
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
  }),
);
