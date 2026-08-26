import { useTelemetry } from "frappe-ui/frappe";
// The side-effect import of frappe's bundled posthog.js was removed here:
// Frappe dropped the posthog integration in v16 (upstream 2d5b093db9,
// "refactor!: Drop posthog integration"), deleting
// frappe/public/js/lib/posthog.js. Importing it across the app boundary broke
// this app's vite build against the current framework.
const APP = "helpdesk";

interface CaptureOptions {
  data: {
    [key: string]: string | number | boolean | object;
  };
}

export function capture(event: string, options: CaptureOptions = { data: {} }) {
  // Telemetry is best-effort: with posthog gone there may be no backend behind
  // useTelemetry(), and an analytics call must never break the caller's flow.
  try {
    const { capture: _capture } = useTelemetry();
    _capture(event, options.data);
  } catch (e) {
    console.debug("telemetry capture skipped", event, e);
  }
}
