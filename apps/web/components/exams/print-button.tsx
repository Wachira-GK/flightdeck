"use client";

/** Opens the browser's print dialog (on A4 landscape the certificate is the only thing printed; "Save as PDF" works from there). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print min-h-11 rounded-md bg-accent px-5 font-medium text-accent-fg">
      Print or save as PDF
    </button>
  );
}
