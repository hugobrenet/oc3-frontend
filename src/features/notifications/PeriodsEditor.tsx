import { useId } from "react";
import { useTranslation } from "react-i18next";
import { DAYS, type NotificationPeriod, type Periods } from "./notifications-api";

const SELECT = "h-8 rounded-(--radius-control) border border-line bg-surface px-2";
const TIME = "h-8 w-24 rounded-(--radius-control) border border-line bg-surface px-2 font-mono";

/**
 * The periods of the week the notifications are sent on, a line per day: always,
 * never, or from a time to another, local time of the collector. A period ending
 * before it begins spans midnight. A day left to always is not stored.
 */
export function PeriodsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Periods;
  onChange: (periods: Periods) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();

  function setDay(day: string, period: NotificationPeriod | undefined) {
    const next = { ...value };
    if (period === undefined || period.period === "always") delete next[day];
    else next[day] = period;
    onChange(next);
  }

  return (
    <div className="grid gap-1.5">
      {DAYS.map((day) => {
        const p = value[day] ?? { period: "always" as const };
        return (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-${day}`} className="w-24">
              {t(`notifications.days.${day}`)}
            </label>
            <select
              id={`${id}-${day}`}
              value={p.period}
              disabled={disabled}
              onChange={(event) => {
                const period = event.target.value as NotificationPeriod["period"];
                setDay(
                  day,
                  period === "custom"
                    ? { period, begin: p.begin ?? "08:00", end: p.end ?? "18:00" }
                    : { period },
                );
              }}
              className={SELECT}
            >
              {(["always", "never", "custom"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`notifications.periods.${v}`)}
                </option>
              ))}
            </select>
            {p.period === "custom" && (
              <>
                <input
                  type="time"
                  aria-label={t("notifications.periods.begin", {
                    day: t(`notifications.days.${day}`),
                  })}
                  value={p.begin ?? ""}
                  disabled={disabled}
                  onChange={(event) => {
                    setDay(day, { ...p, begin: event.target.value });
                  }}
                  className={TIME}
                />
                <span aria-hidden="true">–</span>
                <input
                  type="time"
                  aria-label={t("notifications.periods.end", {
                    day: t(`notifications.days.${day}`),
                  })}
                  value={p.end ?? ""}
                  disabled={disabled}
                  onChange={(event) => {
                    setDay(day, { ...p, end: event.target.value });
                  }}
                  className={TIME}
                />
              </>
            )}
          </div>
        );
      })}
      <p className="text-ink-muted">{t("notifications.periods.hint")}</p>
    </div>
  );
}
