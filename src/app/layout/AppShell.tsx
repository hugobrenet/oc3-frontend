import { useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuthStatus, useCredentials } from "@/lib/api/auth";
import { useEffectiveUser, useImpersonation } from "@/lib/api/impersonation";
import { AboutPage } from "@/features/about/AboutPage";
import { SignIn } from "@/features/auth/SignIn";
import opensvcLogo from "@/assets/opensvc-logo.svg";
import { Sidebar } from "./Sidebar";
import { PeekPanel } from "./PeekPanel";
import { PanelAnchor } from "./PanelAnchor";
import { PanelSideProvider } from "./PanelSideProvider";
import { SessionExpiredBanner, SessionProbe } from "./SessionState";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { useShortcut } from "@/lib/shortcuts";
import { ActionQueueLink } from "@/features/actions/ActionQueueLink";
import { UserMenu } from "./UserMenu";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { NoticeRegion } from "@/components/ui/NoticeRegion";
import { usePanelSide } from "@/components/ui/panel-side";
import { LiveIndicator } from "./LiveIndicator";
import { SessionFilter } from "./SessionFilter";
import { SidebarIcon } from "@/components/ui/icons";
import { useAppearance, useNavViewPref } from "@/lib/user-prefs";
import { BookmarksBar } from "./BookmarksBar";
import { BookmarksProvider } from "./BookmarksProvider";
import { GlobalSearch } from "./search/GlobalSearch";
import { AssistantChatProvider } from "@/features/assistant/assistant-chat-context";
import { AssistantDock } from "@/features/assistant/AssistantDock";
import { assistantClient } from "@/features/assistant/assistant-client";

const SIDEBAR_KEY = "oc3.sidebar";

/** Folding the menu is a display comfort, specific to the browser: it does not go in the URL. */
function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    // Private browsing or storage refused: the menu opens, as by default.
    return true;
  }
}

/**
 * Application shell. It mirrors the functional areas of the collector: navigation in
 * a side menu, session filter, action queue, global search.
 */
export function AppShell() {
  const { t } = useTranslation();
  const credentials = useCredentials();
  // The chat of the assistant belongs to an identity: another one, by a sign-in or
  // an impersonation, starts it afresh, the turn of the former one stopped. Given
  // to the provider rather than as its key, which would remount every page.
  const impersonated = useImpersonation()?.userId ?? null;
  const assistantKey = JSON.stringify([credentials?.user ?? "", impersonated]);
  const status = useAuthStatus();
  const user = useEffectiveUser();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);

  function toggleSidebar() {
    setSidebarOpen((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "open" : "closed");
      } catch {
        // Preference not remembered: without consequence for the current session.
      }
      return next;
    });
  }

  // "n", for navigation, moves the focus to the menu, in its filter field, ready to type
  // the name of a view; the arrows go on to the entries. It unfolds the menu first when it
  // is folded: the focus waits for it to leave `inert`.
  useShortcut("n", () => {
    if (!sidebarOpen) toggleSidebar();
    window.requestAnimationFrame(() => {
      const menu = document.getElementById("app-sidebar");
      const field = menu?.querySelector<HTMLInputElement>('input[type="search"]');
      if (field !== null && field !== undefined) {
        field.focus();
        // A filter left from a previous visit is selected, to be typed over.
        field.select();
      } else menu?.querySelector<HTMLElement>("a, button")?.focus();
    });
    return true;
  });

  // "v", for view, switches the menu between operator and admin; it unfolds the menu
  // first when it is folded, so that the switch shows.
  const navView = useNavViewPref();
  useShortcut("v", () => {
    if (!sidebarOpen) toggleSidebar();
    navView.setView(navView.view === "operator" ? "admin" : "operator");
    return true;
  });

  // At load, an OIDC session may be there: its cookie is HttpOnly, only the server
  // can tell. Nothing is drawn meanwhile, rather than a sign-in screen flashing by.
  if (status === "checking") return <SessionProbe />;

  // As long as nobody is signed in, no view has data to show: the sign-in screen is
  // displayed instead, without the tools of the interface. About stays open: what it
  // tells of the personal data is worth reading before signing in.
  if (credentials === null) {
    return (
      <div className="min-h-dvh bg-surface px-4 text-ink">
        {pathname === "/about" ? (
          <>
            <AboutPage />
            <p className="mx-auto max-w-3xl p-4">
              <Link to="/" className="text-accent underline-offset-2 hover:underline">
                {t("auth.signIn")}
              </Link>
            </p>
          </>
        ) : (
          <SignIn />
        )}
      </div>
    );
  }

  return (
    <BookmarksProvider>
      <PanelSideProvider>
        <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-surface text-ink">
          <AccountAppearance />
          <div>
            <header className="flex h-11 items-center gap-4 border-b border-line bg-surface-raised px-3">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-expanded={sidebarOpen}
                aria-controls="app-sidebar"
                title={`${sidebarOpen ? t("nav.hideMenu") : t("nav.showMenu")}\n${t("nav.menuShortcut")}`}
                className="flex h-7 w-7 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                <SidebarIcon open={sidebarOpen} className="h-4.5 w-4.5" />
                <span className="sr-only">
                  {sidebarOpen ? t("nav.hideMenu") : t("nav.showMenu")}
                </span>
              </button>

              <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
                {/* Decorative: the title that follows already names the link. */}
                <img src={opensvcLogo} alt="" width={24} height={24} className="h-6 w-6" />
                OpenSVC Collector
              </Link>

              <div className="ml-auto flex items-center gap-3">
                <SessionFilter />
                <ActionQueueLink />
                <GlobalSearch />
                <LiveIndicator />
                <UserMenu user={user ?? credentials.user} />
              </div>
            </header>
            <ImpersonationBanner />
            {status === "expired" && <SessionExpiredBanner />}
            <NoticeRegion />
          </div>

          {/* The chat of the assistant, held for every page: a turn goes on while
              the user looks at another one, its progress in the menu. */}
          <AssistantChatProvider identity={assistantKey} client={assistantClient}>
            <div className="grid min-h-0 grid-cols-[auto_1fr]">
              <Sidebar open={sidebarOpen} />
              <MainArea>
                <Outlet />
                {/* Record of an object opened from a badge, whatever the view. */}
                <PeekPanel />
                {/* What brings the panels back once they are closed. */}
                <PanelAnchor />
                <ShortcutsHelp />
              </MainArea>
            </div>
            {/* The chat over the page on display, opened from a record. */}
            <AssistantDock />
          </AssistantChatProvider>
          {/* The records the user bookmarked, at the foot of every view. */}
          <BookmarksBar />
        </div>
      </PanelSideProvider>
    </BookmarksProvider>
  );
}

/**
 * Applies the signed-in account's mode and palette. A component of its own, rendered
 * only once someone is signed in: before that, reading the preferences would be
 * refused.
 */
function AccountAppearance() {
  useAppearance();
  return null;
}

/**
 * The area of the views. With the panels on the left, its gutter on that side is
 * as wide as the anchor that brings them back, which stands there (`PanelAnchor`)
 * without covering the start of the view.
 */
function MainArea({ children }: { children: ReactNode }) {
  const { side } = usePanelSide();
  return <main className={`min-w-0 p-4 ${side === "left" ? "pl-12" : ""}`}>{children}</main>;
}
