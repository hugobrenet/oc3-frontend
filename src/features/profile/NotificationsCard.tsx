import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useImpersonation } from "@/lib/api/impersonation";
import { PREFS_KEY } from "@/lib/user-prefs";
import { PeriodsEditor } from "@/features/notifications/PeriodsEditor";
import {
  LEVELS,
  saveUserNotifications,
  useUserNotifications,
  type NotificationLevel,
  type Periods,
  type UserNotifications,
} from "@/features/notifications/notifications-api";
import { ProfileCard } from "./ProfileCard";

const INPUT = "h-8 rounded-(--radius-control) border border-line bg-surface px-2";

interface Draft {
  enabled: boolean;
  level: NotificationLevel;
  delay: string;
  periods: Periods;
}

function draftOf(n: UserNotifications): Draft {
  return {
    enabled: n.email_notifications,
    level: n.email_log_level,
    delay: String(n.email_notifications_delay),
    periods: n.periods,
  };
}

/**
 * The alerts mailed to the user: those of the apps their groups are responsible
 * for, from a level, once old enough, on the periods of the week they choose.
 * Says so when the collector sends no mail. Not while impersonating.
 */
export function NotificationsCard() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const impersonation = useImpersonation();
  const settings = useUserNotifications();
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (settings.data !== undefined) setDraft(draftOf(settings.data));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveUserNotifications({
        email_notifications: d.enabled,
        email_log_level: d.level,
        email_notifications_delay: Number(d.delay) || 0,
        periods: d.periods,
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(["user", "self", "notifications"], data);
      // The periods are in the preferences document: read it again, or the next
      // save of a list setting would write it back without them.
      await queryClient.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
  const readOnly = impersonation !== null;
  const unsaved =
    draft !== null &&
    settings.data !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(draftOf(settings.data));
  const set = (patch: Partial<Draft>) => {
    if (draft !== null) setDraft({ ...draft, ...patch });
    save.reset();
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft !== null) save.mutate(draft);
  }

  return (
    <ProfileCard
      title={t("users.detail.groups.notifications")}
      family="alert"
      hint={t("profile.notifications.hint")}
    >
      {settings.isPending || draft === null ? (
        settings.isError ? (
          <p role="alert" className="text-state-down">
            ■ {settings.error.message}
          </p>
        ) : (
          <p className="text-ink-muted">{t("list.loading")}</p>
        )
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3">
          {settings.data?.mail_enabled === false && (
            <p className="text-state-warn">
              <span aria-hidden="true">▲</span> {t("profile.notifications.mailDisabled")}
            </p>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={readOnly}
              onChange={(event) => {
                set({ enabled: event.target.checked });
              }}
            />
            {t("profile.notifications.enabled", { email: settings.data?.email ?? "" })}
          </label>
          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor={`${id}-level`} className="mb-1 block font-medium">
                {t("profile.notifications.level")}
              </label>
              <select
                id={`${id}-level`}
                value={draft.level}
                disabled={readOnly || !draft.enabled}
                onChange={(event) => {
                  set({ level: event.target.value as NotificationLevel });
                }}
                className={INPUT}
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`profile.notifications.levels.${level}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-delay`} className="mb-1 block font-medium">
                {t("profile.notifications.delay")}
              </label>
              <input
                id={`${id}-delay`}
                type="number"
                min={0}
                max={1440}
                value={draft.delay}
                disabled={readOnly || !draft.enabled}
                onChange={(event) => {
                  set({ delay: event.target.value });
                }}
                className={`${INPUT} w-28`}
              />
            </div>
          </div>
          <div>
            <p className="mb-1 font-medium">{t("profile.notifications.periods")}</p>
            <PeriodsEditor
              value={draft.periods}
              disabled={readOnly || !draft.enabled}
              onChange={(periods) => {
                set({ periods });
              }}
            />
          </div>
          {save.isError && (
            <p role="alert" className="text-state-down">
              ■ {save.error.message}
            </p>
          )}
          {save.isSuccess && !unsaved && (
            <p role="status" className="text-state-up">
              ✓ {t("profile.notifications.saved")}
            </p>
          )}
          {!readOnly && (
            <div>
              <button
                type="submit"
                disabled={save.isPending || !unsaved}
                className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
              >
                {save.isPending ? t("notifications.saving") : t("notifications.save")}
              </button>
            </div>
          )}
        </form>
      )}
    </ProfileCard>
  );
}
