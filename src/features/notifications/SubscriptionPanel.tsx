import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { SlideOver } from "@/components/ui/SlideOver";
import { TrashIcon } from "@/components/ui/icons";
import { PeriodsEditor } from "./PeriodsEditor";
import {
  ENVS,
  SEVERITIES,
  SUBSCRIPTIONS_KEY,
  deleteNotificationSubscription,
  saveNotificationSubscription,
  splitList,
  useAllGroups,
  useFiltersetIds,
  useNotificationChannels,
  type NotificationSubscription,
  type NotificationSubscriptionInput,
  type Periods,
} from "./notifications-api";

const INPUT = "h-8 w-full rounded-(--radius-control) border border-line bg-surface px-2";
const AREA = "w-full rounded-(--radius-control) border border-line bg-surface px-2 py-1 font-mono";
const FIELDSET = "flex flex-col gap-3 rounded-(--radius-panel) border border-line p-3";

interface Draft {
  channelId: string;
  groupId: string;
  scope: "responsible" | "all";
  minSeverity: number;
  delayMin: string;
  enabled: boolean;
  typesInclude: string;
  typesExclude: string;
  envs: string[];
  filtersetId: string;
  periods: Periods;
  notifyResolved: boolean;
}

const EMPTY: Draft = {
  channelId: "",
  groupId: "",
  scope: "responsible",
  minSeverity: 1,
  delayMin: "0",
  enabled: true,
  typesInclude: "",
  typesExclude: "",
  envs: [],
  filtersetId: "",
  periods: {},
  notifyResolved: false,
};

function draftOf(s: NotificationSubscription): Draft {
  return {
    channelId: String(s.channel_id),
    groupId: String(s.group_id),
    scope: s.scope,
    minSeverity: s.min_severity,
    delayMin: String(s.delay_min),
    enabled: s.enabled,
    typesInclude: s.types_include.join("\n"),
    typesExclude: s.types_exclude.join("\n"),
    envs: s.envs,
    filtersetId:
      s.filterset_id === undefined || s.filterset_id === null ? "" : String(s.filterset_id),
    periods: s.periods,
    notifyResolved: s.notify_resolved,
  };
}

function inputOf(d: Draft): NotificationSubscriptionInput {
  return {
    channel_id: Number(d.channelId),
    group_id: Number(d.groupId),
    scope: d.scope,
    min_severity: d.minSeverity,
    delay_min: Number(d.delayMin) || 0,
    enabled: d.enabled,
    types_include: splitList(d.typesInclude),
    types_exclude: splitList(d.typesExclude),
    envs: d.envs,
    filterset_id: d.filtersetId === "" ? null : Number(d.filtersetId),
    periods: d.periods,
    notify_resolved: d.notifyResolved,
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
 * Creating or editing a subscription: the alerts of a group sent to a channel,
 * those of the apps it is responsible for or all of them, from a severity, after
 * a delay, filtered by types, environments and a filterset, on periods of the
 * week, their resolution announced or not.
 */
export function SubscriptionPanel({
  open,
  subscription,
  defaultChannelId,
  onClose,
}: {
  open: boolean;
  subscription?: NotificationSubscription;
  defaultChannelId?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const channels = useNotificationChannels();
  const groups = useAllGroups();
  const filtersets = useFiltersetIds();
  const editing = subscription !== undefined;
  const saved = useMemo(
    () =>
      editing
        ? draftOf(subscription)
        : { ...EMPTY, channelId: defaultChannelId === undefined ? "" : String(defaultChannelId) },
    [editing, subscription, defaultChannelId],
  );
  const [draft, setDraft] = useState<Draft>(EMPTY);
  useEffect(() => {
    if (open) setDraft(saved);
  }, [open, saved]);
  const unsaved = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
  };

  const save = useMutation({
    mutationFn: () => saveNotificationSubscription(subscription?.id, inputOf(draft)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteNotificationSubscription(subscription?.id ?? 0),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      onClose();
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const complete = draft.channelId !== "" && draft.groupId !== "";

  return (
    <SlideOver
      closeOnOutsideClick={!unsaved}
      open={open}
      title={
        editing
          ? t("notifications.subscription.editTitle")
          : t("notifications.subscription.createTitle")
      }
      onClose={onClose}
      closeLabel={t("detail.close")}
      resizeLabel={t("detail.resize")}
      leading={<ObjectIcon kind="notification" />}
      size="wide"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset className={FIELDSET}>
          <legend className="px-1 font-medium">{t("notifications.subscription.who")}</legend>
          <Field id={`${id}-channel`} label={t("notifications.fields.channel")}>
            <select
              id={`${id}-channel`}
              value={draft.channelId}
              onChange={(event) => {
                set({ channelId: event.target.value });
              }}
              className={INPUT}
            >
              <option value="">—</option>
              {(channels.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({t(`notifications.types.${c.type}`)})
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-group`} label={t("notifications.fields.group")}>
            <Combobox
              id={`${id}-group`}
              label={t("notifications.fields.group")}
              options={(groups.data ?? []).map((g) => ({ value: String(g.id), label: g.role }))}
              value={draft.groupId}
              onChange={(value) => {
                set({ groupId: value });
              }}
              emptyText={t("notifications.none")}
              inputClassName="h-8"
            />
          </Field>
          <div role="radiogroup" aria-labelledby={`${id}-scope`}>
            <p id={`${id}-scope`} className="mb-1 font-medium">
              {t("notifications.fields.scope")}
            </p>
            {(["responsible", "all"] as const).map((scope) => (
              <label key={scope} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`${id}-scope`}
                  checked={draft.scope === scope}
                  onChange={() => {
                    set({ scope });
                  }}
                  className="mt-1"
                />
                <span>{t(`notifications.scope.${scope}`)}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                set({ enabled: event.target.checked });
              }}
            />
            {t("notifications.subscription.enabled")}
          </label>
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className="px-1 font-medium">{t("notifications.subscription.which")}</legend>
          <div className="flex flex-wrap gap-4">
            <Field id={`${id}-severity`} label={t("notifications.fields.min_severity")}>
              <select
                id={`${id}-severity`}
                value={draft.minSeverity}
                onChange={(event) => {
                  set({ minSeverity: Number(event.target.value) });
                }}
                className={INPUT}
              >
                {SEVERITIES.map((s, i) => (
                  <option key={s} value={i}>
                    {t(`notifications.severities.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-delay`} label={t("notifications.fields.delay_min")}>
              <input
                id={`${id}-delay`}
                type="number"
                min={0}
                max={1440}
                value={draft.delayMin}
                onChange={(event) => {
                  set({ delayMin: event.target.value });
                }}
                className={`${INPUT} w-28`}
              />
            </Field>
          </div>
          <Field
            id={`${id}-include`}
            label={t("notifications.fields.types_include")}
            hint={t("notifications.subscription.typesHint")}
          >
            <textarea
              id={`${id}-include`}
              rows={2}
              value={draft.typesInclude}
              onChange={(event) => {
                set({ typesInclude: event.target.value });
              }}
              placeholder="service unavailable"
              spellCheck={false}
              className={AREA}
            />
          </Field>
          <Field id={`${id}-exclude`} label={t("notifications.fields.types_exclude")}>
            <textarea
              id={`${id}-exclude`}
              rows={2}
              value={draft.typesExclude}
              onChange={(event) => {
                set({ typesExclude: event.target.value });
              }}
              placeholder="node not updated"
              spellCheck={false}
              className={AREA}
            />
          </Field>
          <div role="group" aria-labelledby={`${id}-envs`}>
            <p id={`${id}-envs`} className="mb-1 font-medium">
              {t("notifications.fields.envs")}
            </p>
            <div className="flex flex-wrap gap-3">
              {ENVS.map((env) => (
                <label key={env} className="flex items-center gap-1.5 font-mono">
                  <input
                    type="checkbox"
                    checked={draft.envs.includes(env)}
                    onChange={(event) => {
                      set({
                        envs: event.target.checked
                          ? [...draft.envs, env]
                          : draft.envs.filter((e) => e !== env),
                      });
                    }}
                  />
                  {env}
                </label>
              ))}
            </div>
            <p className="mt-1 text-ink-muted">{t("notifications.subscription.envsHint")}</p>
          </div>
          <Field
            id={`${id}-fset`}
            label={t("notifications.fields.filterset")}
            hint={t("notifications.subscription.filtersetHint")}
          >
            <Combobox
              id={`${id}-fset`}
              label={t("notifications.fields.filterset")}
              options={[
                { value: "", label: t("notifications.subscription.noFilterset") },
                ...(filtersets.data ?? []).map((f) => ({ value: String(f.id), label: f.name })),
              ]}
              value={draft.filtersetId}
              onChange={(value) => {
                set({ filtersetId: value });
              }}
              emptyText={t("notifications.none")}
              inputClassName="h-8"
            />
          </Field>
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className="px-1 font-medium">{t("notifications.subscription.when")}</legend>
          <PeriodsEditor
            value={draft.periods}
            onChange={(periods) => {
              set({ periods });
            }}
          />
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.notifyResolved}
              onChange={(event) => {
                set({ notifyResolved: event.target.checked });
              }}
              className="mt-1"
            />
            <span>{t("notifications.subscription.resolved")}</span>
          </label>
        </fieldset>

        {save.isError && (
          <p role="alert" className="text-state-down">
            ■ {save.error.message}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending || !complete || !unsaved}
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
        <div className="mt-6 border-t border-line pt-4">
          {remove.isError && (
            <p role="alert" className="mb-2 text-state-down">
              ■ {remove.error.message}
            </p>
          )}
          <ConfirmButton
            label={t("notifications.subscription.delete")}
            question={t("notifications.subscription.deleteQuestion", {
              group: subscription.group_role,
              channel: subscription.channel_name,
            })}
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
      )}
    </SlideOver>
  );
}
