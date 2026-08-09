import { resetMetrics } from "../perf/support/report";

/** Clear the metrics log so a run reports only its own numbers. */
export default function globalSetup(): void {
    resetMetrics();
}
