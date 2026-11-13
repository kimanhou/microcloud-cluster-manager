import { act, type PropsWithChildren, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type * as CanonicalComponents from "@canonical/react-components";
import { ToastNotificationProvider } from "@canonical/react-components";
import { vi } from "vitest";
import type { Cluster, ClusterLink } from "types/cluster";
import * as clusterLinks from "util/clusterLinks";
import { queryKeys } from "util/queryKeys";
import EditClusterLinkPanel from "./EditClusterLinkPanel";

const mocks = vi.hoisted(() => ({
  fetchLinks: vi.fn(),
  updateLink: vi.fn(),
  invalidate: vi.fn(),
  close: vi.fn(),
  clearNotification: vi.fn(),
  success: vi.fn<(message: ReactNode) => void>(),
  toggleListView: vi.fn(),
  isListView: false,
  useRealToasts: false,
}));

vi.mock("api/clusters", () => ({
  fetchClusters: vi.fn(),
  fetchClusterLinks: mocks.fetchLinks,
  updateClusterLink: mocks.updateLink,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: managedClusters }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

vi.mock("context/useClusters", () => ({
  useCluster: () => ({ data: source }),
  useClusterLinks: () => ({ data: [link], isLoading: false }),
}));

vi.mock("context/useIdentities", () => ({
  useIdentities: () => ({
    data: [{ name: link.name, type: "Cluster link certificate" }],
  }),
}));

vi.mock("context/usePanelParams", () => ({
  default: () => ({
    cluster: source.name,
    clusterLink: link.name,
    clear: mocks.close,
  }),
}));

vi.mock("components/NotificationRow", () => ({ default: () => null }));
vi.mock("components/ResourceIcon", () => ({ default: () => null }));

vi.mock("@canonical/react-components", async (importOriginal) => {
  const components = await importOriginal<typeof CanonicalComponents>();
  return {
    ...components,
    useNotify: () => ({
      notification: null,
      clear: mocks.clearNotification,
    }),
    useToastNotification: () => {
      const toastNotify = components.useToastNotification();
      return mocks.useRealToasts
        ? toastNotify
        : {
            success: mocks.success,
            toggleListView: mocks.toggleListView,
            isListView: mocks.isListView,
          };
    },
    // Layout measurements are irrelevant in jsdom; retain the real form controls.
    ScrollableContainer: ({ children }: PropsWithChildren) => <>{children}</>,
  };
});

const source: Cluster = {
  name: "source",
  cluster_uuid: "source-uuid",
  lxd_url: "https://source.example:8443",
  tunnel_registered: true,
  description: "",
  disk_threshold: 80,
  memory_threshold: 80,
  ceph_count: 0,
  ceph_statuses: [],
  cpu_total_count: 0,
  cpu_load_1: "0",
  cpu_load_5: "0",
  cpu_load_15: "0",
  created_at: "",
  instance_count: 0,
  instance_statuses: [],
  joined_at: "",
  last_status_update_at: "",
  member_count: 0,
  member_statuses: [],
  memory_total_amount: 0,
  memory_usage: 0,
  storage_pool_usages: [],
  cluster_certificate: "",
  status: "Online",
};
const target: Cluster = {
  ...source,
  name: "target",
  cluster_uuid: "target-uuid",
  lxd_url: "https://target.example:8443",
};
const reverse: ClusterLink = {
  name: "different-reverse-name",
  type: "unidirectional",
  description: "Old target description",
  config: {
    "volatile.uuid": source.cluster_uuid,
    "volatile.addresses": "target-edge.example:8443",
    "volatile.pending_certificate": "target-certificate",
  },
};
let link: ClusterLink;
let managedClusters: Cluster[];

describe("EditClusterLinkPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isListView = false;
    mocks.useRealToasts = false;
    mocks.fetchLinks.mockReset().mockResolvedValue([
      // Matching names must not take precedence over the source UUID.
      {
        ...reverse,
        name: "outgoing-link",
        config: { "volatile.uuid": "unrelated-uuid" },
      },
      reverse,
    ]);
    mocks.updateLink.mockReset().mockResolvedValue(undefined);
    mocks.invalidate.mockResolvedValue(undefined);
    vi.spyOn(clusterLinks, "getReverseLink");
    managedClusters = [source, target];
    link = {
      name: "outgoing-link",
      type: "unidirectional",
      description: "Old source description",
      config: {
        "volatile.uuid": target.cluster_uuid,
        "volatile.addresses": "source-edge.example:8443",
        "volatile.pending_address": "pending.example:8443",
      },
    };
    container = document.createElement("div");
    container.id = "l-application"; // Destination for the real SidePanel portal.
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () => {
      root.render(
        mocks.useRealToasts ? (
          <ToastNotificationProvider autoDismissDelay={0}>
            <EditClusterLinkPanel />
          </ToastNotificationProvider>
        ) : (
          <EditClusterLinkPanel />
        ),
      );
      await Promise.resolve();
    });
  };

  const input = (selector: string) => {
    const element = container.querySelector<HTMLInputElement>(selector);
    if (!element) {
      throw new Error(`Input not found: ${selector}`);
    }
    return element;
  };

  const setDescription = async (value: string) => {
    const description = input("#description");
    await act(async () => {
      // Bypass React's value tracker to dispatch a real controlled-input change.
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      if (!descriptor?.set) {
        throw new Error("Native input value setter not found");
      }
      descriptor.set.call(description, value);
      description.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  };

  const selectBoth = async () => {
    await act(async () => {
      input('input[type="checkbox"]').click();
      await Promise.resolve();
    });
    expect(input('input[type="checkbox"]').checked).toBe(true);
  };

  const save = async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "Save",
    );
    if (!button) {
      throw new Error("Save button not found");
    }
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
  };

  const expectInvalidated = (clusterName: string) => {
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: [queryKeys.clusters, clusterName, queryKeys.links],
    });
  };

  const expectSavedNotifications = (both: boolean) => {
    expect(
      mocks.success.mock.calls.map(([message]) =>
        renderToStaticMarkup(message),
      ),
    ).toEqual([
      `Cluster link <b>${link.name}</b> on <b>${source.name}</b> saved.`,
      ...(both
        ? [
            `Cluster link <b>${reverse.name}</b> on <b>${target.name}</b> saved.`,
          ]
        : []),
    ]);
  };

  const expectSuccess = (both = false) => {
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.clearNotification).toHaveBeenCalledOnce();
    expectSavedNotifications(both);
    expect(mocks.toggleListView).toHaveBeenCalledTimes(both ? 1 : 0);
    expect(container.textContent).not.toContain("update failed");
  };

  const expectFailure = (
    title: string,
    detail: string,
    sourceSaved = false,
  ) => {
    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain(detail);
    // The error belongs to the normal editing panel, not the missing-link view.
    expect(input("#description").value).toBe("New description");
    expect(container.querySelector("form")).not.toBeNull();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.clearNotification).not.toHaveBeenCalled();
    if (sourceSaved) {
      expectSavedNotifications(false);
    } else {
      expect(mocks.success).not.toHaveBeenCalled();
    }
  };

  describe.each(["unidirectional", "bidirectional"] as const)(
    "%s links",
    (type) => {
      it("renders the link and updates only the source when unchecked", async () => {
        // Arrange
        link.type = type;
        await render();
        expect(input("#source-cluster").value).toBe(source.name);
        expect(input("#target-cluster").value).toBe(target.name);
        expect(input("#name").value).toBe(link.name);
        expect(input("#name").readOnly).toBe(true);
        expect(input("#description").value).toBe(link.description);
        expect(input('input[type="checkbox"]').checked).toBe(false);

        // Act
        await setDescription("New description");
        await save();

        // Assert
        expect(mocks.fetchLinks).not.toHaveBeenCalled();
        expect(clusterLinks.getReverseLink).not.toHaveBeenCalled();
        expect(mocks.updateLink).toHaveBeenCalledExactlyOnceWith(
          source.name,
          link.name,
          JSON.stringify({
            description: "New description",
            config: link.config,
          }),
        );
        expectInvalidated(source.name);
        expect(mocks.invalidate).not.toHaveBeenCalledWith({
          queryKey: [queryKeys.clusters, target.name, queryKeys.links],
        });
        expectSuccess();
      });

      it.each(["New description", ""])(
        "updates both descriptions to %j using the UUID-matched reverse edge",
        async (description) => {
          // Arrange
          link.type = type;
          await render();

          // Act
          await setDescription(description);
          await selectBoth();
          await save();

          // Assert
          expect(mocks.fetchLinks).toHaveBeenCalledExactlyOnceWith(target.name);
          expect(clusterLinks.getReverseLink).toHaveBeenCalledWith(
            await mocks.fetchLinks.mock.results[0].value,
            source,
          );
          expect(mocks.updateLink.mock.calls).toEqual([
            [
              source.name,
              link.name,
              JSON.stringify({ description, config: link.config }),
            ],
            [
              target.name,
              reverse.name,
              JSON.stringify({ description, config: reverse.config }),
            ],
          ]);
          expectInvalidated(source.name);
          expectInvalidated(target.name);
          expectSuccess(true);
        },
      );
    },
  );

  it("displays both saved edges with the real toast provider", async () => {
    mocks.useRealToasts = true;
    vi.stubGlobal(
      "matchMedia",
      (query: string): MediaQueryList => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
    await render();
    await setDescription("New description");
    await selectBoth();
    await save();

    const notifications = document.querySelector(
      '[aria-label="Notifications list"]',
    );
    expect(notifications).not.toBeNull();
    expect(
      notifications?.querySelectorAll(".individual-notification"),
    ).toHaveLength(2);
    expect(notifications?.textContent).toContain(
      `Cluster link ${link.name} on ${source.name} saved.`,
    );
    expect(notifications?.textContent).toContain(
      `Cluster link ${reverse.name} on ${target.name} saved.`,
    );
  });

  it("does not collapse an already open notification list after saving both edges", async () => {
    mocks.isListView = true;
    await render();
    await setDescription("New description");
    await selectBoth();
    await save();

    expectSavedNotifications(true);
    expect(mocks.toggleListView).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "reverse missing",
      "No cluster link pointing back at source found on cluster target.",
    ],
    ["fetch fails", "Target links unavailable"],
    [
      "tunnel unavailable",
      "The target cluster must be managed and have a registered tunnel to update both ends.",
    ],
    [
      "unmanaged target",
      "The target cluster must be managed and have a registered tunnel to update both ends.",
    ],
  ])("does not write when %s", async (scenario, message) => {
    // Arrange
    if (scenario === "reverse missing") {
      mocks.fetchLinks.mockResolvedValue([]);
    } else if (scenario === "fetch fails") {
      mocks.fetchLinks.mockRejectedValue(new Error(message));
    } else if (scenario === "tunnel unavailable") {
      managedClusters = [source, { ...target, tunnel_registered: false }];
    } else {
      managedClusters = [source];
    }
    await render();

    // Act
    await setDescription("New description");
    await selectBoth();
    await save();

    // Assert
    expect(mocks.updateLink).not.toHaveBeenCalled();
    if (scenario === "tunnel unavailable" || scenario === "unmanaged target") {
      expect(mocks.fetchLinks).not.toHaveBeenCalled();
    } else {
      expect(mocks.fetchLinks).toHaveBeenCalledExactlyOnceWith(target.name);
    }
    expectFailure("Cluster link update failed", message);
  });

  it("does not update the target if the source update fails", async () => {
    // Arrange
    mocks.updateLink.mockRejectedValueOnce(new Error("Source write refused"));
    await render();

    // Act
    await setDescription("New description");
    await selectBoth();
    await save();

    // Assert
    expect(mocks.updateLink).toHaveBeenCalledExactlyOnceWith(
      source.name,
      link.name,
      JSON.stringify({ description: "New description", config: link.config }),
    );
    expectFailure("Cluster link update failed", "Source write refused");
    expectInvalidated(source.name);
    expectInvalidated(target.name);
  });

  it("shows partial success in the open editing panel if the target update fails", async () => {
    // Arrange
    mocks.updateLink
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Target write refused"));
    await render();

    // Act
    await setDescription("New description");
    await selectBoth();
    await save();

    // Assert
    expect(mocks.updateLink).toHaveBeenCalledTimes(2);
    expect(mocks.updateLink).toHaveBeenNthCalledWith(
      2,
      target.name,
      reverse.name,
      JSON.stringify({
        description: "New description",
        config: reverse.config,
      }),
    );
    expectFailure(
      "Source description saved, but target description update failed",
      "Target write refused",
      true,
    );
    expectInvalidated(source.name);
    expectInvalidated(target.name);
  });

  it("keeps public links source-only without offering the both-ends checkbox", async () => {
    // Arrange
    link.type = "public";
    await render();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();

    // Act
    await setDescription("New description");
    await save();

    // Assert
    expect(mocks.fetchLinks).not.toHaveBeenCalled();
    expect(mocks.updateLink).toHaveBeenCalledExactlyOnceWith(
      source.name,
      link.name,
      JSON.stringify({ description: "New description", config: link.config }),
    );
    expectInvalidated(source.name);
    expectSuccess();
  });
});
