/**
 * A structural tree comparator stricter than `nodesEqual` (src/model/
 * equality.ts): it also compares span (origin id, start, end, line,
 * column) and, for mappings, entry order — properties `nodesEqual`
 * deliberately ignores (§4.2: spans and origins take no part in model
 * equality; canonical order makes two mappings with the same keys always
 * iterate the same way regardless, so order isn't a *discriminating*
 * check there either).
 *
 * Used by tests/unit/determinism.test.ts (same input parsed twice must
 * produce identical trees, positions included) and tests/unit/
 * entry-parity.test.ts (FR-004: valid bytes and the equivalent text must
 * produce identical trees, positions included) — both need the stronger
 * notion of "identical" that `nodesEqual` alone cannot express, since it
 * would pass even if every span were wrong.
 */

import type { Node } from "../../src/model/node.js";

export function identicalTrees(a: Node, b: Node): boolean {
  if (a.type !== b.type) return false;
  const spanEqual = a.span.origin.id === b.span.origin.id && a.span.start === b.span.start && a.span.end === b.span.end && a.span.line === b.span.line && a.span.column === b.span.column;
  if (!spanEqual) return false;

  if (a.type === "scalar" && b.type === "scalar") {
    return a.kind === b.kind && a.value === b.value;
  }
  if (a.type === "mapping" && b.type === "mapping") {
    const keysA = [...a.entries.keys()];
    const keysB = [...b.entries.keys()];
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i += 1) {
      if (keysA[i] !== keysB[i]) return false; // order must match too — canonical order is deterministic
    }
    for (const key of keysA) {
      const valueA = a.entries.get(key);
      const valueB = b.entries.get(key);
      if (valueA === undefined || valueB === undefined || !identicalTrees(valueA, valueB)) return false;
    }
    return true;
  }
  if (a.type === "sequence" && b.type === "sequence") {
    if (a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i += 1) {
      const itemA = a.items[i];
      const itemB = b.items[i];
      if (itemA === undefined || itemB === undefined || !identicalTrees(itemA, itemB)) return false;
    }
    return true;
  }
  return false;
}
