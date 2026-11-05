import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { DateTime } from "@/components/ui/DateTime";
import { ChannelPanel } from "./ChannelPanel";
import { DeliveriesList } from "./DeliveriesList";
import { SubscriptionPanel } from "./SubscriptionPanel";
import {
  SEVERITIES,
  useNotificationChannels,
  useNotificationSubscriptions,
  type NotificationChannel,
  type NotificationSubscription,
} from "./notifications-api";

const BUTTON = "h-7 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink";
const TABLE = "overflow-x-auto rounded-(--radius-panel) border border-line bg-surface-raised";
const TH = "px-3 py-1.5 font-medium whitespace-nowrap";
const TD = "px-3 py-1.5";

/** A section of the page: its title, an action beside it, a line saying what it is. */
function Section({
  title,
  intro,
  action,
  children,
}: {
  title: string;
  intro: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-title font-semibold">{title}</h2>
        {action}
      </div>
      <p className="mb-3 max-w-3xl text-ink-muted">{intro}</p>
      {children}
    </section>
  );
}

function Status({
  pending,
  error,
  empty,
  emptyText,
}: {
  pending: boolean;
  error: Error | null;
  empty: boolean;
  emptyText: string;
}) {
  const { t } = useTranslation();
  if (pending) return <p className="text-ink-muted">{t("list.loading")}</p>;
  if (error !== null)
    return (
      <p role="alert" className="text-state-down">
        ■ {error.message}
      </p>
    );
  if (empty) return <p className="text-ink-muted">{emptyText}</p>;
  return null;
}

/** The filters of a subscription, in words. */
function filtersOf(
  s: NotificationSubscription,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const l: string[] = [];
  if (s.types_include.length > 0)
    l.push(t("notifications.filters.include", { types: s.types_include.join(", ") }));
  if (s.types_exclude.length > 0)
    l.push(t("notifications.filters.exclude", { types: s.types_exclude.join(", ") }));
  if (s.envs.length > 0) l.push(t("notifications.filters.envs", { envs: s.envs.join(", ") }));
  if (s.filterset_id !== undefined && s.filterset_id !== null)
    l.push(t("notifications.filters.filterset", { id: s.filterset_id }));
  if (Object.keys(s.periods).length > 0) l.push(t("notifications.filters.periods"));
  if (s.notify_resolved) l.push(t("notifications.filters.resolved"));
  return l;
}

/**
 * The notifications of the alerts: the channels they go to (mail lists, Slack,
 * Mattermost, Teams, generic webhooks), the subscriptions of the groups to them,
 * and the latest deliveries, to see what went where and what failed. The users
 * set their own mails in their profile. For the AlertsManagers.
 */
export function NotificationsPage() {
  const { t } = useTranslation();
  const channels = useNotificationChannels();
  const subscriptions = useNotificationSubscriptions();
  const [channel, setChannel] = useState<NotificationChannel | "new" | undefined>();
  const [subscription, setSubscription] = useState<NotificationSubscription | "new" | undefined>();

  return (
    <section>
      <h1 className="mb-3 flex items-center gap-2 text-title font-semibold">
        <ObjectIcon kind="notification" className="h-5 w-5" />
        {t("notifications.title")}
      </h1>
      <p className="mb-6 max-w-3xl text-ink-muted">{t("notifications.intro")}</p>

      <Section
        title={t("notifications.channels.title")}
        intro={t("notifications.channels.intro")}
        action={
          <button
            type="button"
            onClick={() => {
              setChannel("new");
            }}
            className={BUTTON}
          >
            {t("notifications.channels.new")}
          </button>
        }
      >
        <Status
          pending={channels.isPending}
          error={channels.error}
          empty={channels.data?.length === 0}
          emptyText={t("notifications.channels.empty")}
        />
        {channels.data !== undefined && channels.data.length > 0 && (
          <div className={TABLE}>
            <table className="w-full border-collapse text-data">
              <caption className="sr-only">{t("notifications.channels.title")}</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  {["name", "type", "destination", "subscriptions", "updated"].map((key) => (
                    <th key={key} scope="col" className={TH}>
                      {t(`notifications.fields.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.data.map((c) => {
                  const subs = subscriptions.data?.filter((s) => s.channel_id === c.id) ?? [];
                  return (
                    <tr key={c.id} className="border-b border-line/60 align-top last:border-b-0">
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <button
                          type="button"
                          onClick={() => {
                            setChannel(c);
                          }}
                          className="font-mono font-medium text-accent hover:underline"
                        >
                          {c.name}
                        </button>
                        {!c.enabled && (
                          <span className="ml-2 text-ink-muted">
                            ({t("notifications.disabled")})
                          </span>
                        )}
                        {c.description !== "" && (
                          <span className="block text-ink-muted">{c.description}</span>
                        )}
                      </th>
                      <td className={`${TD} whitespace-nowrap`}>
                        {t(`notifications.types.${c.type}`)}
                      </td>
                      <td className={`${TD} break-all`}>
                        {c.type === "email" ? (
                          <span className="font-mono">{c.addresses.join(", ")}</span>
                        ) : c.secrets.url ? (
                          <span className="text-ink-muted">
                            <span aria-hidden="true">●</span> {t("notifications.channels.urlSet")}
                            {c.secrets.secret && ` · ${t("notifications.channels.signed")}`}
                          </span>
                        ) : (
                          <span className="text-state-warn">
                            <span aria-hidden="true">▲</span> {t("notifications.channels.noUrl")}
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        {subs.length === 0 ? (
                          <span className="text-state-warn">
                            <span aria-hidden="true">▲</span>{" "}
                            {t("notifications.channels.noSubscription")}
                          </span>
                        ) : (
                          subs.map((s) => s.group_role).join(", ")
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <DateTime value={c.updated} />
                        {c.updated_by !== "" && (
                          <span className="block text-ink-muted">{c.updated_by}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title={t("notifications.subscriptions.title")}
        intro={t("notifications.subscriptions.intro")}
        action={
          <button
            type="button"
            disabled={(channels.data?.length ?? 0) === 0}
            onClick={() => {
              setSubscription("new");
            }}
            className={`${BUTTON} disabled:opacity-60`}
          >
            {t("notifications.subscriptions.new")}
          </button>
        }
      >
        <Status
          pending={subscriptions.isPending}
          error={subscriptions.error}
          empty={subscriptions.data?.length === 0}
          emptyText={t("notifications.subscriptions.empty")}
        />
        {subscriptions.data !== undefined && subscriptions.data.length > 0 && (
          <div className={TABLE}>
            <table className="w-full border-collapse text-data">
              <caption className="sr-only">{t("notifications.subscriptions.title")}</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  {["group", "channel", "scope", "min_severity", "delay_min", "filters"].map(
                    (key) => (
                      <th key={key} scope="col" className={TH}>
                        {t(`notifications.fields.${key}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {subscriptions.data.map((s) => {
                  const filters = filtersOf(s, t);
                  return (
                    <tr key={s.id} className="border-b border-line/60 align-top last:border-b-0">
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <button
                          type="button"
                          onClick={() => {
                            setSubscription(s);
                          }}
                          className="font-medium text-accent hover:underline"
                        >
                          {s.group_role}
                        </button>
                        {!s.enabled && (
                          <span className="ml-2 text-ink-muted">
                            ({t("notifications.disabled")})
                          </span>
                        )}
                      </th>
                      <td className={`${TD} font-mono`}>{s.channel_name}</td>
                      <td className={TD}>{t(`notifications.scopeShort.${s.scope}`)}</td>
                      <td className={TD}>
                        {t(`notifications.severities.${SEVERITIES[s.min_severity] ?? "notice"}`)}
                      </td>
                      <td className={TD}>{s.delay_min}</td>
                      <td className={TD}>
                        {filters.length === 0 ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          filters.join(" · ")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title={t("notifications.deliveries.title")}
        intro={t("notifications.deliveries.intro")}
      >
        <DeliveriesList />
      </Section>

      <ChannelPanel
        open={channel !== undefined}
        channel={channel === "new" ? undefined : channel}
        onClose={() => {
          setChannel(undefined);
        }}
        onSaved={() => {
          setChannel(undefined);
        }}
      />
      <SubscriptionPanel
        open={subscription !== undefined}
        subscription={subscription === "new" ? undefined : subscription}
        onClose={() => {
          setSubscription(undefined);
        }}
      />
    </section>
  );
}
