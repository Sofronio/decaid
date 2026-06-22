import { pageShell } from "./layout";
import { printTheShotComponent } from "../components/print-the-shot";
import { apiClientScript } from "../api/client";

export function renderSettingsPage(request: HttpRequest): HttpResponse {
  const content = `
    <print-the-shot></print-the-shot>
  `;

  return {
    requestId: request.requestId,
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: pageShell("Settings", content, [
      apiClientScript,
      printTheShotComponent,
    ]),
  };
}
