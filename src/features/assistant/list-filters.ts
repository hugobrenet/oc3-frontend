import { useEffect, useMemo } from "react";
import { filtersKey } from "@/lib/column-filters";

/**
 * The filters of the list on display, for the context of a question to the
 * assistant (`interface-context.ts`): what "these nodes" or "those down" are. Told by
 * the list itself (`CollectorList`), as it applies them, the address completed with
 * the filters saved for the view or the tab, which the address does not carry: what
 * the model reads is what the list keeps. With them the columns of the list, the
 * only ones a filter is told of.
 */
export interface ListFilters {
  /** What the rows of the list are, plural: `nodes`, `rows` for a list of no known kind. */
  kind: string;
  /** Prop → filter expression, as the list sends them to the collector. */
  filters: Readonly<Record<string, string>>;
  /** The props of the columns of the list. */
  props: readonly string[];
}

/**
 * The filters of the list on display. One list a page, as for the rows ticked
 * (`checked-rows.ts`): the list whose filters changed last tells them, in place of
 * any other.
 */
let shared: ListFilters | null = null;

/** The filters of the list on display, `null` when no list tells them. */
export const listFilters = (): ListFilters | null => shared;

/**
 * Tells the filters a list applies and its columns, none once it leaves the page:
 * told again when they change, not at each render of the list, which gives them
 * anew.
 */
export function useShareListFilters(
  kind: string,
  filters: Readonly<Record<string, string>>,
  props: readonly string[],
): void {
  const filtersOf = filtersKey(filters);
  const propsOf = props.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- by their contents
  const value = useMemo<ListFilters>(() => ({ kind, filters, props }), [kind, filtersOf, propsOf]);
  useEffect(() => {
    shared = value;
    return () => {
      if (shared === value) shared = null;
    };
  }, [value]);
}
