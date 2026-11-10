import { useTranslation } from "react-i18next";
import { SparklesIcon, UserIcon } from "@/components/ui/icons";

/**
 * The user of an entry, and below, in words, never by a tint alone:
 * - when the action was made as that user by another (impersonation), the
 *   user who really signed in;
 * - when it was made through the AI assistant, or another client of the MCP of
 *   the collector, that client, as it declared it (`log_origin`).
 */
export function LogUser({
  user,
  impersonator,
  origin,
}: {
  user: string | undefined;
  impersonator: string | undefined;
  origin?: string | undefined;
}) {
  const { t } = useTranslation();
  const impersonated = impersonator !== undefined && impersonator !== "";
  const through = origin === "assistant" || origin === "mcp" ? origin : undefined;
  if (!impersonated && through === undefined) return <>{user}</>;
  const label = impersonated
    ? t("logs.impersonatedBy", { impersonator, user: user ?? "" })
    : undefined;
  return (
    <span title={label}>
      {user}
      {impersonated && (
        <span className="mt-0.5 flex items-center gap-1 text-data text-state-warn">
          <UserIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span>{t("logs.via", { impersonator })}</span>
          <span className="sr-only">{label}</span>
        </span>
      )}
      {through !== undefined && (
        <span className="mt-0.5 flex items-center gap-1 text-data text-accent">
          <SparklesIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span>{t(`logs.origin.${through}`)}</span>
        </span>
      )}
    </span>
  );
}
