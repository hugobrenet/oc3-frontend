import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SlideOver } from "@/components/ui/SlideOver";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { importReports, type ReportExport } from "./report-admin";

/**
 * Importing reports exported from a collector (Export, in the detail of a report):
 * the JSON file, or its text pasted. The metrics, the charts and the reports it
 * holds are created when no object of their name exists, published to the user's
 * primary team, which is made responsible for them; those of an existing name are
 * kept as they are and used. Creating a metric requires the Manager privilege. The
 * server tells what it did and what it could not do.
 */
export function ReportImportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (body: ReportExport) => importReports(body),
    onSuccess: async () => {
      for (const key of ["reports", "charts", "metrics"])
        await queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  const { reset } = run;

  // Every opening starts from an empty form.
  useEffect(() => {
    if (!open) return;
    setText("");
    setParseError(null);
    reset();
  }, [open, reset]);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    void file.text().then(setText);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let body: ReportExport;
    try {
      body = JSON.parse(text) as ReportExport;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      return;
    }
    setParseError(null);
    run.mutate(body);
  }

  return (
    <SlideOver
      open={open}
      size="wide"
      title={t("reportAdmin.import.title")}
      onClose={onClose}
      closeLabel={t("detail.close")}
      resizeLabel={t("detail.resize")}
      leading={<ObjectIcon kind="report" />}
    >
      <p className="mb-3 text-ink-muted">{t("reportAdmin.import.intro")}</p>
      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="mb-1 block font-medium" htmlFor="import-report-file">
            {t("reportAdmin.import.file")}
          </label>
          <input
            id="import-report-file"
            type="file"
            accept=".json,application/json"
            onChange={onFile}
          />
        </div>
        <div className="mb-3">
          <label className="mb-1 block font-medium" htmlFor="import-report-text">
            {t("reportAdmin.import.text")}
          </label>
          <textarea
            id="import-report-text"
            rows={14}
            spellCheck={false}
            required
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="w-full rounded-(--radius-control) border border-line bg-surface p-2 font-mono text-data"
          />
        </div>
        {parseError !== null && (
          <p role="alert" className="mb-3 text-state-down">
            ■ {t("reportAdmin.import.invalid", { message: parseError })}
          </p>
        )}
        {run.isError && (
          <p role="alert" className="mb-3 text-state-down">
            ■ {run.error.message}
          </p>
        )}
        {run.isSuccess && (
          <div className="mb-3 flex flex-col gap-1" role="status">
            {run.data.info.map((line) => (
              <p key={`i-${line}`}>{line}</p>
            ))}
            {run.data.error.map((line) => (
              <p key={`e-${line}`} className="text-state-down">
                ■ {line}
              </p>
            ))}
          </div>
        )}
        <button
          type="submit"
          disabled={run.isPending}
          className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
        >
          {run.isPending ? t("reportAdmin.import.running") : t("reportAdmin.import.run")}
        </button>
      </form>
    </SlideOver>
  );
}
