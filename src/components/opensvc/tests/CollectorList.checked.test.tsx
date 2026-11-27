import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createContext, useContext } from "react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { checkedRows } from "@/features/assistant/checked-rows";
import { listFilters } from "@/features/assistant/list-filters";
import { CollectorList, type ListColumn } from "../CollectorList";
import { resolveListSearch, type ResolvedListSearch } from "@/lib/list-search";
import { withSavedSearch } from "@/lib/user-prefs";

interface Disk {
  id?: string;
  name: string;
}

const columns: ListColumn<Disk>[] = [
  { prop: "name", labelKey: "list.name", family: "node", render: (row) => row.name },
];
const search: ResolvedListSearch = { sort: [], offset: 0, limit: 50, filters: {} };

/** The search of the list, changed from outside it, as by a link or the history. */
const SearchOf = createContext<ResolvedListSearch>(search);

/**
 * A list of the page of the disks, as a view renders it, without telling its
 * selection; with `everything`, a list of several pages that can select all its
 * matching rows.
 */
function renderList(
  rows: Disk[],
  total?: number,
  listSearch: ResolvedListSearch = search,
  everything?: () => Promise<string[]>,
) {
  const rootRoute = createRootRoute();
  const List = () => (
    <CollectorList<Disk>
      columns={columns}
      defaultCols={["name"]}
      rows={rows}
      rowId={(row) => row.id}
      search={useContext(SearchOf)}
      onChange={() => undefined}
      isPending={false}
      isFetching={false}
      errorMessage={null}
      hasMore={everything !== undefined}
      total={total}
      selectAllMatching={everything}
      filterable
    />
  );
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/disks",
    component: List,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/disks"] }),
  });
  const tree = (shown: ResolvedListSearch) => (
    <QueryClientProvider client={new QueryClient()}>
      <SearchOf.Provider value={shown}>
        <RouterProvider router={router} />
      </SearchOf.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(listSearch));
  return {
    ...view,
    /** Gives the list other filters, from outside it. */
    filterBy: (filters: Record<string, string>) => {
      view.rerender(tree({ ...listSearch, filters }));
    },
  };
}

const tick = async (count: number) => {
  const boxes = await screen.findAllByRole("checkbox", { name: "Select this row" });
  boxes.slice(0, count).forEach((box) => fireEvent.click(box));
};

describe("the filters of a list", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  test("go with a question to the assistant as the list applies them, those saved for the view too, with its columns", async () => {
    // The address names none: the filters saved for the view complete it, as a page
    // resolves its search.
    const saved = resolveListSearch(withSavedSearch({}, { filters: { name: "dev" } }), []);
    const { unmount, filterBy } = renderList([{ id: "d-1", name: "dev1" }], 1, saved);
    await screen.findAllByRole("checkbox", { name: "Select this row" });
    expect(listFilters()).toEqual({ kind: "disks", filters: { name: "dev" }, props: ["name"] });
    // Changed from outside the list, told as changed.
    filterBy({ name: "prod" });
    await waitFor(() => {
      expect(listFilters()?.filters).toEqual({ name: "prod" });
    });
    unmount();
    expect(listFilters()).toBeNull();
  });
});

describe("the rows ticked in a list", () => {
  // jsdom has no ResizeObserver, which the list fits its columns with.
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  test("go with a question to the assistant, in the order of the list, none once it leaves", async () => {
    const { unmount } = renderList([
      { id: "10", name: "b" },
      { id: "9", name: "a" },
      { id: "11", name: "c" },
    ]);
    await tick(2);
    await waitFor(() => {
      expect(checkedRows()).toEqual({ kind: "disks", ids: ["10", "9"], exact: true, all: false });
    });
    unmount();
    expect(checkedRows()).toBeNull();
  });

  test("are every row of the list when all the rows of its total are ticked", async () => {
    const { unmount } = renderList(
      [
        { id: "1", name: "a" },
        { id: "2", name: "b" },
      ],
      2,
    );
    await tick(2);
    await waitFor(() => {
      expect(checkedRows()?.all).toBe(true);
    });
    unmount();
  });

  test("are every row of the list no longer once its filters change from outside it", async () => {
    const ids = Array.from({ length: 80 }, (_, index) => String(index));
    const { unmount, filterBy } = renderList(
      [
        { id: "0", name: "a" },
        { id: "1", name: "b" },
      ],
      // A total unknown: every row by the selection of all its pages alone.
      undefined,
      { ...search, filters: { name: "up" } },
      () => Promise.resolve(ids),
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select every row on this page" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select all matching rows" }));
    await waitFor(() => {
      expect(checkedRows()?.all).toBe(true);
    });
    // The rows ticked stay, but are not every row of a list that now shows others.
    act(() => {
      filterBy({});
    });
    await waitFor(() => {
      expect(checkedRows()).toMatchObject({ ids, all: false });
    });
    unmount();
  });

  test("give their count alone when a row has no id, ticked by its position", async () => {
    const { unmount } = renderList([{ name: "a" }, { id: "7", name: "b" }]);
    await tick(2);
    await waitFor(() => {
      expect(checkedRows()?.exact).toBe(false);
    });
    unmount();
  });
});
