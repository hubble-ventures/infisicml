import type { Binding } from "./types.js";

/**
 * Group bindings by folder path, preserving first-seen order. Every command that
 * reads the vault does so per folder, so this is the shared bucketing step.
 */
export function groupByPath(bindings: Binding[]): Map<string, Binding[]> {
  const groups = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const group = groups.get(binding.path);
    if (group) group.push(binding);
    else groups.set(binding.path, [binding]);
  }
  return groups;
}
