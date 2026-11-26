import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CaretRightIcon, ChevronDownIcon } from "./icons";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Separator line before this entry, to mark a group. */
  separatorBefore?: boolean;
  /**
   * What the entry does: said in the foot of its menu while the entry is hovered
   * or focused, rather than under each entry, and read as its description.
   */
  description?: string;
  /**
   * Words the filter finds the entry by besides what it shows: the action as the
   * API and the agent name it ("pushasset").
   */
  keywords?: string[];
  /** An entry that harms: its label in the tint of down. */
  danger?: boolean;
  /**
   * What it costs, as small badges after its label (down-time, data-loss), in the
   * tint of down or of warn.
   */
  badges?: { key: string; label: string; tone: "down" | "warn" }[];
  /** Entries of a submenu: the entry then opens it rather than being chosen. */
  items?: MenuItem[];
  onSelect?: () => void;
}

const ITEM =
  "flex w-full items-center gap-2 rounded-(--radius-control) px-2 py-1.5 text-left text-ink hover:bg-surface focus:bg-surface focus:outline-none disabled:text-ink-muted/60 disabled:hover:bg-transparent";

/**
 * Button opening an action menu, following the "menu button" pattern of the ARIA
 * APG, like the account menu whose behaviour it reuses: the button announces the
 * menu and its state, opening from the keyboard puts the focus on the first entry,
 * the arrows, Home and End walk through the entries, Escape closes and gives the
 * focus back to the button. A click outside the menu, Tab or choosing an entry close
 * it too.
 *
 * An entry with `items` opens a submenu beside it, by the mouse, Enter, Space or
 * the right arrow; within it the arrows walk its own entries, and the left arrow
 * or Escape give the focus back to the entry that opened it.
 *
 * A menu whose entries say what they do (`description`) says it in its foot, for
 * the entry hovered or focused, each submenu in its own: the menu keeps the size
 * of its labels. `filterable` adds a field over the entries, focused on opening:
 * typing lists the entries of every level that match, by their label, description,
 * badges, keywords or the submenus they are in, which each one names, flat rather
 * than in their submenus; Down then goes to the first, Enter chooses it, Up from
 * the first goes back to the field. Emptied, the submenus come back.
 *
 * `iconOnly` draws the trigger as its icon alone, a square as the icon buttons of
 * a toolbar, `label` its accessible name and its tooltip; `align="end"` lines the
 * menu up with the right edge of the trigger, for one at the end of its row.
 */
export function MenuButton({
  label,
  items,
  disabled = false,
  className = "",
  prominent = false,
  icon,
  filterable = false,
  filterLabel = "",
  filterEmpty = "",
  iconOnly = false,
  align = "start",
}: {
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  className?: string;
  /**
   * A menu the page is used for, such as the actions on the selection: a pill,
   * outlined and tinted with the accent, filled when hovered or open. The plain one, for a
   * secondary menu, is muted. A primary button, filled, stays apart from both.
   */
  prominent?: boolean;
  /** Visual placed before the label. */
  icon?: ReactNode;
  /** A field over the entries filtering them; `filterLabel` names it, `filterEmpty` says nothing is kept. */
  filterable?: boolean;
  filterLabel?: string;
  filterEmpty?: string;
  /** The trigger its icon alone, `label` its name and tooltip. */
  iconOnly?: boolean;
  /** The edge of the trigger the menu lines up with. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const filterField = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  // Entry to focus on opening: the first one from the keyboard, none with the mouse.
  const focusOnOpen = useRef<"first" | "last" | null>(null);

  // The entries of the top level only, those that can take the focus: a submenu
  // walks its own.
  function entries(): HTMLElement[] {
    const top = menu.current;
    if (top === null) return [];
    return [...top.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].filter(
      (entry) => entry.parentElement?.closest("[role=menu]") === top && !entry.disabled,
    );
  }

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const target = focusOnOpen.current;
    focusOnOpen.current = null;
    // A menu to filter opens on its field, whatever opened it.
    if (filterable) {
      filterField.current?.focus();
    } else if (target !== null) {
      const list = entries();
      (target === "first" ? list[0] : list[list.length - 1])?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, filterable]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Opened by the mouse, the menu leaves the focus on its button: Escape closes
    // it from there too, and not the side panel listening at the document level.
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const target =
      event.key === "ArrowDown" || event.key === "Enter" || event.key === " "
        ? "first"
        : event.key === "ArrowUp"
          ? "last"
          : null;
    if (target === null) return;
    event.preventDefault();
    if (open) {
      const list = entries();
      (target === "first" ? list[0] : list[list.length - 1])?.focus();
      return;
    }
    focusOnOpen.current = target;
    setOpen(true);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        // From the first entry, back to the field that filters them.
        if (filterable && index <= 0) {
          event.preventDefault();
          filterField.current?.focus();
          break;
        }
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        // The side panel listens for Escape at the document level: close the menu only.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  /** The keys of the field: the arrows go to the entries kept, Enter chooses the first. */
  function onFilterKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const list = entries();
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        (event.key === "ArrowDown" ? list[0] : list[list.length - 1])?.focus();
        break;
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        list[0]?.click();
        break;
      case "Home":
      case "End":
        // The caret of the field, not the entries.
        event.stopPropagation();
        break;
    }
  }

  // Typed in the field: the entries of every level that match, flat, each naming
  // the submenus it is in.
  const needle = query.trim().toLocaleLowerCase();
  const found =
    needle === ""
      ? null
      : leaves(items).filter(({ item, path }) =>
          [
            item.label,
            item.description,
            ...path,
            ...(item.badges ?? []).map((badge) => badge.label),
            ...(item.keywords ?? []),
          ].some((text) => text?.toLocaleLowerCase().includes(needle) ?? false),
        );

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        onKeyDown={onButtonKeyDown}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={
          iconOnly
            ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60 aria-expanded:bg-surface-sunken aria-expanded:text-ink"
            : prominent
              ? "flex h-7 items-center gap-1.5 rounded-(--radius-pill) border border-accent bg-accent-soft pr-2.5 pl-3 font-medium text-ink hover:bg-accent hover:text-accent-ink disabled:opacity-60 aria-expanded:bg-accent aria-expanded:text-accent-ink"
              : "flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-60 aria-expanded:text-ink"
        }
      >
        {icon}
        {!iconOnly && label}
        {!iconOnly && <ChevronDownIcon className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute ${align === "end" ? "right-0 w-max max-w-[min(24rem,calc(100vw-2rem))]" : "left-0"} z-30 mt-1 min-w-56 rounded-(--radius-panel) border border-line bg-surface-raised p-1 shadow-lg`}
        >
          {filterable && (
            <div className="px-1 pt-1 pb-1.5">
              {/* A search field, not a login one: the password managers leave it alone. */}
              <input
                ref={filterField}
                type="search"
                name="menu-filter"
                aria-label={filterLabel}
                placeholder={filterLabel}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                onKeyDown={onFilterKeyDown}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
                className="h-7 w-full rounded-(--radius-control) border border-line bg-surface px-2 outline-none placeholder:text-ink-muted focus:border-accent"
              />
            </div>
          )}
          {found === null ? (
            <MenuList
              items={items}
              onChosen={() => {
                close(true);
              }}
            />
          ) : found.length === 0 ? (
            <p className="px-2 py-1.5 text-ink-muted">{filterEmpty}</p>
          ) : (
            <MenuList
              items={found.map(({ item, path }) => ({
                ...item,
                separatorBefore: false,
                context: path.join(" › "),
              }))}
              onChosen={() => {
                close(true);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The entries to choose of a menu and of its submenus, each with the labels of the submenus it is in. */
function leaves(items: MenuItem[], path: string[] = []): { item: MenuItem; path: string[] }[] {
  return items.flatMap((item) =>
    item.items === undefined ? [{ item, path }] : leaves(item.items, [...path, item.label]),
  );
}

/** An entry as a menu level shows it: in a flat list of found entries, the submenus it is in. */
type ShownItem = MenuItem & { context?: string };

/**
 * How long the pointer may cross other entries on its way to an open submenu
 * before they take over: a diagonal path to a submenu entry lower down passes over
 * them. Coming back to the submenu, or to its opener, within that time keeps it.
 */
const SUBMENU_SWITCH_MS = 250;

/**
 * The entries of one menu level, and which of their submenus is open: one at a
 * time, owned here rather than by each entry so that moving between them is
 * decided in one place. Hovering an entry opens its submenu at once when none is
 * open, after `SUBMENU_SWITCH_MS` when another one is; the keyboard opens and
 * closes at once. Leaving the menu altogether keeps the submenu open, until another
 * entry is hovered or the menu closes.
 */
function MenuList({ items, onChosen }: { items: ShownItem[]; onChosen: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  // What the entry hovered or focused does, said in the foot of the level; nothing
  // shown while no entry is.
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<string | null>(null);
  current.current = openKey;

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  function hover(key: string | null) {
    window.clearTimeout(timer.current);
    if (key === current.current) return;
    if (current.current === null) {
      setOpenKey(key);
      return;
    }
    timer.current = window.setTimeout(() => {
      setOpenKey(key);
    }, SUBMENU_SWITCH_MS);
  }

  function setNow(key: string | null) {
    window.clearTimeout(timer.current);
    setOpenKey(key);
  }

  return (
    <>
      {items.map((item) => (
        <MenuEntry
          key={item.key}
          item={item}
          onChosen={onChosen}
          open={openKey === item.key}
          onHover={() => {
            hover(item.items === undefined ? null : item.key);
          }}
          setOpen={(next) => {
            setNow(next ? item.key : null);
          }}
          onHint={setHint}
        />
      ))}
      {hint !== null && (
        // As wide as the entries, not wider: the description wraps rather than
        // widen the menu. Each entry reads it as its description already.
        <div
          aria-hidden="true"
          style={{ width: 0, minWidth: "100%" }}
          className="mt-1 border-t border-line px-2 pt-1.5 pb-0.5 text-data text-ink-muted"
        >
          {hint}
        </div>
      )}
    </>
  );
}

/**
 * An entry of a menu: a choice, or the opener of a submenu shown beside it. Its
 * menu level says whether the submenu is open (`MenuList`).
 */
function MenuEntry({
  item,
  onChosen,
  open,
  onHover,
  setOpen,
  onHint,
}: {
  item: ShownItem;
  onChosen: () => void;
  open: boolean;
  onHover: () => void;
  setOpen: (open: boolean) => void;
  /** Says what the entry does in the foot of its menu level, or nothing. */
  onHint: (hint: string | null) => void;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const subId = useId();
  const descriptionId = useId();
  const badges = item.badges ?? [];
  const sub = item.items;

  function subEntries(): HTMLElement[] {
    return [
      ...(submenu.current?.querySelectorAll<HTMLElement>(":scope > div > [role=menuitem]") ?? []),
    ];
  }

  function openSub(focus: boolean) {
    setOpen(true);
    if (focus) window.requestAnimationFrame(() => subEntries()[0]?.focus());
  }

  function closeSub() {
    setOpen(false);
    opener.current?.focus();
  }

  function onSubKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = subEntries();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "ArrowLeft":
      case "Escape":
        event.preventDefault();
        closeSub();
        break;
      case "Tab":
        // Leaves the whole menu, as from the top level.
        return;
      default:
        return;
    }
    // The keys a submenu handles do not walk the parent menu too.
    event.stopPropagation();
  }

  return (
    <div
      className="relative"
      // The submenu is inside this element: entering it, through the strip that
      // joins it to the entry, counts as staying here.
      onPointerEnter={() => {
        onHover();
        onHint(item.description ?? null);
      }}
      onPointerLeave={() => {
        onHint(null);
      }}
    >
      {item.separatorBefore === true && (
        <div role="separator" className="my-1 border-t border-line" />
      )}
      <button
        ref={opener}
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={item.disabled}
        aria-haspopup={sub === undefined ? undefined : "menu"}
        aria-expanded={sub === undefined ? undefined : open}
        aria-controls={sub === undefined ? undefined : subId}
        aria-describedby={item.description === undefined ? undefined : descriptionId}
        onFocus={() => {
          onHint(item.description ?? null);
        }}
        onBlur={() => {
          onHint(null);
        }}
        onClick={() => {
          if (sub !== undefined) {
            openSub(true);
            return;
          }
          onChosen();
          item.onSelect?.();
        }}
        onKeyDown={(event) => {
          if (sub !== undefined && event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            openSub(true);
          }
        }}
        className={`${ITEM} ${item.danger === true ? "text-state-down" : ""}`}
      >
        {item.icon}
        <span className="flex flex-1 flex-wrap items-center gap-x-1.5">
          {item.context !== undefined && item.context !== "" && (
            <span className="text-data text-ink-muted">{item.context} ›</span>
          )}
          {item.label}
          {badges.map((badge) => (
            <span
              key={badge.key}
              className={`rounded-(--radius-control) border px-1 text-[0.625rem] leading-4 font-medium whitespace-nowrap ${
                // Greyed with the entry when it cannot be chosen.
                item.disabled === true
                  ? "border-line text-ink-muted/60"
                  : badge.tone === "down"
                    ? "border-state-down text-state-down"
                    : "border-state-warn text-state-warn"
              }`}
            >
              {badge.label}
            </span>
          ))}
        </span>

        {sub !== undefined && <CaretRightIcon className="h-3.5 w-3.5 text-ink-muted" />}
      </button>
      {item.description !== undefined && (
        <span id={descriptionId} className="sr-only">
          {item.description}
        </span>
      )}
      {sub !== undefined && open && (
        // A transparent strip over the menu's padding and border and the gap beside
        // it: the pointer goes from the entry to the submenu without leaving either.
        <div className="absolute -top-1 left-full z-40 pt-1 pl-2">
          <div
            ref={submenu}
            id={subId}
            role="menu"
            aria-label={item.label}
            onKeyDown={onSubKeyDown}
            className="min-w-56 rounded-(--radius-panel) border border-line bg-surface-raised p-1 shadow-lg"
          >
            <MenuList items={sub} onChosen={onChosen} />
          </div>
        </div>
      )}
    </div>
  );
}
