import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import { download } from "@/lib/export/table";
import {
  LIST_KEY,
  deleteObject,
  exportReport,
  useObjectResponsible,
  type ReportObjectKind,
} from "./report-admin";

const BUTTON =
  "flex h-8 items-center gap-1.5 rounded-(--radius-control) border border-line px-3 text-ink hover:bg-surface-sunken disabled:opacity-60";

/**
 * The actions on a report, a chart or a metric, under its properties: editing and
 * deleting it, for whoever may change it, and for a report, its export, for
 * whoever sees it. Deleting removes the publications and the responsibles too,
 * and the series of a historized metric; the history of the definition is kept.
 */
export function ReportObjectActions({
  kind,
  id,
  name,
  onEdit,
  onDeleted,
}: {
  kind: ReportObjectKind;
  id: string;
  name: string;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const responsible = useObjectResponsible(kind, id);
  const editable = responsible.data === true;

  const remove = useMutation({
    mutationFn: () => deleteObject(kind, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [LIST_KEY[kind]] });
      onDeleted();
    },
  });

  const exported = useMutation({
    mutationFn: () => exportReport(id),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
      download(blob, `report-${name.replace(/[^\w.-]+/g, "_") || id}.json`);
    },
  });

  if (!editable && kind !== "report") return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        {editable && (
          <button type="button" onClick={onEdit} className={BUTTON}>
            <PencilIcon />
            {t("reportAdmin.edit")}
          </button>
        )}
        {kind === "report" && (
          <button
            type="button"
            disabled={exported.isPending}
            onClick={() => {
              exported.mutate();
            }}
            className={BUTTON}
            title={t("reportAdmin.exportHint")}
          >
            {exported.isPending ? t("reportAdmin.exporting") : t("reportAdmin.export")}
          </button>
        )}
        {editable && (
          <ConfirmButton
            icon={<TrashIcon />}
            label={t("detail.delete")}
            question={t(`reportAdmin.deleteQuestion.${kind}`, { name })}
            confirmLabel={t("detail.deleteConfirm")}
            cancelLabel={t("detail.cancel")}
            pendingLabel={t("detail.deleting")}
            pending={remove.isPending}
            onConfirm={() => {
              remove.mutate();
            }}
          />
        )}
      </div>
      {remove.isError && (
        <p role="alert" className="text-state-down">
          ■ {remove.error.message}
        </p>
      )}
      {exported.isError && (
        <p role="alert" className="text-state-down">
          ■ {exported.error.message}
        </p>
      )}
    </div>
  );
}
