import type {
  Binding,
  BindingChange,
  CompiledManifest,
  ManifestDelta,
  SettingChange,
} from "./types.js";

/**
 * Structural diff of two compiled manifests, keyed by emitted variable. Because
 * both inputs are already normalized and sorted, this is a stable set-diff — the
 * same two manifests always produce the same delta, which is what makes it safe
 * to gate a PR on.
 *
 * Operates purely on declarations; it never reads secret values.
 */
export function diffCompiled(
  base: CompiledManifest,
  head: CompiledManifest
): ManifestDelta {
  const baseByVar = new Map(base.bindings.map((b) => [b.targetVar, b]));
  const headByVar = new Map(head.bindings.map((b) => [b.targetVar, b]));

  const added: Binding[] = [];
  const removed: Binding[] = [];
  const changed: BindingChange[] = [];

  for (const [targetVar, headBinding] of headByVar) {
    const baseBinding = baseByVar.get(targetVar);
    if (!baseBinding) {
      added.push(headBinding);
    } else if (!sameSource(baseBinding, headBinding)) {
      changed.push({ targetVar, from: baseBinding, to: headBinding });
    }
  }
  for (const [targetVar, baseBinding] of baseByVar) {
    if (!headByVar.has(targetVar)) removed.push(baseBinding);
  }

  return {
    added: added.sort(byTarget),
    removed: removed.sort(byTarget),
    changed: changed.sort((a, b) => a.targetVar.localeCompare(b.targetVar)),
    settings: diffSettings(base, head),
  };
}

export function isEmptyDelta(delta: ManifestDelta): boolean {
  return (
    delta.added.length === 0 &&
    delta.removed.length === 0 &&
    delta.changed.length === 0 &&
    delta.settings.length === 0
  );
}

/** Render a delta as GitHub-flavored Markdown (PR comment / job summary). */
export function renderDeltaMarkdown(delta: ManifestDelta, title: string): string {
  if (isEmptyDelta(delta)) {
    return `### ${title}\n\n_No secret manifest changes._\n`;
  }
  const lines = [`### ${title}`, ""];
  if (delta.settings.length > 0) {
    lines.push("**Settings**", "");
    for (const s of delta.settings) {
      lines.push(`- \`${s.field}\`: \`${s.from}\` → \`${s.to}\``);
    }
    lines.push("");
  }
  lines.push("| Change | Variable | Source |", "| --- | --- | --- |");
  for (const b of delta.added) {
    lines.push(`| \`+ added\` | \`${b.targetVar}\` | ${sourceCell(b)} |`);
  }
  for (const b of delta.removed) {
    lines.push(`| \`- removed\` | \`${b.targetVar}\` | ${sourceCell(b)} |`);
  }
  for (const c of delta.changed) {
    lines.push(
      `| \`~ changed\` | \`${c.targetVar}\` | ${sourceCell(c.from)} → ${sourceCell(c.to)} |`
    );
  }
  lines.push(
    "",
    `_${delta.added.length} added · ${delta.removed.length} removed · ${delta.changed.length} changed_`,
    ""
  );
  return lines.join("\n");
}

/** Render a delta as plain text (CLI). */
export function renderDeltaText(delta: ManifestDelta): string {
  if (isEmptyDelta(delta)) return "No secret manifest changes.";
  const lines: string[] = [];
  for (const s of delta.settings) {
    lines.push(`~ ${s.field}: ${s.from} → ${s.to}`);
  }
  for (const b of delta.added) {
    lines.push(`+ ${b.targetVar}  ← ${b.path}:${b.sourceKey}`);
  }
  for (const b of delta.removed) {
    lines.push(`- ${b.targetVar}  ← ${b.path}:${b.sourceKey}`);
  }
  for (const c of delta.changed) {
    lines.push(
      `~ ${c.targetVar}  ${c.from.path}:${c.from.sourceKey} → ${c.to.path}:${c.to.sourceKey}`
    );
  }
  return lines.join("\n");
}

function sameSource(a: Binding, b: Binding): boolean {
  return (
    a.path === b.path &&
    a.sourceKey === b.sourceKey &&
    a.optional === b.optional
  );
}

function diffSettings(
  base: CompiledManifest,
  head: CompiledManifest
): SettingChange[] {
  const changes: SettingChange[] = [];
  const fields: Array<keyof CompiledManifest> = [
    "project",
    "environment",
    "fetch",
    "output",
  ];
  for (const field of fields) {
    const from = String(base[field]);
    const to = String(head[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

function sourceCell(binding: Binding): string {
  const optional = binding.optional ? " _(optional)_" : "";
  return `\`${binding.path}:${binding.sourceKey}\`${optional}`;
}

function byTarget(a: Binding, b: Binding): number {
  return a.targetVar.localeCompare(b.targetVar);
}
