import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — TheCarPool",
  description:
    "Get help with TheCarPool — contact support, read FAQs about fares, verification, safety (SOS), payments, and account management.",
};

const SUPPORT_EMAIL = "support@thecarpool.in";
const SUPPORT_PHONE = "+91 99990 02281";
const SUPPORT_PHONE_TEL = "+919999002281";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-slate-600 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Faq({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <p className="font-semibold text-slate-900 dark:text-white">{q}</p>
      <p className="mt-2 text-slate-600 dark:text-slate-300 leading-relaxed">{a}</p>
    </div>
  );
}

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Support &amp; Help
      </h1>
      <p className="mt-6 text-slate-600 dark:text-slate-300 leading-relaxed">
        Need a hand with TheCarPool? We&apos;re here to help with bookings, payments,
        verification, and safety. Reach us directly or browse the common questions below.
      </p>

      {/* Contact cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5 hover:border-emerald-500 transition-colors"
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">Email us</p>
          <p className="mt-1 text-lg font-bold text-emerald-600">{SUPPORT_EMAIL}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            We typically reply within 24 hours.
          </p>
        </a>
        <a
          href={`tel:${SUPPORT_PHONE_TEL}`}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5 hover:border-emerald-500 transition-colors"
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">Call support</p>
          <p className="mt-1 text-lg font-bold text-emerald-600">{SUPPORT_PHONE}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Mon–Sat, 9 AM – 7 PM IST.
          </p>
        </a>
      </div>

      <Section title="Frequently asked questions">
        <div className="space-y-3">
          <Faq
            q="How is the fare split calculated?"
            a="The trip's fuel cost is shared fairly among co-passengers per seat, with a clear breakdown (seat fare, platform fee, and GST) shown before you confirm. Group discounts apply automatically when you book multiple seats."
          />
          <Faq
            q="Why do I need to verify my identity (KYC)?"
            a="Verification keeps the community safe — every rider and driver confirms identity (Aadhaar, PAN, and a selfie) before booking their first ride. Your documents are encrypted and used only for verification."
          />
          <Faq
            q="How does the SOS button work?"
            a="During an active trip, one tap on SOS broadcasts your live location to your safety circle and our support team. You can also share your live trip with family and friends, and women can filter for women-only rides."
          />
          <Faq
            q="How are payments handled?"
            a={
              <>
                Your fare is held safely in escrow and released to the driver only after the
                ride completes. Payments are processed securely via Razorpay (UPI, net
                banking, cards, and wallets). We never store your full card details.
              </>
            }
          />
          <Faq
            q="How do drivers receive their earnings?"
            a="Once a ride completes and escrow is settled, earnings are credited to the driver's TheCarPool wallet and can be withdrawn to their UPI/bank account."
          />
          <Faq
            q="How do I delete my account?"
            a={
              <>
                Open the app and go to <strong>You → Settings → Delete my account</strong>.
                This permanently removes your profile, rides, and bookings. You can also
                email us at{" "}
                <a className="text-emerald-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
                .
              </>
            }
          />
        </div>
      </Section>

      <Section title="Still need help?">
        <p>
          Email{" "}
          <a className="text-emerald-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{" "}
          with your registered phone number and a short description, and our team will get
          back to you. For privacy and data requests, see our{" "}
          <a className="text-emerald-600 hover:underline" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
