import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { DateTime } from "@/components/ui/DateTime";
import { FormConnectorPanel } from "@/features/form-connectors/FormConnectorPanel";
import { ChannelPanel } from "@/features/notifications/ChannelPanel";

type Opened = { kind: "form_connector" | "notification_channel"; id: number } | null;

/** The connector or the channel opened, read by its id. */
function useOpened(opened: Opened) {
  const connector = useQuery({
    queryKey: ["form-connectors", opened?.id],
    enabled: opened?.kind === "form_connector",
    queryFn: async () => {
      const { data, error } = await api.GET("/form_connectors/{connector_id}", {
        params: { path: { connector_id: opened?.id ?? 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
  const channel = useQuery({
    queryKey: ["notifications", "channels", opened?.id],
    enabled: opened?.kind === "notification_channel",
    queryFn: async () => {
      const { data, error } = await api.GET("/notifications/channels/{channel_id}", {
        params: { path: { channel_id: opened?.id ?? 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
  return { connector, channel };
}

/**
 * The secrets sealed with the safe master key apart from the files: those of
 * the form connectors and of the notification channels, stored encrypted in
 * their own rows. Read only, never their values: what holds them, and the
 * master key they depend on, to know before removing a key whether `oc3 safe
 * rewrap` is still to run. Shown to those managing them.
 */
export function SafeSecretsSection({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<Opened>(null);
  const { connector, channel } = useOpened(opened);
  function close() {
    setOpened(null);
    // The key or the holder may have changed, or the holder be deleted.
    void queryClient.invalidateQueries({ queryKey: ["safe", "secrets"] });
  }
  const secrets = useQuery({
    queryKey: ["safe", "secrets"],
    queryFn: async () => {
      const { data, error } = await api.GET("/safe/secrets");
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
  const stale = secrets.data?.data.filter((s) => !s.key_active).length ?? 0;
  return (
    <section className="mt-8" aria-labelledby="safe-secrets-title">
      <h2 id="safe-secrets-title" className="mb-1 text-title font-semibold">
        {t("safe.secrets.title")}
      </h2>
      <p className="mb-3 max-w-3xl text-ink-muted">{t("safe.secrets.intro")}</p>
      {secrets.isPending ? (
        <p className="text-ink-muted">{t("list.loading")}</p>
      ) : secrets.isError ? (
        <p role="alert" className="text-state-down">
          ■ {secrets.error.message}
        </p>
      ) : secrets.data.data.length === 0 ? (
        <p className="text-ink-muted">{t("safe.secrets.empty")}</p>
      ) : (
        <>
          {stale > 0 && (
            <p className="mb-2 text-state-warn">
              <span aria-hidden="true">▲</span> {t("safe.secrets.stale", { count: stale })}
            </p>
          )}
          <div className="overflow-x-auto rounded-(--radius-panel) border border-line bg-surface-raised">
            <table className="w-full border-collapse text-data">
              <caption className="sr-only">{t("safe.secrets.title")}</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  {["kind", "name", "key", "updated"].map((key) => (
                    <th key={key} scope="col" className="px-3 py-1.5 font-medium whitespace-nowrap">
                      {t(`safe.secrets.fields.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {secrets.data.data.map((s) => (
                  <tr
                    key={`${s.kind}-${String(s.id)}`}
                    className="border-b border-line/60 last:border-b-0"
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {t(`safe.secrets.kinds.${s.kind}`)}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          onOpen?.();
                          setOpened({ kind: s.kind, id: s.id });
                        }}
                        className="text-accent hover:underline"
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono">{s.key_id}</span>{" "}
                      {!s.key_known ? (
                        <span className="text-state-down">■ {t("safe.secrets.keyMissing")}</span>
                      ) : s.key_active ? (
                        <span className="text-ink-muted">{t("safe.secrets.keyActive")}</span>
                      ) : (
                        <span className="text-state-warn">▲ {t("safe.secrets.keyOld")}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <DateTime value={s.updated} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(opened?.kind === "form_connector" ? connector : channel).isError && (
        <p role="alert" className="mt-2 text-state-down">
          ■ {(opened?.kind === "form_connector" ? connector : channel).error?.message}
        </p>
      )}

      <FormConnectorPanel
        open={opened?.kind === "form_connector" && connector.data !== undefined}
        connector={opened?.kind === "form_connector" ? connector.data : undefined}
        onClose={close}
        onSaved={close}
      />
      <ChannelPanel
        open={opened?.kind === "notification_channel" && channel.data !== undefined}
        channel={opened?.kind === "notification_channel" ? channel.data : undefined}
        onClose={close}
        onSaved={close}
      />
    </section>
  );
}
