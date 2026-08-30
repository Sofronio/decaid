import { pageShell } from "./layout";
import { printTheShotComponent } from "../components/print-the-shot";
import { transformScript } from "../api/transform";

export function renderSettingsPage(
  request: HttpRequest,
  version: string
): string {
  return pageShell(
    "Print The Shot",
    `<print-the-shot data-version="${version}"></print-the-shot>`,
    [transformScript, printTheShotComponent]
  );
}
