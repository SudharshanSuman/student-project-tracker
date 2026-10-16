/**
 * Report document model + HTML renderer. Every value that reaches the HTML goes through
 * `esc()`; the page runs with JavaScript disabled and all network requests blocked, so
 * report content can never load or execute anything.
 */

export type Tone = "info" | "warning" | "pending";

export type Section =
  | { kind: "metrics"; title: string; items: { label: string; value: string; hint?: string }[] }
  | { kind: "table"; title: string; columns: string[]; rows: string[][]; empty: string; numeric?: number[]; note?: string }
  | { kind: "notice"; title: string; body: string; tone: Tone }
  | { kind: "signoff"; preparedBy: string };

export interface ReportDocument {
  title: string;
  subtitle: string;
  institutionId: string;
  periodLabel: string;
  scopeLabel: string;
  generatedAt: Date;
  reportId: string;
  sections: Section[];
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

const CSS = `
@page { size: A4; margin: 24mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; line-height: 1.45; color: #1c2430; }
.cover { border-bottom: 2px solid #1d4ed8; padding-bottom: 10pt; margin-bottom: 14pt; }
.cover .inst { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #1d4ed8; font-weight: 600; }
.cover h1 { font-size: 20pt; margin: 4pt 0 2pt; letter-spacing: -.01em; }
.cover .sub { color: #4b5565; font-size: 10pt; }
.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6pt; margin-top: 10pt; }
.meta div { background: #f3f5f9; border-radius: 4pt; padding: 5pt 7pt; }
.meta dt { font-size: 7pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
.meta dd { margin: 1pt 0 0; font-weight: 600; font-size: 8.5pt; }
section { margin: 0 0 14pt; }
h2 { font-size: 11.5pt; margin: 0 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #d8dee8; break-after: avoid; page-break-after: avoid; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6pt; break-inside: avoid; }
.metric { border: 1px solid #d8dee8; border-radius: 4pt; padding: 6pt 8pt; }
.metric .v { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.metric .l { font-size: 7.5pt; color: #4b5565; text-transform: uppercase; letter-spacing: .04em; }
.metric .h { font-size: 7.5pt; color: #6b7280; margin-top: 1pt; }
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th { text-align: left; background: #eef2f8; color: #273142; font-weight: 600; padding: 4pt 5pt; border-bottom: 1px solid #c9d2e0; }
td { padding: 3.5pt 5pt; border-bottom: 1px solid #e6eaf0; vertical-align: top; overflow-wrap: break-word; hyphens: manual; }
tbody tr:nth-child(even) td { background: #fafbfd; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.empty { border: 1px dashed #c9d2e0; border-radius: 4pt; padding: 10pt; color: #6b7280; text-align: center; font-style: italic; }
.note { font-size: 7.5pt; color: #6b7280; margin-top: 3pt; }
.notice { border-left: 3pt solid #1d4ed8; background: #f1f5fd; padding: 7pt 9pt; border-radius: 0 4pt 4pt 0; break-inside: avoid; }
.notice.warning { border-color: #b45309; background: #fdf6ec; }
.notice.pending { border-color: #6b7280; background: #f4f5f7; }
.notice strong { display: block; margin-bottom: 2pt; }
.signoff { break-inside: avoid; page-break-inside: avoid; margin-top: 18pt; }
.signoff .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16pt; margin-top: 8pt; }
.signoff .line { border-top: 1px solid #1c2430; padding-top: 3pt; margin-top: 30pt; font-size: 8pt; }
.signoff .who { color: #6b7280; font-size: 7.5pt; }
.page-break { break-before: page; page-break-before: always; }
`;

function renderSection(s: Section): string {
  switch (s.kind) {
    case "metrics":
      return `<section><h2>${esc(s.title)}</h2><div class="metrics">${s.items
        .map((m) => `<div class="metric"><div class="l">${esc(m.label)}</div><div class="v">${esc(m.value)}</div>${m.hint ? `<div class="h">${esc(m.hint)}</div>` : ""}</div>`)
        .join("")}</div></section>`;
    case "table": {
      if (s.rows.length === 0) return `<section><h2>${esc(s.title)}</h2><div class="empty">${esc(s.empty)}</div></section>`;
      const num = new Set(s.numeric ?? []);
      const cls = (i: number) => (num.has(i) ? ' class="num"' : "");
      return `<section><h2>${esc(s.title)}</h2><table><thead><tr>${s.columns.map((c, i) => `<th${cls(i)}>${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.rows
        .map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}</section>`;
    }
    case "notice":
      return `<section><h2>${esc(s.title)}</h2><div class="notice ${s.tone}"><strong>${esc(s.tone === "pending" ? "Pending integration" : s.tone === "warning" ? "Attention" : "Note")}</strong>${esc(s.body)}</div></section>`;
    case "signoff":
      return `<section class="signoff"><h2>Approval &amp; sign-off</h2><p class="note">All figures above are computed from platform records at generation time. Estimated or unverified values are labelled as such and excluded from verified totals.</p><div class="grid">
        <div><div class="line">Prepared by</div><div class="who">${esc(s.preparedBy)}</div></div>
        <div><div class="line">Reviewed by (Faculty mentor)</div><div class="who">Name, signature, date</div></div>
        <div><div class="line">Approved by (IIC Head)</div><div class="who">Name, signature, date</div></div></div></section>`;
  }
}

export function renderReportHtml(doc: ReportDocument): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${CSS}</style></head><body>
<header class="cover"><div class="inst">${esc(doc.institutionId)} · Innovation &amp; Incubation Cell</div><h1>${esc(doc.title)}</h1><div class="sub">${esc(doc.subtitle)}</div>
<dl class="meta"><div><dt>Period</dt><dd>${esc(doc.periodLabel)}</dd></div><div><dt>Scope</dt><dd>${esc(doc.scopeLabel)}</dd></div><div><dt>Generated</dt><dd>${esc(stamp(doc.generatedAt))}</dd></div><div><dt>Report ID</dt><dd>${esc(doc.reportId.slice(0, 8))}</dd></div></dl></header>
${doc.sections.map(renderSection).join("\n")}
</body></html>`;
}

/** Puppeteer header/footer templates (rendered outside the page body; inline styles only). */
export function headerFooter(doc: ReportDocument) {
  const base = "font-family: Arial, sans-serif; font-size: 7pt; color: #6b7280; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;";
  return {
    headerTemplate: `<div style="${base}"><span>${esc(doc.institutionId)} · ${esc(doc.title)}</span><span>${esc(doc.periodLabel)}</span></div>`,
    footerTemplate: `<div style="${base}"><span>Generated ${esc(stamp(doc.generatedAt))} · Confidential: internal IIC use</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  };
}
