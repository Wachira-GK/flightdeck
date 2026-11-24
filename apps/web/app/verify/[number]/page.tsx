import type { Metadata } from "next";
import { examCall, examConfig, LEVEL_LABEL, type ExamLevel } from "@/server/exams";

// Public: anyone with a certificate number can check it. Shows the name, level and date only (no email, no scores).
export const metadata: Metadata = { title: "Check a certificate", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const n = decodeURIComponent(number).slice(0, 40).toUpperCase();
  const r = await examCall<{ number: string; level: ExamLevel; holder: string; issuedAt: string; revoked: boolean }>(examConfig(), "fd_certificate_verify", { p_number: n });

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Certificate check</h1>
      {!r.ok ? (
        <p role="status" className="mt-6 rounded-md bg-surface-2 p-4">
          {r.reason === "not_found" ? "No certificate has this number. Check the number and try again." : "The check could not be completed just now. Please try again."}
        </p>
      ) : r.revoked ? (
        <p role="status" className="mt-6 rounded-md bg-danger-subtle p-4">This certificate ({r.number}) was withdrawn and is no longer valid.</p>
      ) : (
        <section className="mt-6 rounded-lg border-2 border-border-strong bg-surface p-8 text-center">
          <p className="text-sm uppercase tracking-wide text-fg-muted">FlightDeck certificate</p>
          <p className="mt-4 text-sm text-fg-muted">This certifies that</p>
          <p className="mt-1 text-3xl font-semibold">{r.holder}</p>
          <p className="mt-4">passed the <strong>{LEVEL_LABEL[r.level]}</strong> Excel exam on</p>
          <p className="mt-1 font-medium">{new Date(r.issuedAt).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "Africa/Nairobi" })}</p>
          <p className="mt-6 text-sm text-fg-muted">Certificate number {r.number}. Valid.</p>
        </section>
      )}
    </div>
  );
}
