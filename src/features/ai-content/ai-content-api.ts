import { useQuery } from "@tanstack/react-query";
import type { ObjectKind } from "@/components/opensvc/ObjectIcon";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";

export type AIBackend = components["schemas"]["AIBackend"];
export type AIResourceMeta = components["schemas"]["AIResourceMeta"];
export type AIResource = components["schemas"]["AIResource"];
export type AIResourceInput = components["schemas"]["AIResourceInput"];
export type AISkillMeta = components["schemas"]["AISkillMeta"];
export type AISkill = components["schemas"]["AISkill"];
export type AISkillInput = components["schemas"]["AISkillInput"];
export type AIMimeType = NonNullable<AIResourceInput["mime_type"]>;

export const AI_BACKENDS: AIBackend[] = ["oc3", "om3"];
export const AI_MIME_TYPES: AIMimeType[] = ["text/markdown", "text/plain"];

/** The two kinds of texts the assistant reads, and where the API keeps them. */
export type AIContentKind = "resources" | "skills";

export const KIND_ICON: Record<AIContentKind, ObjectKind> = {
  resources: "aiResource",
  skills: "aiSkill",
};

export const aiContentKey = (kind: AIContentKind, name?: string) =>
  name === undefined ? ["ai-content", kind] : ["ai-content", kind, name];

/** The resources, their metadata only, by name. */
export function useAIResources(enabled = true) {
  return useQuery({
    queryKey: aiContentKey("resources"),
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/ai/resources");
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** The skills, their metadata and frontmatter only, by name. */
export function useAISkills(enabled = true) {
  return useQuery({
    queryKey: aiContentKey("skills"),
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/ai/skills");
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** A resource with its body, to edit it. */
export function useAIResource(name: string | undefined) {
  return useQuery({
    queryKey: aiContentKey("resources", name),
    enabled: name !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET("/ai/resources/{name}", {
        params: { path: { name: name ?? "" } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
}

/** A skill with its SKILL.md, to edit it. */
export function useAISkill(name: string | undefined) {
  return useQuery({
    queryKey: aiContentKey("skills", name),
    enabled: name !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET("/ai/skills/{name}", {
        params: { path: { name: name ?? "" } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
}

/** The groups a text may be published to: all of them, private ones included. */
export function useAIGroups() {
  return useQuery({
    queryKey: ["groups", "all-roles"],
    queryFn: async () => {
      const { data, error } = await api.GET("/groups", {
        params: { query: { props: "id,role", orderby: "role", limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows = Array.isArray(data.data) ? data.data : [];
      return rows.flatMap((row) =>
        typeof row.id === "number" && typeof row.role === "string"
          ? [{ id: row.id, role: row.role }]
          : [],
      );
    },
  });
}

/** Creates a resource, or replaces one, its name kept: its saved metadata. */
export async function saveAIResource(
  name: string | undefined,
  body: AIResourceInput,
): Promise<AIResourceMeta> {
  const { data, error } =
    name === undefined
      ? await api.POST("/ai/resources", { body })
      : await api.PUT("/ai/resources/{name}", { params: { path: { name } }, body });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

/** Creates a skill, or replaces one, its name kept: its saved metadata. */
export async function saveAISkill(
  name: string | undefined,
  body: AISkillInput,
): Promise<AISkillMeta> {
  const { data, error } =
    name === undefined
      ? await api.POST("/ai/skills", { body })
      : await api.PUT("/ai/skills/{name}", { params: { path: { name } }, body });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

export async function deleteAIContent(kind: AIContentKind, name: string): Promise<void> {
  const { error } =
    kind === "resources"
      ? await api.DELETE("/ai/resources/{name}", { params: { path: { name } } })
      : await api.DELETE("/ai/skills/{name}", { params: { path: { name } } });
  if (error !== undefined) throw new Error(problemText(error));
}
