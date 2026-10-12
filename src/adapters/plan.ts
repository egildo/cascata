/**
 * What a format's writer answers when asked to replace, add or remove (v1.15): the bytes to put in a range of the
 * document as opened, or the refusal. The format-blind part (`edit.ts`) turns a plan into an `Edit` and reads it back.
 */

import type { DiagnosticCode } from "../diagnostics/codes.js";
import type { RelatedSpan } from "../diagnostics/diagnostic.js";
import type { SourceSpan } from "../model/span.js";

export type Plan =
  | { readonly ok: true; readonly start: number; readonly end: number; readonly text: string }
  | {
      readonly ok: false;
      readonly code: DiagnosticCode;
      readonly message: string;
      /** Where the refusal points; absent means at the value the call is about. */
      readonly span?: SourceSpan;
      readonly related?: readonly RelatedSpan[];
    };

export const edit = (start: number, end: number, text: string): Plan => ({ ok: true, start, end, text });

export const refusal = (code: DiagnosticCode, message: string, span?: SourceSpan, related?: readonly RelatedSpan[]): Plan => ({
  ok: false,
  code,
  message,
  ...(span !== undefined ? { span } : {}),
  ...(related !== undefined ? { related } : {}),
});
