/**
 * Which values of a configuration `expand()` expands -- specs/024-glob FR-012.
 *
 * "Every value at a position whose accumulated type admits `glob` (alone, in a list, or in a union)". The accumulated demand
 * (SPEC.md Article VIII, `src/generate/accumulate.ts`) is the schema chain's own answer to "what may sit here", computed from
 * the schema layers alone: this module walks the merged tree beside it, key by key and item by item, and reports the string
 * scalars that land where `glob` is admitted. A value that fails the grammar is not a pattern and is left alone (a
 * configuration that was never validated may hold one; so may a `path | glob` position, where a string that is a path and
 * not a glob is meant as the path).
 *
 * **A frame** is the demand that applies to one value: the alternatives its position's type names, and the position's
 * structure. A named type is a frame of its own -- its body, taken from the tree's declarations -- and applies to the same
 * value (`closure`). Descending into a sequence lowers every alternative by one array level and adds the position's `items`;
 * into a mapping, the position's named key, else its `values`. Nothing here reads a host or the world.
 */

import { accumulate, intersectionKeyOf, type AccumulatedPosition, type AccumulatedTree, type AccumulatedType } from "../generate/accumulate.js";
import type { Layer, MergedConfiguration } from "../merge/provenance.js";
import type { Node, Scalar } from "../model/node.js";
import { extend } from "../extend.js";
import { pointerFromPath } from "../model/pointer.js";
import { checkGlobPattern } from "../validate/glob.js";

export interface GlobValue {
  readonly pointer: string;
  readonly node: Scalar & { readonly kind: "string" };
}

interface Frame {
  /** The alternatives (builtins and references, never a union) that apply to the value, each at its array depth. */
  readonly alternatives: readonly AccumulatedType[];
  /** The position's structure, when the frame is a position (a lowered frame has none of its own). */
  readonly shape: AccumulatedPosition | undefined;
}

function flatten(type: AccumulatedType | "empty" | undefined): readonly AccumulatedType[] {
  if (type === undefined || type === "empty") {
    return [];
  }
  return type.kind === "union" ? type.alternatives.flatMap(flatten) : [type];
}

function frameOf(position: AccumulatedPosition): Frame {
  return { alternatives: flatten(position.type), shape: position };
}

/** The body a reference stands for: the position's own inlined intersection, else the declaration's (or the declarations' intersection's) body. */
function bodyOfReference(tree: AccumulatedTree, reference: Extract<AccumulatedType, { kind: "ref" }>): AccumulatedPosition | undefined {
  if (reference.inlined !== undefined) {
    return reference.inlined;
  }
  const [only, ...others] = reference.declarations;
  if (only !== undefined && others.length === 0) {
    return tree.declarations.find((entry) => entry.declaration === only)?.body;
  }
  return tree.intersections.get(intersectionKeyOf(reference.declarations))?.body;
}

/** `frame` and every frame a depth-0 named type in it brings to the same value, transitively (a type that names itself is walked once). */
function closure(tree: AccumulatedTree, frame: Frame, seen: Set<string> = new Set()): Frame[] {
  const frames = [frame];
  for (const alternative of frame.alternatives) {
    if (alternative.kind !== "ref" || alternative.depth !== 0) {
      continue;
    }
    const key = intersectionKeyOf(alternative.declarations);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const body = bodyOfReference(tree, alternative);
    if (body !== undefined) {
      extend(frames, closure(tree, frameOf(body), seen));
    }
  }
  return frames;
}

/** The frames that apply to each item of a sequence the frames in `frames` apply to. */
function itemFrames(frames: readonly Frame[]): Frame[] {
  const lowered: AccumulatedType[] = [];
  const children: Frame[] = [];
  for (const frame of frames) {
    for (const alternative of frame.alternatives) {
      if (alternative.kind !== "union" && alternative.depth >= 1) {
        lowered.push({ ...alternative, depth: alternative.depth - 1 });
      }
    }
    if (frame.shape?.items !== undefined) {
      children.push(frameOf(frame.shape.items));
    }
  }
  return lowered.length === 0 ? children : [{ alternatives: lowered, shape: undefined }, ...children];
}

/** The frames that apply to the value under `key` of a mapping the frames in `frames` apply to: the named key's position, else the position's `values`. */
function entryFrames(frames: readonly Frame[], key: string): Frame[] {
  const children: Frame[] = [];
  for (const frame of frames) {
    const named = frame.shape?.keys.get(key);
    if (named !== undefined) {
      children.push(frameOf(named.position));
    } else if (frame.shape?.values !== undefined) {
      children.push(frameOf(frame.shape.values));
    }
  }
  return children;
}

function admitsGlob(frames: readonly Frame[]): boolean {
  return frames.some((frame) => frame.alternatives.some((alternative) => alternative.kind === "builtin" && alternative.name === "glob" && alternative.depth === 0));
}

/** Every string value in `configuration` at a position whose accumulated type admits `glob`, in the tree's canonical order. */
export function globValues(configuration: MergedConfiguration): GlobValue[] {
  const schemaLayers: Layer[] = configuration.layers.filter((layer) => layer.role === "schema");
  if (schemaLayers.length === 0) {
    return [];
  }
  const tree = accumulate(schemaLayers).tree;
  const found: GlobValue[] = [];

  function visit(node: Node, inherited: readonly Frame[], path: readonly (string | number)[]): void {
    const frames = inherited.flatMap((frame) => closure(tree, frame));
    if (frames.length === 0) {
      return;
    }
    if (node.type === "scalar") {
      if (node.kind === "string" && admitsGlob(frames) && checkGlobPattern(node.value).ok) {
        found.push({ pointer: pointerFromPath(path), node });
      }
      return;
    }
    if (node.type === "sequence") {
      const children = itemFrames(frames);
      node.items.forEach((item, index) => visit(item, children, [...path, index]));
      return;
    }
    for (const [key, child] of node.entries) {
      visit(child, entryFrames(frames, key), [...path, key]);
    }
  }

  visit(configuration.tree, [frameOf(tree.root)], []);
  return found;
}
