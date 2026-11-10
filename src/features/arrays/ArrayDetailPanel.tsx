import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChangeOutcomeLine } from "@/components/opensvc/CompEditorParts";
import { useChanges } from "@/components/opensvc/comp-changes";
import { CrossLink } from "@/components/opensvc/CrossLink";
import { DetailContent, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { RelatedTable, type RelatedColumn } from "@/components/opensvc/RelatedTable";
import { RelatedTabsPanel } from "@/components/opensvc/RelatedTabsPanel";
import type { RelatedTab } from "@/components/opensvc/related-tabs";
import { Combobox } from "@/components/ui/Combobox";
import { DateTime } from "@/components/ui/DateTime";
import { SearchBox } from "@/components/ui/SearchBox";
import { DatabaseIcon, NetworkIcon } from "@/components/ui/icons";
import { api } from "@/lib/api/client";
import { hasPrivilege, useEffectivePrivileges } from "@/lib/api/effective-privileges";
import { problemText } from "@/lib/api/problem";
import { matchesSearch } from "@/lib/search-match";
import {
  changeArrayProxy,
  setArrayComment,
  useArray,
  useArrayDiskgroups,
  useArrayProxies,
  useArrayTargets,
  useNodeChoices,
  type ArrayRow,
  type ArrayTargetRow,
  type DiskGroupRow,
} from "./use-arrays";

const text = (prop: keyof ArrayRow) => (row: ArrayRow) => {
  const value = row[prop];
  return value === undefined || value === null || value === "" ? undefined : String(value);
};

const GROUPS: DetailGroup<ArrayRow>[] = [
  {
    key: "identity",
    family: "disk",
    fields: [
      { prop: "array_name", format: text("array_name") },
      { prop: "array_model", format: text("array_model") },
      { prop: "array_firmware", format: text("array_firmware") },
      { prop: "array_cache", format: text("array_cache") },
      { prop: "array_level", format: text("array_level") },
      { prop: "array_comment", format: text("array_comment"), editable: true },
    ],
  },
  {
    key: "record",
    family: "time",
    fields: [
      {
        prop: "array_updated",
        format: text("array_updated"),
        render: (row) => (row.array_updated ? <DateTime value={row.array_updated} /> : null),
      },
      { prop: "id", format: text("id") },
    ],
  },
];

/** Whether the user may change the arrays: a StorageManager, a Manager. */
function useCanManageArrays(): boolean {
  const privileges = useEffectivePrivileges();
  return privileges.data !== undefined && hasPrivilege(privileges.data, ["StorageManager"]);
}

/**
 * The nodes whose agent inventories the array, its proxies: a node pushing the
 * array becomes one by itself, a StorageManager sets or unsets them here.
 */
function ArrayProxies({ arrayId }: { arrayId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = useCanManageArrays();
  const proxies = useArrayProxies(arrayId);
  const nodes = useNodeChoices(editable);
  const { outcome, busy, change, dismiss } = useChanges(async () => {
    await queryClient.invalidateQueries({ queryKey: ["array", arrayId, "proxies"] });
  });
  const own = new Set((proxies.data ?? []).map((p) => p.nodeId));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-ink-muted">{t("arrays.proxies.title")}</h3>
      <p className="text-ink-muted">{t("arrays.proxies.intro")}</p>
      <ChangeOutcomeLine outcome={outcome} onDismiss={dismiss} />
      {proxies.isPending ? (
        <p className="text-ink-muted">{t("detail.loading")}</p>
      ) : proxies.isError ? (
        <p role="alert" className="text-state-down">
          ■ {proxies.error.message}
        </p>
      ) : proxies.data.length === 0 ? (
        <p className="text-ink-muted">{t("arrays.proxies.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {proxies.data.map((p) => (
            <li
              key={p.nodeId}
              className="flex items-center gap-1 rounded-(--radius-control) border border-line px-2 py-0.5"
            >
              <CrossLink kind="node" id={p.nodeId}>
                {p.nodename}
              </CrossLink>
              {editable && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("arrays.proxies.remove", { node: p.nodename })}
                  title={t("arrays.proxies.remove", { node: p.nodename })}
                  onClick={() => {
                    void change(t("arrays.proxies.removed", { node: p.nodename }), () =>
                      changeArrayProxy(arrayId, p.nodeId, false),
                    );
                  }}
                  className="text-ink-muted hover:text-state-down"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Combobox
          options={(nodes.data ?? [])
            .filter((n) => !own.has(n.nodeId))
            .map((n) => ({ value: n.nodeId, label: n.nodename }))}
          value=""
          onChange={(nodeId) => {
            const node = nodes.data?.find((n) => n.nodeId === nodeId);
            void change(t("arrays.proxies.added", { node: node?.nodename ?? nodeId }), () =>
              changeArrayProxy(arrayId, nodeId, true),
            );
          }}
          label={t("arrays.proxies.add")}
          placeholder={t("arrays.proxies.add")}
          emptyText={t("arrays.proxies.noMatch")}
          className="w-full max-w-sm"
        />
      )}
    </div>
  );
}

/** The disk groups of the array, their sizes in MB, and what their quotas reserve. */
function ArrayDiskgroups({ arrayId }: { arrayId: string }) {
  const { t } = useTranslation();
  const dgs = useArrayDiskgroups(arrayId);
  const size = (v: number | undefined) => (v === undefined ? null : v.toLocaleString());
  const columns: RelatedColumn<DiskGroupRow>[] = [
    { key: "dg_name", label: t("arrays.dg.dg_name"), render: (row) => row.dg_name, grow: true },
    {
      key: "dg_size",
      label: t("arrays.dg.dg_size"),
      render: (row) => size(row.dg_size),
      numeric: true,
    },
    {
      key: "dg_used",
      label: t("arrays.dg.dg_used"),
      render: (row) => size(row.dg_used),
      numeric: true,
    },
    {
      key: "dg_free",
      label: t("arrays.dg.dg_free"),
      render: (row) => size(row.dg_free),
      numeric: true,
    },
    {
      key: "dg_reserved",
      label: t("arrays.dg.dg_reserved"),
      render: (row) => size(row.dg_reserved),
      numeric: true,
    },
    {
      key: "dg_updated",
      label: t("arrays.dg.dg_updated"),
      render: (row) => (row.dg_updated ? <DateTime value={row.dg_updated} /> : null),
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-muted">{t("arrays.dg.intro")}</p>
      <RelatedTable
        columns={columns}
        groups={[{ key: "all", label: "", rows: dgs.data ?? [] }]}
        rowKey={(row) => String(row.id)}
        isPending={dgs.isPending}
        errorMessage={dgs.isError ? dgs.error.message : null}
        empty={t("arrays.dg.empty")}
        caption={t("arrays.tabs.diskgroups")}
      />
    </div>
  );
}

/** The target ports of the array, by WWN. */
function ArrayTargets({ arrayId }: { arrayId: string }) {
  const { t } = useTranslation();
  const targets = useArrayTargets(arrayId);
  const columns: RelatedColumn<ArrayTargetRow>[] = [
    {
      key: "array_tgtid",
      label: t("arrays.targets.array_tgtid"),
      render: (row) => <code>{row.array_tgtid}</code>,
      grow: true,
    },
    {
      key: "updated",
      label: t("arrays.targets.updated"),
      render: (row) => (row.updated ? <DateTime value={row.updated} /> : null),
    },
  ];
  return (
    <RelatedTable
      columns={columns}
      groups={[{ key: "all", label: "", rows: targets.data ?? [] }]}
      rowKey={(row) => String(row.id)}
      isPending={targets.isPending}
      errorMessage={targets.isError ? targets.error.message : null}
      empty={t("arrays.targets.empty")}
      caption={t("arrays.tabs.targets")}
    />
  );
}

interface ArrayDiskUse {
  disk_id?: string;
  disk_devid?: string;
  disk_name?: string;
  disk_size?: number;
  disk_group?: string;
  "svcdisks.node_id"?: string;
  "nodes.nodename"?: string;
  "svcdisks.svc_id"?: string;
  "services.svcname"?: string;
}

const DISK_PROPS = [
  "disk_id",
  "disk_devid",
  "disk_name",
  "disk_size",
  "disk_group",
  "svcdisks.node_id",
  "nodes.nodename",
  "svcdisks.svc_id",
  "services.svcname",
].join(",");

/**
 * The luns of the array, one row per use a node reports, with the node and the
 * service using it. A search narrows the list on the id, the name, the disk
 * group, the node and the service.
 */
function ArrayDisks({ arrayId }: { arrayId: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const disks = useQuery({
    queryKey: ["array", arrayId, "disks"],
    queryFn: async () => {
      const { data, error } = await api.GET("/arrays/{array_id}/disks", {
        params: { path: { array_id: arrayId }, query: { props: DISK_PROPS, limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return Array.isArray(data.data) ? (data.data as ArrayDiskUse[]) : [];
    },
  });
  const needle = query.trim().toLowerCase();
  const rows = (disks.data ?? []).filter((row) =>
    matchesSearch(
      needle,
      row.disk_id,
      row.disk_name,
      row.disk_group,
      row["nodes.nodename"],
      row["services.svcname"],
    ),
  );
  const columns: RelatedColumn<ArrayDiskUse>[] = [
    {
      key: "disk_id",
      label: t("arrays.disks.disk_id"),
      render: (row) => <code className="break-all">{row.disk_id}</code>,
      grow: true,
    },
    { key: "disk_devid", label: t("arrays.disks.disk_devid"), render: (row) => row.disk_devid },
    { key: "disk_name", label: t("arrays.disks.disk_name"), render: (row) => row.disk_name },
    {
      key: "disk_size",
      label: t("arrays.disks.disk_size"),
      render: (row) => row.disk_size?.toLocaleString(),
      numeric: true,
    },
    { key: "disk_group", label: t("arrays.disks.disk_group"), render: (row) => row.disk_group },
    {
      key: "node",
      label: t("arrays.disks.node"),
      render: (row) =>
        row["svcdisks.node_id"] ? (
          <CrossLink kind="node" id={row["svcdisks.node_id"]}>
            {row["nodes.nodename"] ?? row["svcdisks.node_id"]}
          </CrossLink>
        ) : null,
    },
    {
      key: "service",
      label: t("arrays.disks.service"),
      render: (row) =>
        row["svcdisks.svc_id"] ? (
          <CrossLink kind="service" id={row["svcdisks.svc_id"]}>
            {row["services.svcname"] ?? row["svcdisks.svc_id"]}
          </CrossLink>
        ) : null,
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <SearchBox value={query} onChange={setQuery} label={t("arrays.disks.search")} />
      <RelatedTable
        columns={columns}
        groups={[{ key: "all", label: "", rows }]}
        rowKey={(row) =>
          `${row.disk_id ?? ""}/${row["svcdisks.node_id"] ?? ""}/${row["svcdisks.svc_id"] ?? ""}`
        }
        isPending={disks.isPending}
        errorMessage={disks.isError ? disks.error.message : null}
        empty={t("arrays.disks.empty")}
        caption={t("arrays.tabs.disks")}
      />
    </div>
  );
}

const ARRAY_TABS: RelatedTab[] = [
  {
    key: "diskgroups",
    labelKey: "arrays.tabs.diskgroups",
    icon: <DatabaseIcon className="h-3.5 w-3.5 text-icon-disk" />,
    useSummary: (id) => ({ count: useArrayDiskgroups(id).data?.length }),
    render: (id) => <ArrayDiskgroups arrayId={id} />,
  },
  {
    key: "disks",
    labelKey: "arrays.tabs.disks",
    icon: <DatabaseIcon className="h-3.5 w-3.5 text-icon-disk" />,
    useSummary: () => ({ count: undefined }),
    render: (id) => <ArrayDisks arrayId={id} />,
  },
  {
    key: "targets",
    labelKey: "arrays.tabs.targets",
    icon: <NetworkIcon className="h-3.5 w-3.5 text-icon-network" />,
    useSummary: (id) => ({ count: useArrayTargets(id).data?.length }),
    render: (id) => <ArrayTargets arrayId={id} />,
  },
];

/**
 * A storage array: its properties, as its proxies report it, and its comment, the
 * one a StorageManager writes; the nodes inventorying it; then its disk groups,
 * its luns and their uses, and its target ports. The open tab lives in the URL
 * (`tab`), held by the view.
 */
export function ArrayDetailPanel({
  arrayId,
  label,
  onClose,
  tab,
  onTabChange,
}: {
  arrayId: string | undefined;
  label: string;
  onClose: () => void;
  tab: string | undefined;
  onTabChange: (tab: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: array, isPending, isError, error } = useArray(arrayId);
  const editable = useCanManageArrays();
  const save = useMutation({
    mutationFn: async (changes: Record<string, string | number | boolean>) => {
      if (arrayId === undefined || !("array_comment" in changes)) return;
      await setArrayComment(arrayId, String(changes.array_comment));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["array", arrayId] });
      await queryClient.invalidateQueries({ queryKey: ["arrays"] });
    },
  });
  const open = arrayId !== undefined;

  return (
    <RelatedTabsPanel
      open={open}
      title={array?.array_name ?? (label === "" ? t("arrays.detail.title") : label)}
      kind="array"
      onClose={onClose}
      objectId={arrayId}
      tabs={ARRAY_TABS}
      tab={tab}
      onTabChange={onTabChange}
      propertiesFamily="disk"
      label={t("arrays.detail.tabs")}
    >
      <DetailContent
        groups={GROUPS}
        row={array}
        labelPrefix="arrays.fields"
        groupPrefix="arrays.detail.groups"
        isPending={open && isPending}
        errorMessage={isError ? error.message : null}
        onSave={editable ? (changes) => save.mutateAsync(changes) : undefined}
        editHint={editable ? t("arrays.detail.editHint") : ""}
        actions={arrayId === undefined ? undefined : <ArrayProxies arrayId={arrayId} />}
      />
    </RelatedTabsPanel>
  );
}
