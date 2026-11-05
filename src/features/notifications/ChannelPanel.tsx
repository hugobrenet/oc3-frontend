import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { SlideOver } from "@/components/ui/SlideOver";
import { TrashIcon } from "@/components/ui/icons";
import {
  CHANNELS_KEY,
  CHANNEL_TYPES,
  SUBSCRIPTIONS_KEY,
  deleteNotificationChannel,
  isWebhook,
  saveNotificationChannel,
  splitList,
  testNotificationChannel,
  type ChannelType,
  type NotificationChannel,
  type NotificationChannelInput,
} from "./notifications-api";

const INPUT = "h-8 w-full rounded-(--radius-control) border border-line bg-surface px-2";
const AREA = "w-full rounded-(--radius-control) border border-line bg-surface px-2 py-1 font-mono";
const FIELDSET = "flex flex-col gap-3 rounded-(--radius-panel) border border-line p-3";

type SecretKey = "url" | "secret";

interface Draft {
  name: string;
  type: ChannelType;
  description: string;
  enabled: boolean;
  addresses: string;
  username: string;
  iconUrl: string;
  networks: string;
  /** Values typed: they replace the secrets set; empty, they keep them. */
  secrets: Record<SecretKey, string>;
  /** The secrets to remove. */
  removed: SecretKey[];
}

const EMPTY: Draft = {
  name: "",
  type: "email",
  description: "",
  enabled: true,
  addresses: "",
  username: "",
  iconUrl: "",
  networks: "",
  secrets: { url: "", secret: "" },
  removed: [],
};

function draftOf(c: NotificationChannel): Draft {
  return {
    name: c.name,
    type: c.type,
    description: c.description,
    enabled: c.enabled,
    addresses: c.addresses.join("\n"),
    username: c.username ?? "",
    iconUrl: c.icon_url ?? "",
    networks: c.networks.join("\n"),
    secrets: { url: "", secret: "" },
    removed: [],
  };
}

function inputOf(d: Draft): NotificationChannelInput {
  const secrets: Record<string, string | null> = {};
  for (const key of ["url", "secret"] as const) {
    if (d.removed.includes(key)) secrets[key] = null;
    else if (d.secrets[key].trim() !== "") secrets[key] = d.secrets[key].trim();
  }
  return {
    name: d.name.trim(),
    type: d.type,
    description: d.description,
    enabled: d.enabled,
    addresses: d.type === "email" ? splitList(d.addresses) : [],
    username: d.username.trim(),
    icon_url: d.iconUrl.trim(),
    networks: isWebhook(d.type) ? splitList(d.networks) : [],
    secrets,
  };
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint !== undefined && <p className="mt-1 text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Creating or editing a channel of the notifications: a list of mail addresses,
 * or a Slack, Mattermost, Teams or generic webhook. Its secrets, the webhook url
 * and the signing secret, are write-only: the form tells whether each one is set,
 * a value typed replaces it, "remove" drops it, an empty field keeps it. A saved
 * channel can be sent a test message from here.
 */
export function ChannelPanel({
  open,
  channel,
  onClose,
  onSaved,
}: {
  open: boolean;
  channel?: NotificationChannel;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const editing = channel !== undefined;
  const saved = useMemo(() => (editing ? draftOf(channel) : EMPTY), [editing, channel]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  useEffect(() => {
    if (open) setDraft(saved);
  }, [open, saved]);
  const unsaved = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
  };

  const save = useMutation({
    mutationFn: () => saveNotificationChannel(channel?.id, inputOf(draft)),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
      await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      onSaved(result.id);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteNotificationChannel(channel?.id ?? 0),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
      await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      onClose();
    },
  });
  const test = useMutation({ mutationFn: () => testNotificationChannel(channel?.id ?? 0) });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const secret = (key: SecretKey) => {
    const removed = draft.removed.includes(key);
    const isSet = channel?.secrets[key] === true && !removed;
    const fieldId = `${id}-secret-${key}`;
    return (
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="font-medium" htmlFor={fieldId}>
            {t(`notifications.channel.secret.${key}`)}
          </label>
          <span className="text-ink-muted">
            {isSet ? (
              <>
                <span aria-hidden="true">●</span> {t("formConnectors.secret.set")}
              </>
            ) : removed ? (
              t("formConnectors.secret.removed")
            ) : (
              t("formConnectors.secret.unset")
            )}
          </span>
          {channel?.secrets[key] === true && (
            <button
              type="button"
              className="ml-auto text-accent hover:underline"
              onClick={() => {
                set({
                  removed: removed
                    ? draft.removed.filter((k) => k !== key)
                    : [...draft.removed, key],
                  secrets: { ...draft.secrets, [key]: "" },
                });
              }}
            >
              {removed ? t("formConnectors.secret.keep") : t("formConnectors.secret.remove")}
            </button>
          )}
        </div>
        <input
          id={fieldId}
          type="password"
          autoComplete="new-password"
          disabled={removed}
          value={draft.secrets[key]}
          onChange={(event) => {
            set({ secrets: { ...draft.secrets, [key]: event.target.value } });
          }}
          placeholder={isSet ? t("formConnectors.secret.keepHint") : ""}
          className={`${INPUT} font-mono`}
        />
        <p className="mt-1 text-ink-muted">
          {t(`notifications.channel.secretHint.${key === "url" ? draft.type : "secret"}`)}
        </p>
      </div>
    );
  };

  return (
    <SlideOver
      closeOnOutsideClick={!unsaved}
      open={open}
      title={
        editing
          ? t("notifications.channel.editTitle", { name: channel.name })
          : t("notifications.channel.createTitle")
      }
      onClose={onClose}
      closeLabel={t("detail.close")}
      resizeLabel={t("detail.resize")}
      leading={<ObjectIcon kind="notification" />}
      size="wide"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset className={FIELDSET}>
          <legend className="px-1 font-medium">{t("formConnectors.form.general")}</legend>
          <Field
            id={`${id}-name`}
            label={t("notifications.fields.name")}
            hint={t("notifications.channel.nameHint")}
          >
            <input
              id={`${id}-name`}
              value={draft.name}
              onChange={(event) => {
                set({ name: event.target.value });
              }}
              placeholder="ops-mattermost"
              className={`${INPUT} font-mono`}
            />
          </Field>
          <Field id={`${id}-type`} label={t("notifications.fields.type")}>
            <select
              id={`${id}-type`}
              value={draft.type}
              onChange={(event) => {
                set({ type: event.target.value as ChannelType });
              }}
              className={INPUT}
            >
              {CHANNEL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`notifications.types.${type}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-description`} label={t("notifications.fields.description")}>
            <input
              id={`${id}-description`}
              value={draft.description}
              onChange={(event) => {
                set({ description: event.target.value });
              }}
              className={INPUT}
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                set({ enabled: event.target.checked });
              }}
            />
            {t("notifications.channel.enabled")}
          </label>
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className="px-1 font-medium">{t("notifications.channel.destination")}</legend>
          {draft.type === "email" ? (
            <Field
              id={`${id}-addresses`}
              label={t("notifications.fields.addresses")}
              hint={t("notifications.channel.addressesHint")}
            >
              <textarea
                id={`${id}-addresses`}
                rows={3}
                value={draft.addresses}
                onChange={(event) => {
                  set({ addresses: event.target.value });
                }}
                placeholder="ops@example.com"
                spellCheck={false}
                className={AREA}
              />
            </Field>
          ) : (
            <>
              {secret("url")}
              {draft.type === "webhook" && secret("secret")}
              {(draft.type === "slack" || draft.type === "mattermost") && (
                <>
                  <Field
                    id={`${id}-username`}
                    label={t("notifications.fields.username")}
                    hint={t("notifications.channel.usernameHint")}
                  >
                    <input
                      id={`${id}-username`}
                      value={draft.username}
                      onChange={(event) => {
                        set({ username: event.target.value });
                      }}
                      placeholder="collector"
                      className={INPUT}
                    />
                  </Field>
                  <Field id={`${id}-icon`} label={t("notifications.fields.icon_url")}>
                    <input
                      id={`${id}-icon`}
                      value={draft.iconUrl}
                      onChange={(event) => {
                        set({ iconUrl: event.target.value });
                      }}
                      placeholder="https://"
                      className={`${INPUT} font-mono`}
                    />
                  </Field>
                </>
              )}
              <Field
                id={`${id}-networks`}
                label={t("notifications.fields.networks")}
                hint={t("notifications.channel.networksHint")}
              >
                <textarea
                  id={`${id}-networks`}
                  rows={2}
                  value={draft.networks}
                  onChange={(event) => {
                    set({ networks: event.target.value });
                  }}
                  placeholder="10.0.0.0/8"
                  spellCheck={false}
                  className={AREA}
                />
              </Field>
            </>
          )}
        </fieldset>

        {save.isError && (
          <p role="alert" className="text-state-down">
            ■ {save.error.message}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending || !unsaved}
            className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
          >
            {save.isPending ? t("notifications.saving") : t("notifications.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-(--radius-control) border border-line bg-surface px-3 hover:border-line-strong"
          >
            {t("detail.cancel")}
          </button>
        </div>
      </form>

      {editing && (
        <>
          <section className="mt-6 border-t border-line pt-4">
            <h3 className="mb-1 font-semibold">{t("notifications.channel.testTitle")}</h3>
            <p className="mb-2 text-ink-muted">{t("notifications.channel.testIntro")}</p>
            <button
              type="button"
              disabled={test.isPending}
              onClick={() => {
                test.mutate();
              }}
              className="h-8 rounded-(--radius-control) border border-line bg-surface px-3 font-medium hover:bg-surface-sunken disabled:opacity-60"
            >
              {test.isPending
                ? t("notifications.channel.testRunning")
                : t("notifications.channel.testRun")}
            </button>
            {test.isError && (
              <p role="alert" className="mt-2 text-state-down">
                ■ {test.error.message}
              </p>
            )}
            {test.data !== undefined && (
              <p
                role="status"
                className={`mt-2 ${test.data.ok ? "text-state-up" : "text-state-down"}`}
              >
                {test.data.ok
                  ? `✓ ${t("notifications.channel.testOk", { ms: test.data.duration_ms })}`
                  : `■ ${t("notifications.channel.testFailed", { message: test.data.error ?? "" })}`}
              </p>
            )}
          </section>
          <div className="mt-6 border-t border-line pt-4">
            {remove.isError && (
              <p role="alert" className="mb-2 text-state-down">
                ■ {remove.error.message}
              </p>
            )}
            <ConfirmButton
              label={t("notifications.channel.delete")}
              question={t("notifications.channel.deleteQuestion", { name: channel.name })}
              confirmLabel={t("formConnectors.form.deleteConfirm")}
              cancelLabel={t("designer.cancel")}
              pendingLabel={t("formConnectors.form.deleting")}
              pending={remove.isPending}
              icon={<TrashIcon className="h-3.5 w-3.5" />}
              onConfirm={() => {
                remove.mutate();
              }}
            />
          </div>
        </>
      )}
    </SlideOver>
  );
}
