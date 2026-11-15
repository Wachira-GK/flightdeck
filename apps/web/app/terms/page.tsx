import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for using FlightDeck.",
};

export const dynamic = "force-static";

const h2 = "mt-8 text-xl font-semibold";
const ul = "mt-2 list-disc space-y-1 pl-5";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm text-fg-muted">Last updated 15 November 2026</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Terms of use</h1>
        <p className="mt-2 text-fg-muted">By creating an account or using FlightDeck you agree to these terms.</p>
      </header>

      <h2 className={h2}>A prototype</h2>
      <p className="mt-2">
        FlightDeck is a test-stage prototype. Features, missions and sample activity on the pages may change, be reset, or be removed
        without notice. We do not promise that the service will always be available or free of errors.
      </p>

      <h2 className={h2}>Your account</h2>
      <ul className={ul}>
        <li>Give us a real email address that you control, and keep your password private.</li>
        <li>You are responsible for what happens under your account.</li>
        <li>You can ask us to delete your account at any time.</li>
      </ul>

      <h2 className={h2}>Fair use</h2>
      <p className="mt-2">Do not try to break, overload or get around the service, access other people&apos;s information, or copy the training content to resell it.</p>

      <h2 className={h2}>Learning content</h2>
      <p className="mt-2">
        Missions and explanations are for learning and are not professional, financial or legal advice. The content belongs to the FlightDeck
        project. You may use it for your own learning.
      </p>

      <h2 className={h2}>Liability</h2>
      <p className="mt-2">
        To the extent the law allows, the FlightDeck project is not liable for losses arising from use of this prototype.
      </p>

      <h2 className={h2}>Your information</h2>
      <p className="mt-2">
        How we handle it is explained in the <Link className="font-medium text-accent underline" href="/privacy">privacy notice</Link>.
      </p>

      <h2 className={h2}>Contact</h2>
      <p className="mt-2">
        <a className="font-medium text-accent underline" href="mailto:godfreyclass24@gmail.com">godfreyclass24@gmail.com</a>
      </p>
    </div>
  );
}
