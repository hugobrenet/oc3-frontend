import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChangeOutcomeLine, TeamsPart } from "@/components/opensvc/CompEditorParts";
import { useChanges } from "@/components/opensvc/comp-changes";
import { useComplianceGroups } from "@/features/designer/use-designer-data";
import {
  HAS_RESPONSIBLES,
  LIST_KEY,
  changeObjectTeam,
  objectKey,
  useObjectResponsible,
  useObjectTeams,
  type ReportObjectKind,
} from "./report-admin";

/**
 * The groups a report, a chart or a metric is published to, whose members see
 * it, and, but for a metric, those responsible for it, who may change it. Whoever
 * may change the object adds and removes them; each change is written at once and
 * its outcome told.
 */
export function ReportObjectTeams({ kind, id }: { kind: ReportObjectKind; id: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const teams = useObjectTeams(kind, id);
  const groups = useComplianceGroups();
  const responsible = useObjectResponsible(kind, id);
  const editable = responsible.data === true;
  const { outcome, busy, change, dismiss } = useChanges(async () => {
    await queryClient.invalidateQueries({ queryKey: objectKey(kind, id) });
    await queryClient.invalidateQueries({ queryKey: [LIST_KEY[kind]] });
  });

  if (teams.isPending) return <p className="text-ink-muted">{t("detail.loading")}</p>;
  if (teams.isError)
    return (
      <p role="alert" className="text-state-down">
        ■ {t("detail.error", { message: teams.error.message })}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <ChangeOutcomeLine outcome={outcome} onDismiss={dismiss} />
      <TeamsPart
        teams={teams.data}
        roles={HAS_RESPONSIBLES[kind] ? undefined : ["publications"]}
        groups={groups.data ?? []}
        editable={editable}
        busy={busy}
        onAdd={(role, group, list) => {
          void change(t("compEditor.teamAdded", { team: group.role, list }), () =>
            changeObjectTeam(kind, id, role, String(group.id), true),
          );
        }}
        onRemove={(role, team, groupId, list) => {
          void change(t("compEditor.teamRemoved", { team, list }), () =>
            changeObjectTeam(kind, id, role, groupId, false),
          );
        }}
      />
      {!editable && responsible.isSuccess && (
        <p className="text-ink-muted">{t(`reportAdmin.teamsReadOnly.${kind}`)}</p>
      )}
    </div>
  );
}
