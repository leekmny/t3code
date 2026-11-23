import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "An idle thread can send a thread-scoped Stop from its action menu",
  WEB,
  async ({ t3, app, screen }) => {
    const project = await t3.project("demo");
    const thread = await t3.thread({ project, title: "Earlier work", messages: ["first"] });
    await t3.open(thread);

    await screen.getByRole("button", "Thread actions for Earlier work").click();
    const stop = screen.getByRole("menuitem", "Stop background work");
    await expect(stop).toBeVisible();
    await app.screenshot("idle-thread-stop-action");
    await stop.click();
    await expect(stop).toBeHidden();
  },
);
