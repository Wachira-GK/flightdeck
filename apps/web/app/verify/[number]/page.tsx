import type { Metadata } from "next";
import { headers } from "next/headers";
import { PrintButton } from "@/components/exams/print-button";
import { examCall, examConfig, LEVEL_LABEL, type ExamLevel } from "@/server/exams";

// Public: anyone with a certificate number can check it. Shows the name, level and date only (no email, no scores).
// The same page is the printable certificate: on paper only the certificate frame prints (A4 landscape), with the check address on it.
export const metadata: Metadata = { title: "Check a certificate", robots: { index: false } };
export const dynamic = "force-dynamic";

const PRINT_CSS = `
@page { size: A4 landscape; margin: 10mm; }
@media print {
  header, footer, nav, .no-print { display: none !important; }
  body { background: #fff !important; }
  .cert-wrap { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .cert { box-shadow: none !important; break-inside: avoid; min-height: 176mm; display: flex; flex-direction: column; justify-content: center; }
}
`;

export default async function VerifyPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const n = decodeURIComponent(number).slice(0, 40).toUpperCase();
  const r = await examCall<{ number: string; level: ExamLevel; holder: string; issuedAt: string; revoked: boolean }>(examConfig(), "fd_certificate_verify", { p_number: n });
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").replace(/[^a-z0-9.:-]/gi, "").slice(0, 120);
  const where = host ? `${host}/verify/${r.ok ? r.number : encodeURIComponent(n)}` : `/verify/${encodeURIComponent(n)}`;

  return (
    <div className="cert-wrap mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <style>{PRINT_CSS}</style>
      <h1 className="no-print text-3xl font-semibold">Certificate check</h1>
      {!r.ok ? (
        <p role="status" className="mt-6 rounded-md bg-surface-2 p-4">
          {r.reason === "not_found" ? "No certificate has this number. Check the number and try again." : "The check could not be completed just now. Please try again."}
        </p>
      ) : r.revoked ? (
        <p role="status" className="mt-6 rounded-md bg-danger-subtle p-4">This certificate ({r.number}) was withdrawn and is no longer valid.</p>
      ) : (
        <>
          <section aria-label="Certificate" className="cert mt-6 rounded-lg border-[6px] border-double border-border-strong bg-surface p-8 text-center sm:p-12">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-fg-muted">FlightDeck</p>
            <h2 className="mt-2 font-serif text-4xl font-semibold sm:text-5xl">Certificate of Achievement</h2>
            <p className="mt-8 text-fg-muted">This certifies that</p>
            <p className="mt-2 break-words font-serif text-3xl font-semibold sm:text-4xl">{r.holder}</p>
            <p className="mt-6 text-lg">
              passed the <strong>{LEVEL_LABEL[r.level]}</strong> Excel certificate exam
            </p>
            <p className="mt-2 text-lg">on {new Date(r.issuedAt).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "Africa/Nairobi" })}</p>
            <p className="mt-10 text-sm text-fg-muted">
              Certificate number <strong className="text-fg">{r.number}</strong>
            </p>
            <p className="mt-1 text-xs text-fg-muted">Check that this certificate is genuine at {where}</p>
          </section>
          <p className="no-print mt-4 text-sm text-fg-muted">Valid. Anyone who has the address of this page can check it.</p>
          <p className="mt-4">
            <PrintButton />
          </p>
        </>
      )}
    </div>
  );
}
