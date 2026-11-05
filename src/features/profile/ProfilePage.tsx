import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TransientNotice } from "@/components/ui/TransientNotice";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { DetailContent } from "@/components/opensvc/DetailPanel";
import { problemText } from "@/lib/api/problem";
import { EDITABLE_USER_GROUPS, USER_GROUPS, USER_PROPS_QUERY } from "@/features/users/user-fields";
import { useSaveUser } from "@/features/users/use-save-user";
import {
  hasSavedViewPrefs,
  usePalettePref,
  useResetViewPrefs,
  useThemePref,
  useLanguagePref,
  usePanelSidePref,
  useDateFormatPref,
  PANEL_SIDES,
  useUserPrefs,
} from "@/lib/user-prefs";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ResetIcon } from "@/components/ui/icons";
import { PALETTES, THEMES } from "@/lib/theme";
import { LANGUAGES, browserLanguage } from "@/lib/language";
import { DATE_FORMATS, HOUR_CYCLES, formatExample } from "@/lib/date-format";
import { UserGroupsParts } from "@/features/users/UserGroupsParts";
import { useUserGroups } from "@/features/users/use-user-groups";
import { isSession, useCredentials } from "@/lib/api/auth";
import { useImpersonation } from "@/lib/api/impersonation";
import { NotificationsCard } from "./NotificationsCard";
import { PasswordSection } from "./PasswordSection";
import { ProfileCard } from "./ProfileCard";

type UserRow = components["schemas"]["UserRow"];

/** The identity of the account, its name and email editable, the rest read only. */
const IDENTITY_GROUP = EDITABLE_USER_GROUPS.find((g) => g.key === "identity");

/**
 * Profile of the signed-in user, opened from their name in the top bar.
 *
 * `GET /users/self` names the caller server side: no need to know their id, and the
 * page stays right if the sign-in email changes case. The historical collector also
 * showed the application codes and the default filterset; the API does not expose
 * them per user yet, see notes.md.
 *
 * A header saying who is signed in, then cards of related settings, on two columns
 * where the screen allows: the account, whose name and email the user may change,
 * and its notifications, read only since the API offers no way to change them; the
 * password; the groups and privileges of the account, read only, across both
 * columns; the appearance; what the account remembers of the lists and of the menu.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["user", "self"],
    queryFn: async () => {
      const { data, error: failure } = await api.GET("/users/{user_id}", {
        params: { path: { user_id: "self" }, query: { props: USER_PROPS_QUERY } },
      });
      if (failure !== undefined) throw new Error(problemText(failure));
      const rows: UserRow[] = Array.isArray(data.data) ? data.data : [];
      return rows[0] ?? null;
    },
  });

  const fullName = [data?.first_name, data?.last_name]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  const saveIdentity = useSaveUser("self", true);
  // Signed in through the identity provider, the name and email are the provider's:
  // the collector refuses to change them, and takes the name again at each sign-in.
  // Acting as another user, the profile shown is that user's.
  const credentials = useCredentials();
  const impersonation = useImpersonation();
  const managedByProvider = isSession(credentials) && impersonation === null;

  /** A group of the account's properties, in a card of its own titled like it. */
  const detailCard = (key: string) => {
    const group = USER_GROUPS.find((g) => g.key === key);
    return (
      <ProfileCard
        title={t(`users.detail.groups.${key}`)}
        family={group?.family}
        hint={t("profile.readOnly")}
      >
        <DetailContent
          groups={group === undefined ? [] : [group]}
          row={data}
          labelPrefix="users.fields"
          groupPrefix="users.detail.groups"
          isPending={isPending}
          errorMessage={isError ? error.message : null}
          groupTitles={false}
          labelWidth={LABEL_WIDTH}
        />
      </ProfileCard>
    );
  };

  return (
    <section className="max-w-5xl">
      <h1 className="sr-only">{t("profile.title")}</h1>
      <header className="mb-4 flex items-center gap-4 rounded-(--radius-panel) border border-line bg-surface-raised p-4">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-title font-semibold text-ink"
        >
          {initials(fullName, data?.email)}
        </span>
        <div className="min-w-0">
          <p className="text-ink-muted">{t("profile.title")}</p>
          <p className="truncate text-title font-semibold">
            {fullName === "" ? (data?.email ?? "…") : fullName}
          </p>
          {data !== undefined && data !== null && (
            <p className="truncate text-ink-muted">
              {[data.email, data.username].filter((v) => v !== undefined && v !== "").join(" · ")}
            </p>
          )}
        </div>
      </header>

      {/* Rows of two cards rather than two independent columns: the cards of a row
          share their height, and every row starts on the same line. The account's
          properties go left, what the user sets goes right. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard
          title={t("users.detail.groups.identity")}
          family={IDENTITY_GROUP?.family}
          hint={managedByProvider ? t("profile.identity.managedHint") : t("profile.identity.hint")}
        >
          <DetailContent
            groups={IDENTITY_GROUP === undefined ? [] : [IDENTITY_GROUP]}
            row={data}
            labelPrefix="users.fields"
            groupPrefix="users.detail.groups"
            isPending={isPending}
            errorMessage={isError ? error.message : null}
            groupTitles={false}
            labelWidth={LABEL_WIDTH}
            onSave={managedByProvider ? undefined : saveIdentity}
            editHint={managedByProvider ? undefined : t("profile.identity.editHint")}
          />
        </ProfileCard>
        <PasswordSection email={data?.email ?? undefined} />
        <GroupsCard />
        <NotificationsCard />
        <AppearanceCard />
        {detailCard("restrictions")}
        <SavedSettingsCard />
      </div>
    </section>
  );
}

/** One label width for every list of the page, so that their values line up. */
const LABEL_WIDTH = "11rem";

/** Up to two letters naming the user: of their name, else of their email. */
function initials(fullName: string, email: string | null | undefined): string {
  const words = fullName.split(/\s+/).filter((w) => w !== "");
  if (words.length > 0)
    return words
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  return (email ?? "?").slice(0, 1).toUpperCase();
}

/**
 * The organisational groups of the account, which decide the nodes and services
 * it sees, and its privilege groups, which decide what it may change: read only,
 * a GroupManager changing them from the Users view. Manager says it grants every
 * privilege, since the other privilege groups then add nothing.
 */
function GroupsCard() {
  const { t } = useTranslation();
  const groups = useUserGroups("self");
  const isManager = groups.data?.some((g) => g.role === "Manager") ?? false;
  return (
    <ProfileCard
      title={t("profile.groups.title")}
      family="team"
      hint={t("profile.groups.hint")}
      className="lg:col-span-2"
    >
      <UserGroupsParts userId="self" readOnly />
      {isManager && <p className="mt-3 text-ink-muted">{t("profile.groups.manager")}</p>}
    </ProfileCard>
  );
}

/**
 * Theme and light or dark mode, the two sides of how the interface looks, its
 * language, and the edge the detail panels open against.
 */
function AppearanceCard() {
  const { t } = useTranslation();
  const theme = useThemePref();
  const palette = usePalettePref();
  const language = useLanguagePref();
  const panelSide = usePanelSidePref();
  const dates = useDateFormatPref();
  return (
    <ProfileCard
      title={t("profile.appearance.title")}
      family="env"
      hint={t("profile.appearance.hint")}
    >
      <div className="grid gap-3">
        <div>
          <p className="mb-1 font-medium">{t("profile.palette.title")}</p>
          <ChoiceGroup
            name="palette"
            label={t("profile.palette.title")}
            options={PALETTES}
            optionLabel={(value) => t(`profile.palette.options.${value}`)}
            choice={palette}
          />
          <p className="mt-1 text-ink-muted">{t("profile.palette.hint")}</p>
        </div>
        <div>
          <p className="mb-1 font-medium">{t("profile.theme.title")}</p>
          <ChoiceGroup
            name="theme"
            label={t("profile.theme.title")}
            options={THEMES}
            optionLabel={(value) => t(`profile.theme.options.${value}`)}
            choice={theme}
          />
        </div>
        <div>
          <p className="mb-1 font-medium">{t("profile.language.title")}</p>
          <ChoiceGroup
            name="language"
            label={t("profile.language.title")}
            options={LANGUAGES}
            optionLabel={(value) =>
              value === "system"
                ? t("profile.language.system", {
                    language: t(`profile.language.options.${browserLanguage()}`),
                  })
                : t(`profile.language.options.${value}`)
            }
            choice={language}
          />
          <p className="mt-1 text-ink-muted">{t("profile.language.hint")}</p>
        </div>
        <div>
          <p className="mb-1 font-medium">{t("profile.dateFormat.title")}</p>
          <ChoiceGroup
            name="dateFormat"
            label={t("profile.dateFormat.title")}
            options={DATE_FORMATS}
            optionLabel={(value) => t(`profile.dateFormat.options.${value}`)}
            // Each convention shown with a moment it formats, under the clock chosen,
            // in a column of its own: the conventions compare at a glance.
            optionDetail={(value) =>
              formatExample({ format: value, hourCycle: dates.hourCycle.value })
            }
            choice={dates.format}
          />
          <p className="mt-2 mb-1 font-medium">{t("profile.hourCycle.title")}</p>
          <ChoiceGroup
            name="hourCycle"
            label={t("profile.hourCycle.title")}
            options={HOUR_CYCLES}
            optionLabel={(value) => t(`profile.hourCycle.options.${value}`)}
            choice={dates.hourCycle}
          />
          <p className="mt-1 text-ink-muted">{t("profile.dateFormat.hint")}</p>
        </div>
        <div>
          <p className="mb-1 font-medium">{t("profile.panelSide.title")}</p>
          <ChoiceGroup
            name="panelSide"
            label={t("profile.panelSide.title")}
            options={PANEL_SIDES}
            optionLabel={(value) => t(`profile.panelSide.options.${value}`)}
            choice={panelSide}
          />
          <p className="mt-1 text-ink-muted">{t("profile.panelSide.hint")}</p>
        </div>
      </div>
    </ProfileCard>
  );
}

/** What the account remembers of the lists, and how to forget it. */
function SavedSettingsCard() {
  const { t } = useTranslation();
  const prefs = useUserPrefs();
  const resetViews = useResetViewPrefs();
  // The reset whose report was dismissed, or left by itself: by when it was asked.
  const [dismissedReset, setDismissedReset] = useState<number | null>(null);
  return (
    <ProfileCard title={t("profile.saved.title")} family="team" hint={t("profile.saved.hint")}>
      <div className="grid gap-3">
        <div>
          <p className="mb-1 font-medium">{t("profile.viewPrefs.title")}</p>
          <p className="mb-2 text-ink-muted">{t("profile.viewPrefs.hint")}</p>
          {hasSavedViewPrefs(prefs.data) ? (
            <ConfirmButton
              icon={<ResetIcon />}
              label={t("profile.viewPrefs.reset")}
              question={t("profile.viewPrefs.question")}
              confirmLabel={t("profile.viewPrefs.confirm")}
              cancelLabel={t("detail.cancel")}
              pendingLabel={t("profile.viewPrefs.pending")}
              pending={resetViews.isPending}
              onConfirm={resetViews.reset}
            />
          ) : (
            <>
              {/* The state in place; the report of the reset floats over the page. */}
              <p className="text-ink-muted">{t("profile.viewPrefs.none")}</p>
              {resetViews.doneAt !== null && dismissedReset !== resetViews.doneAt && (
                <TransientNotice
                  id={resetViews.doneAt}
                  tone="success"
                  text={t("profile.viewPrefs.done")}
                  dismissLabel={t("actionsMenu.dismiss")}
                  onDismiss={() => {
                    setDismissedReset(resetViews.doneAt);
                  }}
                />
              )}
            </>
          )}
          {resetViews.errorMessage !== null && (
            <p role="alert" className="mt-2 text-state-down">
              ■ {resetViews.errorMessage}
            </p>
          )}
        </div>
      </div>
    </ProfileCard>
  );
}

/** Radio group of an appearance choice, saved as soon as it changes. */
function ChoiceGroup<V extends string>({
  name,
  label,
  options,
  optionLabel,
  optionDetail,
  choice,
}: {
  name: string;
  label: string;
  options: readonly V[];
  optionLabel: (value: V) => string;
  /**
   * A second column, such as an example of the option: the options are then
   * stacked, of one width, their labels and details aligned in two columns.
   */
  optionDetail?: (value: V) => string;
  choice: { value: V; set: (value: V) => void; isSaving: boolean; errorMessage: string | null };
}) {
  const stacked = optionDetail !== undefined;
  return (
    <>
      <div
        role="radiogroup"
        aria-label={label}
        className={
          stacked ? "grid w-fit max-w-full grid-cols-[auto_auto] gap-1" : "flex flex-wrap gap-2"
        }
      >
        {options.map((value) => (
          <label
            key={value}
            className={`h-7 cursor-pointer items-center rounded-(--radius-control) border border-line px-3 has-checked:border-accent has-checked:bg-accent-soft has-checked:text-ink ${
              stacked ? "col-span-2 grid grid-cols-subgrid gap-x-6" : "flex gap-1.5"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <input
                type="radio"
                name={name}
                value={value}
                checked={choice.value === value}
                disabled={choice.isSaving}
                onChange={() => {
                  choice.set(value);
                }}
              />
              {optionLabel(value)}
            </span>
            {stacked && (
              <span className="whitespace-nowrap text-ink-muted tabular-nums">
                {optionDetail(value)}
              </span>
            )}
          </label>
        ))}
      </div>
      {choice.errorMessage !== null && (
        <p role="alert" className="mt-2 text-state-down">
          ■ {choice.errorMessage}
        </p>
      )}
    </>
  );
}
