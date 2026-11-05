import { useQuery } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";

export type NotificationChannel = components["schemas"]["NotificationChannel"];
export type NotificationChannelInput = components["schemas"]["NotificationChannelInput"];
export type ChannelType = components["schemas"]["NotificationChannelType"];
export type NotificationSubscription = components["schemas"]["NotificationSubscription"];
export type NotificationSubscriptionInput = components["schemas"]["NotificationSubscriptionInput"];
export type NotificationPeriod = components["schemas"]["NotificationPeriod"];
export type Periods = Record<string, NotificationPeriod>;
export type UserNotifications = components["schemas"]["UserNotifications"];
export type UserNotificationsInput = components["schemas"]["UserNotificationsInput"];
export type NotificationLevel = components["schemas"]["UserNotificationLevel"];

export const CHANNEL_TYPES: ChannelType[] = ["email", "slack", "mattermost", "teams", "webhook"];

/** The types posting to a webhook url, which is their secret. */
export function isWebhook(type: ChannelType): boolean {
  return type !== "email";
}

/** The severities of the dashboard alerts, 0 to 4. */
export const SEVERITIES = ["notice", "warning", "error", "critical", "alert"] as const;

/** The environments of the alerts (dash_env). */
export const ENVS = ["PRD", "PPRD", "REC", "INT", "DEV", "TST", "TMP", "DRP", "FOR", "PRA", "PRJ"];

export const LEVELS: NotificationLevel[] = ["debug", "info", "warning", "error", "critical"];

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const CHANNELS_KEY = ["notifications", "channels"];
export const SUBSCRIPTIONS_KEY = ["notifications", "subscriptions"];
export const DELIVERIES_KEY = ["notifications", "deliveries"];

export function useNotificationChannels() {
  return useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/notifications/channels");
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

export function useNotificationSubscriptions() {
  return useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/notifications/subscriptions");
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** Every group a subscription may send the alerts of, private ones included. */
export function useAllGroups() {
  return useQuery({
    queryKey: ["groups", "all-roles"],
    queryFn: async () => {
      const { data, error } = await api.GET("/groups", {
        params: { query: { props: "id,role", orderby: "role", limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows = Array.isArray(data.data) ? data.data : [];
      return rows.flatMap((row) =>
        typeof row.id === "number" && typeof row.role === "string"
          ? [{ id: row.id, role: row.role }]
          : [],
      );
    },
  });
}

/** The filtersets, with their ids, by name. */
export function useFiltersetIds() {
  return useQuery({
    queryKey: ["filtersets", "ids"],
    queryFn: async () => {
      const { data, error } = await api.GET("/filtersets", {
        params: { query: { props: "id,fset_name", orderby: "fset_name", limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: Record<string, unknown>[] = Array.isArray(data.data) ? data.data : [];
      return rows.flatMap((row) =>
        typeof row.id === "number" && typeof row.fset_name === "string"
          ? [{ id: row.id, name: row.fset_name }]
          : [],
      );
    },
  });
}

export async function saveNotificationChannel(
  id: number | undefined,
  body: NotificationChannelInput,
): Promise<NotificationChannel> {
  const { data, error } =
    id === undefined
      ? await api.POST("/notifications/channels", { body })
      : await api.PUT("/notifications/channels/{channel_id}", {
          params: { path: { channel_id: id } },
          body,
        });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

export async function deleteNotificationChannel(id: number): Promise<void> {
  const { error } = await api.DELETE("/notifications/channels/{channel_id}", {
    params: { path: { channel_id: id } },
  });
  if (error !== undefined) throw new Error(problemText(error));
}

export async function testNotificationChannel(id: number) {
  const { data, error } = await api.POST("/notifications/channels/{channel_id}/test", {
    params: { path: { channel_id: id } },
  });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

export async function saveNotificationSubscription(
  id: number | undefined,
  body: NotificationSubscriptionInput,
): Promise<NotificationSubscription> {
  const { data, error } =
    id === undefined
      ? await api.POST("/notifications/subscriptions", { body })
      : await api.PUT("/notifications/subscriptions/{subscription_id}", {
          params: { path: { subscription_id: id } },
          body,
        });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

export async function deleteNotificationSubscription(id: number): Promise<void> {
  const { error } = await api.DELETE("/notifications/subscriptions/{subscription_id}", {
    params: { path: { subscription_id: id } },
  });
  if (error !== undefined) throw new Error(problemText(error));
}

export function useUserNotifications() {
  return useQuery({
    queryKey: ["user", "self", "notifications"],
    queryFn: async () => {
      const { data, error } = await api.GET("/users/self/notifications");
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
}

export async function saveUserNotifications(
  body: UserNotificationsInput,
): Promise<UserNotifications> {
  const { data, error } = await api.PUT("/users/self/notifications", { body });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

/** A list typed one item per line, or separated by commas. */
export function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
