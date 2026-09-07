/**
 * The diagnostic collector — FR-019, contracts/parse-api.md
 * ("Diagnostics are complete. One call reports every floor violation
 * detectable in that pass, not the first.").
 *
 * Accumulates violations found during a walk without ever throwing on the
 * first one, so a single read can report a duplicate key on line 3 *and*
 * an unsupported tag on line 40 in one pass. `all()` returns the
 * accumulated diagnostics ordered by position, so a config author reads
 * them in the order the problems appear in their file.
 */
import type { Diagnostic } from "./diagnostic.js";
export declare class DiagnosticCollector {
    private readonly diagnostics;
    /** Record a violation. Never throws — bad documents are data, not exceptions. */
    add(diagnostic: Diagnostic): void;
    /** Whether anything has been recorded yet. */
    get isEmpty(): boolean;
    /**
     * Every diagnostic recorded so far, ordered by the byte offset of its
     * primary span. `Array.prototype.sort` is stable, so diagnostics at the
     * same offset keep their recording order.
     */
    all(): Diagnostic[];
}
//# sourceMappingURL=collector.d.ts.map