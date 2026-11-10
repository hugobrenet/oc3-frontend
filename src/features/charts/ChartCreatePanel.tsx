import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { SlideOver } from "@/components/ui/SlideOver";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";

type ChartRow = components["schemas"]["ChartRow"];

const INPUT = "h-8 w-full rounded-(--radius-control) border border-line bg-surface px-2";

/**
 * Creating a chart: its name, and its YAML definition if it is already written —
 * the historized metrics it draws, and its options. The historical collector asked
 * for the name alone and the definition was written afterwards; here both may come
 * at once. The server checks that the name is free and that the definition is valid
 * YAML; its refusals are shown as they are, a missing ReportsManager privilege
 * included.
 *
 * Given a chart, the same form edits its name and its definition, for whoever is
 * responsible for it: the new definition is recorded in its history.
 */
export function ChartCreatePanel({
  open,
  chart,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Chart to edit; absent, the form creates one. */
  chart?: ChartRow | null;
  onClose: () => void;
  onCreated?: (id: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");

  const editing = chart !== undefined && chart !== null;

  // Every opening starts again from the chart to edit, or from an empty form.
  useEffect(() => {
    if (!open) return;
    setName(chart?.chart_name ?? "");
    setDefinition(chart?.chart_yaml ?? "");
  }, [open, chart]);

  const create = useMutation({
    mutationFn: async () => {
      const body = { chart_name: name.trim(), chart_yaml: definition };
      const { data, error } =
        editing && chart.id !== undefined
          ? await api.POST("/charts/{chart_id}", {
              params: { path: { chart_id: String(chart.id) } },
              body,
            })
          : await api.POST("/charts", { body });
      if (error !== undefined) throw new Error(problemText(error));
      return Array.isArray(data.data) ? data.data[0]?.id : undefined;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["charts"] });
      if (editing) await queryClient.invalidateQueries({ queryKey: ["chart", String(chart.id)] });
      onCreated?.(id);
      onClose();
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <SlideOver
      open={open}
      size="wide"
      title={editing ? t("reportAdmin.editTitle.chart") : t("charts.form.title")}
      onClose={onClose}
      closeLabel={t("detail.close")}
      resizeLabel={t("detail.resize")}
      leading={<ObjectIcon kind="chart" />}
    >
      {!editing && <p className="mb-3 text-ink-muted">{t("charts.form.intro")}</p>}

      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="mb-1 block font-medium" htmlFor="create-chart-name">
            {t("charts.fields.chart_name")}
          </label>
          <input
            id="create-chart-name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className={INPUT}
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block font-medium" htmlFor="create-chart-yaml">
            {t("charts.fields.chart_yaml")}
          </label>
          <textarea
            id="create-chart-yaml"
            rows={14}
            spellCheck={false}
            value={definition}
            onChange={(event) => {
              setDefinition(event.target.value);
            }}
            placeholder={t("charts.form.yamlPlaceholder")}
            aria-describedby="create-chart-yaml-hint"
            className="w-full rounded-(--radius-control) border border-line bg-surface p-2 font-mono text-data"
          />
          <p id="create-chart-yaml-hint" className="mt-1 text-ink-muted">
            {t("charts.form.yamlHint")}
          </p>
        </div>

        {create.isError && (
          <p role="alert" className="mb-3 text-state-down">
            ■ {create.error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
        >
          {create.isPending ? t("charts.form.saving") : t("charts.form.save")}
        </button>
      </form>
    </SlideOver>
  );
}
