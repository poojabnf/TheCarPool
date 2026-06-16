import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — TheCarPool",
  description:
    "How TheCarPool collects, uses, shares, and protects your personal data across our carpooling app and website.",
};

const EFFECTIVE_DATE = "June 17, 2026";
const CONTACT_EMAIL = "privacy@thecarpool.in";

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

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Last updated: {EFFECTIVE_DATE}
      </p>

      <p className="mt-6 text-slate-600 dark:text-slate-300 leading-relaxed">
        TheCarPool (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the TheCarPool mobile
        application and the website at thecarpool.in (together, the &quot;Service&quot;), a
        workplace and community carpooling platform. This Privacy Policy explains what
        information we collect, how we use and share it, and the choices you have. By
        using the Service, you agree to the practices described here.
      </p>

      <Section title="1. Information We Collect">
        <p>We collect the following categories of personal data:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Account &amp; identity:</strong> name, email address, phone number, and
            authentication identifiers (via Google Sign-In or phone OTP through Firebase
            Authentication).
          </li>
          <li>
            <strong>Profile &amp; preferences:</strong> commute locations, role (rider or
            driver), gender, vehicle type, and corporate/company email used to join trust
            circles.
          </li>
          <li>
            <strong>Location data:</strong> precise device location to find and match
            nearby carpools and show live trips. With your permission, we use{" "}
            <strong>background location</strong> during an active trip to detect route
            deviations and support safety features.
          </li>
          <li>
            <strong>Identity verification (KYC):</strong> documents and details you submit
            for verification — such as Aadhaar number, driving licence, vehicle
            registration (RC), PAN, and a selfie — to confirm driver and rider identity.
          </li>
          <li>
            <strong>Payment information:</strong> wallet balances, transactions, and
            payout details. Card/UPI payment details are processed directly by our payment
            processor (Razorpay); we do not store full card numbers.
          </li>
          <li>
            <strong>Safety data:</strong> emergency contacts you add and SOS events you
            trigger (including location at the time).
          </li>
          <li>
            <strong>Device &amp; usage data:</strong> device push notification tokens,
            app interactions, log data, and diagnostics used to operate and improve the
            Service.
          </li>
        </ul>
      </Section>

      <Section title="2. How We Use Your Information">
        <ul className="list-disc pl-6 space-y-2">
          <li>Match riders and drivers and optimize routes.</li>
          <li>Verify identity and eligibility (KYC) and maintain trust circles.</li>
          <li>Process cost-sharing payments, wallets, and payouts.</li>
          <li>Provide safety features, including SOS alerts and trip monitoring.</li>
          <li>Send ride updates and notifications (you can control push notifications).</li>
          <li>Operate, secure, troubleshoot, and improve the Service.</li>
          <li>Comply with legal obligations and enforce our terms.</li>
        </ul>
      </Section>

      <Section title="3. How We Share Your Information">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Other users:</strong> limited profile information (e.g. name, rating,
            approximate pickup) is shared with riders/drivers you are matched with.
          </li>
          <li>
            <strong>Service providers:</strong> Google Firebase and Google Cloud
            (authentication, database, storage, hosting, notifications), Google Maps
            (routing), and Razorpay (payments). These providers process data on our
            behalf.
          </li>
          <li>
            <strong>Emergency recipients:</strong> when you trigger SOS, relevant details
            and location may be shared with your emergency contacts and, where applicable,
            safety authorities.
          </li>
          <li>
            <strong>Legal &amp; safety:</strong> when required by law or to protect the
            rights, safety, and security of users and the public.
          </li>
        </ul>
        <p>We do not sell your personal data.</p>
      </Section>

      <Section title="4. Data Retention &amp; Deletion">
        <p>
          We retain personal data for as long as your account is active or as needed to
          provide the Service and meet legal, tax, and safety obligations. You can delete
          your account at any time from the app (Settings → Delete Account), which removes
          your profile, rides, bookings, and associated data from our active systems,
          subject to limited retention required by law.
        </p>
        <p>
          To request deletion or exercise other rights, contact us at{" "}
          <a className="text-emerald-600 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="5. Data Security">
        <p>
          We use industry-standard safeguards including encrypted connections (TLS),
          authenticated APIs, and access-controlled storage (Firebase Security Rules) for
          documents such as KYC uploads. No method of transmission or storage is
          completely secure, but we work to protect your information.
        </p>
      </Section>

      <Section title="6. Your Rights">
        <p>
          Depending on your location, you may have rights to access, correct, export, or
          delete your personal data, and to object to or restrict certain processing. You
          can manage core profile data in the app or contact us to exercise these rights.
        </p>
      </Section>

      <Section title="7. Children's Privacy">
        <p>
          The Service is intended for users aged 18 and older. We do not knowingly collect
          personal data from children. If you believe a child has provided us data, contact
          us and we will delete it.
        </p>
      </Section>

      <Section title="8. International Users">
        <p>
          We are based in India and process data on infrastructure that may be located in
          India and other countries. By using the Service you consent to the transfer and
          processing of your data in these locations.
        </p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. We will update the
          &quot;Last updated&quot; date above and, where appropriate, notify you in the app.
        </p>
      </Section>

      <Section title="10. Contact Us">
        <p>
          Questions about this policy or your data? Email us at{" "}
          <a className="text-emerald-600 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
