import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { SlideOver } from "@/components/ui/SlideOver";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";

type ReportRow = components["schemas"]["ReportRow"];

const INPUT = "h-8 w-full rounded-(--radius-control) border border-line bg-surface px-2";

/**
 * Creating a report: its name, and its YAML definition if it is already written.
 * The historical collector asked for the name alone and the definition was written
 * afterwards; here both may come at once. The server checks that the name is free
 * and that the definition is valid YAML; its refusals are shown as they are, a
 * missing ReportsManager privilege included.
 *
 * Given a report, the same form edits its name and its definition, for whoever is
 * responsible for it: the new definition is recorded in its history.
 */
export function ReportCreatePanel({
  open,
  report,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Report to edit; absent, the form creates one. */
  report?: ReportRow | null;
  onClose: () => void;
  onCreated?: (id: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");

  const editing = report !== undefined && report !== null;

  // Every opening starts again from the report to edit, or from an empty form.
  useEffect(() => {
    if (!open) return;
    setName(report?.report_name ?? "");
    setDefinition(report?.report_yaml ?? "");
  }, [open, report]);

  const create = useMutation({
    mutationFn: async () => {
      const body = { report_name: name.trim(), report_yaml: definition };
      const { data, error } =
        editing && report.id !== undefined
          ? await api.POST("/reports/{report_id}", {
              params: { path: { report_id: String(report.id) } },
              body,
            })
          : await api.POST("/reports", { body });
      if (error !== undefined) throw new Error(problemText(error));
      return Array.isArray(data.data) ? data.data[0]?.id : undefined;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      if (editing) await queryClient.invalidateQueries({ queryKey: ["report", String(report.id)] });
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
      title={editing ? t("reportAdmin.editTitle.report") : t("reports.form.title")}
      onClose={onClose}
      closeLabel={t("detail.close")}
      resizeLabel={t("detail.resize")}
      leading={<ObjectIcon kind="report" />}
    >
      {!editing && <p className="mb-3 text-ink-muted">{t("reports.form.intro")}</p>}

      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="mb-1 block font-medium" htmlFor="create-report-name">
            {t("reports.fields.report_name")}
          </label>
          <input
            id="create-report-name"
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
          <label className="mb-1 block font-medium" htmlFor="create-report-yaml">
            {t("reports.fields.report_yaml")}
          </label>
          <textarea
            id="create-report-yaml"
            rows={14}
            spellCheck={false}
            value={definition}
            onChange={(event) => {
              setDefinition(event.target.value);
            }}
            placeholder={t("reports.form.yamlPlaceholder")}
            aria-describedby="create-report-yaml-hint"
            className="w-full rounded-(--radius-control) border border-line bg-surface p-2 font-mono text-data"
          />
          <p id="create-report-yaml-hint" className="mt-1 text-ink-muted">
            {t("reports.form.yamlHint")}
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
          {create.isPending ? t("reports.form.saving") : t("reports.form.save")}
        </button>
      </form>
    </SlideOver>
  );
}
