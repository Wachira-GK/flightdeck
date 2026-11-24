import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What FlightDeck collects, why, who handles it, and your rights.",
};

// Fully static: plain text, no cookies or headers read.
export const dynamic = "force-static";

const h2 = "mt-8 text-xl font-semibold";
const ul = "mt-2 list-disc space-y-1 pl-5";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm text-fg-muted">Last updated 15 November 2026</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Privacy notice</h1>
        <p className="mt-2 text-fg-muted">
          FlightDeck is a mission-based Excel and Mathematics training platform. It is currently a test-stage prototype run from Kenya. This
          notice explains what we collect and why, in plain words.
        </p>
      </header>

      <h2 className={h2}>What we collect</h2>
      <ul className={ul}>
        <li>Your name, as you type it when you create an account, or as Google provides it if you use Google sign-in.</li>
        <li>Your email address.</li>
        <li>
          Your password, if you sign up with email. We never see or store it in readable form: our sign-in provider keeps only a protected
          (hashed) version.
        </li>
        <li>Two sign-in cookies that keep you signed in (see below).</li>
        <li>
          When you sign in and which days you are active on FlightDeck. Our administrators use this to see how often learners come back and to help keep
          certificates fair. We do not record what you type or answer here, your location, or your device.
        </li>
      </ul>
      <p className="mt-2">
        At this stage, your answers in missions are checked when you submit them and are not saved to your account. When we add saving of
        progress, we will update this notice first.
      </p>

      <h2 className={h2}>Why we collect it</h2>
      <p className="mt-2">
        To create and secure your account, to show you your Cockpit, and to email you a link to confirm your address. We do not sell your
        information and we do not show advertising.
      </p>

      <h2 className={h2}>Who handles it for us</h2>
      <ul className={ul}>
        <li>Supabase: stores accounts and runs sign-in and confirmation emails. Our project is hosted in Ireland (EU).</li>
        <li>Cloudflare: hosts the website.</li>
        <li>Google: only if you choose Continue with Google. Google tells us your name and email address, nothing else.</li>
      </ul>
      <p className="mt-2">Your information may therefore be processed outside Kenya. These providers act on our instructions to run the service.</p>

      <h2 className={h2}>Cookies</h2>
      <p className="mt-2">
        We use two essential cookies, named fd-at and fd-rt, to keep you signed in for up to 30 days. They cannot be read by scripts on the
        page. We do not use advertising or tracking cookies at this stage.
      </p>

      <h2 className={h2}>How long we keep it</h2>
      <p className="mt-2">While your account is open. If you ask us to delete your account, we delete your name and email from our systems. Sign-in and activity records are removed after 13 months.</p>

      <h2 className={h2}>Your rights</h2>
      <p className="mt-2">
        Under the Kenya Data Protection Act, 2019, you may ask to see the information we hold about you, correct it, or have it deleted. You
        may also object to how we use it. Email us at the address below and we will respond.
      </p>

      <h2 className={h2}>Children</h2>
      <p className="mt-2">FlightDeck is built for working adults and students. It is not designed for young children.</p>

      <h2 className={h2}>Contact</h2>
      <p className="mt-2">
        Questions or requests: <a className="font-medium text-accent underline" href="mailto:godfreyclass24@gmail.com">godfreyclass24@gmail.com</a>
      </p>

      <h2 className={h2}>Changes</h2>
      <p className="mt-2">
        If this notice changes, the date at the top changes. Read it together with our <Link className="font-medium text-accent underline" href="/terms">terms of use</Link>.
      </p>
    </div>
  );
}
