import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import type { AppBarProps } from "../../components/ui/AppBar.types";
import type { ThreadGitControlsProps } from "./ThreadGitControls";

vi.mock("gt-react-native", () => ({
  useGT: () => (text: string) => text,
  useMessages: () => () => "",
}));
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: ({ menus }: AppBarProps) =>
    menus?.flatMap(({ items }) =>
      items.map((item) =>
        "onPress" in item ? (
          <button key={item.id} type="button" onClick={item.onPress}>
            {item.title}
          </button>
        ) : null,
      ),
    ),
}));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({}),
  useWorkspacePaneState: () => ({ panes: {} }),
}));
vi.mock("../layout/workspace/useAndroidWorkspaceNavigation", () => ({
  useWorkspaceBackNavigation: () => () => {},
}));
vi.mock("./ThreadGitControls", () => ({
  threadTerminalMenu: () => null,
  useThreadGitMenuDefinition: () => null,
}));

import { ThreadHeader } from "./ThreadHeader";

it("makes the optional background Stop action available in the mobile thread header", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const rootElement = document.createElement("div");
  const root = createRoot(rootElement);
  const stop = vi.fn();
  const renderHeader = (onStopBackgroundWork?: () => void) =>
    act(() =>
      root.render(
        <ThreadHeader
          title="A finished run"
          subtitle=""
          gitControls={{} as ThreadGitControlsProps}
          hasThreadCwd={false}
          inspectorMode={null}
          onOpenFilesInspector={() => {}}
          onStopBackgroundWork={onStopBackgroundWork}
        />,
      ),
    );

  try {
    renderHeader(stop);
    const item = rootElement.querySelector("button");
    expect(item?.textContent).toBe("Stop background work");
    act(() => item?.click());
    expect(stop).toHaveBeenCalledOnce();

    renderHeader();
    expect(rootElement.querySelector("button")).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
