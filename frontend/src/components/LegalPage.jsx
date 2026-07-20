import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import usePageMeta from '../utils/usePageMeta'

const LAST_UPDATED = '15 July 2026'

const CONTACT_EMAIL = 'michael@manleylifting.ie'
const BUSINESS_ADDRESS = 'Kilnamanagh Upper, Co. Wexford, Ireland'

function PolicyLayout({ title, children }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <Link to="/" className="text-sm font-semibold text-[#123A7A] hover:underline">
          Back to Home
        </Link>
        <h1 className="mt-4 text-4xl font-extrabold text-[#123A7A]">{title}</h1>
        <p className="mt-3 text-sm font-medium text-slate-500">Last updated: {LAST_UPDATED}</p>
        <div className="mt-8 space-y-6 text-slate-700">{children}</div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-bold text-[#123A7A]">{title}</h2>
      <div className="space-y-3 leading-7">{children}</div>
    </section>
  )
}

function PrivacyPolicyContent() {
  return (
    <>
      <p>
        This Privacy Policy explains how Manley Lifting ("we", "us", "our") collects, uses,
        discloses, and protects personal data when you visit or make a purchase from
        manleylifting.ie (the "Website"), in accordance with the EU General Data Protection
        Regulation (GDPR) and the Irish Data Protection Act 2018.
      </p>

      <Section title="1. Who We Are">
        <p>The data controller responsible for your personal data is:</p>
        <p>
          Manley Lifting
          <br />
          Registered address: {BUSINESS_ADDRESS}
          <br />
          Company registration number (CRO): [CRO NUMBER, IF APPLICABLE]
          <br />
          Email: {CONTACT_EMAIL}
          <br />
          Phone: [PHONE NUMBER, OPTIONAL]
        </p>
        <p>
          If we have appointed a Data Protection Officer, their contact details are: [DPO NAME /
          EMAIL, IF APPLICABLE].
        </p>
      </Section>

      <Section title="2. Information We Collect">
        <p>We collect the following categories of personal data:</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Category of Data</th>
                <th className="px-4 py-3 font-semibold">Examples</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
                <th className="px-4 py-3 font-semibold">Legal Basis (GDPR)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Identity &amp; Contact Data</td>
                <td className="px-4 py-3">
                  Name, email address, phone number, billing/delivery address
                </td>
                <td className="px-4 py-3">
                  Creating and managing your account; processing and delivering orders; responding
                  to enquiries
                </td>
                <td className="px-4 py-3">Performance of a contract (Art. 6(1)(b))</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Account Data</td>
                <td className="px-4 py-3">
                  Username, password (hashed), order history, saved preferences
                </td>
                <td className="px-4 py-3">Providing and maintaining your account</td>
                <td className="px-4 py-3">Performance of a contract (Art. 6(1)(b))</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Payment Data</td>
                <td className="px-4 py-3">
                  Payment card details (processed by Stripe), transaction history, billing address
                </td>
                <td className="px-4 py-3">
                  Processing payments; fraud prevention; accounting and tax records
                </td>
                <td className="px-4 py-3">
                  Performance of a contract; legal obligation (Art. 6(1)(b), (c))
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Contact Form / Enquiry Data</td>
                <td className="px-4 py-3">Name, email, message content</td>
                <td className="px-4 py-3">Responding to your questions and requests</td>
                <td className="px-4 py-3">
                  Legitimate interests (Art. 6(1)(f)) / consent where applicable
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Technical &amp; Usage Data</td>
                <td className="px-4 py-3">
                  IP address, browser type, device information, pages visited, referral source
                </td>
                <td className="px-4 py-3">
                  Operating and securing the website; analytics; improving our services
                </td>
                <td className="px-4 py-3">Legitimate interests (Art. 6(1)(f))</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Marketing &amp; Advertising Data</td>
                <td className="px-4 py-3">
                  Cookie identifiers, browsing behaviour, ad interaction data
                </td>
                <td className="px-4 py-3">
                  Analytics reporting; personalised advertising; measuring ad performance
                </td>
                <td className="px-4 py-3">Consent (Art. 6(1)(a))</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="3. How We Collect Your Data">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Directly from you: when you create an account, place an order, fill in a contact form,
            or subscribe to communications.
          </li>
          <li>
            Automatically: through cookies and similar technologies when you browse the Website.
          </li>
          <li>
            From third parties: such as our payment processor (to confirm payment status) and
            analytics or advertising partners.
          </li>
        </ul>
      </Section>

      <Section title="4. How We Use Your Information">
        <ul className="list-disc space-y-2 pl-6">
          <li>Create and manage your account and process your orders.</li>
          <li>Process payments and prevent fraudulent transactions.</li>
          <li>Communicate with you about your orders, account, or enquiries.</li>
          <li>
            Send marketing communications where you have consented, and allow you to opt out at
            any time.
          </li>
          <li>
            Analyse Website usage to improve our products, services, and user experience.
          </li>
          <li>Deliver and measure the performance of online advertising.</li>
          <li>
            Comply with our legal and regulatory obligations, including tax and accounting
            requirements.
          </li>
        </ul>
      </Section>

      <Section title="5. Cookies and Tracking Technologies">
        <p>
          We use cookies and similar technologies to operate the Website and, where you consent,
          for analytics and advertising purposes:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Strictly necessary cookies: required for core functionality such as your shopping cart,
            checkout, and account login. These do not require consent.
          </li>
          <li>
            Analytics cookies: help us understand how visitors use the Website (Google Analytics).
            These are set only with your consent.
          </li>
          <li>
            Advertising cookies: used to deliver and measure relevant advertising, including on
            third-party platforms (for example Meta/Facebook Pixel and Google Ads). These are set
            only with your consent.
          </li>
        </ul>
        <p>
          You can manage or withdraw your cookie consent at any time via our cookie banner or the
          settings link in the footer of the Website, and you can also control cookies through your
          browser settings. Blocking certain cookies may affect the functionality of the Website.
        </p>
      </Section>

      <Section title="6. Sharing Your Information">
        <p>
          We do not sell your personal data. We share personal data with the following categories
          of recipients, only as necessary for the purposes set out in this Policy:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Payment processors (Stripe): to process your payments securely.</li>
          <li>Delivery and logistics providers: to fulfil and deliver your orders.</li>
          <li>IT and hosting providers: to store and operate the Website and its data.</li>
          <li>
            Analytics and advertising providers: to analyse Website performance and deliver
            advertising, where you have consented.
          </li>
          <li>
            Professional advisers and regulators: such as auditors, insurers, or the Revenue
            Commissioners, where legally required.
          </li>
          <li>
            Law enforcement or other authorities: where required by law or to protect our legal
            rights.
          </li>
        </ul>
        <p>
          All third-party processors are required to protect your data under written data
          processing agreements consistent with GDPR.
        </p>
      </Section>

      <Section title="7. International Data Transfers">
        <p>
          Some of our service providers, including Stripe (payment processing) and Google
          Analytics (website analytics), may process personal data outside the European Economic
          Area (EEA), including in the United States. Where this occurs, we ensure appropriate
          safeguards are in place, such as the European Commission&apos;s Standard Contractual
          Clauses, an adequacy decision, or another lawful transfer mechanism recognised under
          GDPR.
        </p>
      </Section>

      <Section title="8. Data Retention">
        <p>
          We retain personal data only for as long as necessary to fulfil the purposes for which
          it was collected, including to satisfy legal, accounting, or reporting requirements. As
          a general guide:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Account data is retained for as long as your account remains active, and for a
            reasonable period afterwards.
          </li>
          <li>
            Order and payment records are retained for at least 6 years to comply with Irish tax
            and accounting law.
          </li>
          <li>
            Marketing consent and contact form data are retained until you withdraw consent or
            object, or after a period of inactivity.
          </li>
          <li>
            Cookie and analytics data is retained in line with the retention periods of the
            relevant analytics or advertising provider.
          </li>
        </ul>
      </Section>

      <Section title="9. Your Rights Under GDPR">
        <p>As a data subject, you have the following rights in relation to your personal data:</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Right</th>
                <th className="px-4 py-3 font-semibold">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Access</td>
                <td className="px-4 py-3">Request a copy of the personal data we hold about you.</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Rectification</td>
                <td className="px-4 py-3">Ask us to correct inaccurate or incomplete data.</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Erasure</td>
                <td className="px-4 py-3">
                  Ask us to delete your personal data, subject to legal retention requirements.
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Restriction</td>
                <td className="px-4 py-3">Ask us to limit how we use your data in certain circumstances.</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Data Portability</td>
                <td className="px-4 py-3">
                  Receive your data in a structured, commonly used, machine-readable format.
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Objection</td>
                <td className="px-4 py-3">
                  Object to processing based on legitimate interests or direct marketing, including
                  profiling.
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Withdraw Consent</td>
                <td className="px-4 py-3">
                  Where processing is based on consent (for example marketing cookies), withdraw it
                  at any time.
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Lodge a Complaint</td>
                <td className="px-4 py-3">
                  Complain to the Irish Data Protection Commission (DPC) if you believe we have
                  infringed your data protection rights.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          To exercise any of these rights, please contact us at {CONTACT_EMAIL}. We may need to
          verify your identity before responding. We will respond within one month, as required by
          GDPR.
        </p>
        <p>
          You also have the right to lodge a complaint with the Irish Data Protection Commission
          (DPC):
          <br />
          Website: www.dataprotection.ie
          <br />
          Address: 21 Fitzwilliam Square South, Dublin 2, D02 RD28, Ireland
          <br />
          Phone: +353 (0)761 104 800
        </p>
      </Section>

      <Section title="10. Data Security">
        <p>
          We implement appropriate technical and organisational measures to protect your personal
          data against unauthorised access, loss, misuse, or alteration, including encryption of
          payment data in transit, access controls, and regular security reviews. However, no
          method of transmission or storage is completely secure, and we cannot guarantee absolute
          security.
        </p>
      </Section>

      <Section title="11. Children&apos;s Privacy">
        <p>
          Our Website is not directed at children under 16, and we do not knowingly collect
          personal data from children. If you believe a child has provided us with personal data,
          please contact us so we can delete it.
        </p>
      </Section>

      <Section title="12. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect changes in our practices
          or legal requirements. We will post the updated version on this page with a revised
          "Last updated" date, and where changes are material, we will provide additional notice
          (for example by email or a Website banner).
        </p>
      </Section>

      <Section title="13. Contact Us">
        <p>
          If you have any questions about this Privacy Policy or how we handle your personal data,
          please contact us at:
        </p>
        <p>
          Manley Lifting
          <br />
          Email: {CONTACT_EMAIL}
          <br />
          Address: {BUSINESS_ADDRESS}
        </p>
      </Section>
    </>
  )
}

function CookiePolicyContent() {
  return (
    <>
      <p>
        This Cookie Policy explains how Manley Lifting uses cookies and similar technologies on
        manleylifting.ie and should be read alongside our Privacy Policy.
      </p>

      <Section title="1. What Cookies Are">
        <p>
          Cookies are small text files stored on your device when you visit a website. They help
          us keep the Website secure, remember preferences, and understand how users interact with
          our pages.
        </p>
      </Section>

      <Section title="2. Cookies We Use">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Strictly necessary cookies: essential for shopping cart, checkout, account login,
            security, and core functionality.
          </li>
          <li>
            Analytics cookies: used to understand traffic and site performance (including Google
            Analytics), only when you consent.
          </li>
          <li>
            Advertising cookies: used for measuring and delivering relevant advertising (including
            Google Ads and Meta/Facebook Pixel), only when you consent.
          </li>
        </ul>
      </Section>

      <Section title="3. Legal Basis">
        <p>
          Strictly necessary cookies are used under our legitimate interests to provide a working
          ecommerce service. Non-essential analytics and advertising cookies are used only with
          your consent.
        </p>
      </Section>

      <Section title="4. How to Manage Cookies">
        <p>
          You can accept or reject non-essential cookies through our cookie banner. You can also
          change your browser settings to block or delete cookies.
        </p>
        <p>
          Blocking some cookies may reduce functionality, including account, checkout, and saved
          preferences.
        </p>
      </Section>

      <Section title="5. Third-Party Providers">
        <p>
          Where enabled by consent, we may use third-party technologies from providers such as
          Google and Meta to support analytics and advertising reporting.
        </p>
      </Section>

      <Section title="6. Contact">
        <p>
          For questions about cookies and tracking technologies, contact us at {CONTACT_EMAIL}.
        </p>
      </Section>
    </>
  )
}

function TermsAndConditionsContent() {
  return (
    <>
      <p>
        These Terms and Conditions govern your use of manleylifting.ie and any purchases made
        through the Website.
      </p>

      <Section title="1. About Us">
        <p>
          Manley Lifting
          <br />
          Address: {BUSINESS_ADDRESS}
          <br />
          Email: {CONTACT_EMAIL}
        </p>
      </Section>

      <Section title="2. Use of the Website">
        <ul className="list-disc space-y-2 pl-6">
          <li>You agree to use the Website only for lawful purposes.</li>
          <li>
            You must not misuse the Website, introduce malicious code, or attempt unauthorised
            access.
          </li>
          <li>
            We may suspend or restrict access where misuse, fraud risk, or security concerns arise.
          </li>
        </ul>
      </Section>

      <Section title="3. Product Information and Availability">
        <p>
          We aim to keep product descriptions, pricing, and availability accurate. However, errors
          may occur and we reserve the right to correct errors and update information without prior
          notice.
        </p>
      </Section>

      <Section title="4. Orders and Contract Formation">
        <p>
          Your order is an offer to purchase. A contract is formed when we confirm acceptance of
          your order and process payment.
        </p>
      </Section>

      <Section title="5. Pricing and Payment">
        <p>
          Prices are shown in euro unless otherwise stated. Payments are processed securely through
          third-party payment providers such as Stripe. We do not store full card details on our
          servers.
        </p>
      </Section>

      <Section title="6. Delivery, Returns, and Refunds">
        <p>
          Delivery timelines, return rights, and refund rules are set out in our Shipping and
          Delivery Policy and Returns and Refunds Policy, which form part of these terms.
        </p>
      </Section>

      <Section title="7. Intellectual Property">
        <p>
          All content on the Website, including text, logos, graphics, and layout, is owned by or
          licensed to Manley Lifting and may not be copied or reused without permission.
        </p>
      </Section>

      <Section title="8. Liability">
        <p>
          Nothing in these terms limits rights that cannot be excluded under Irish law. To the
          extent permitted by law, we are not liable for indirect or consequential losses.
        </p>
      </Section>

      <Section title="9. Privacy and Data Protection">
        <p>
          We process personal data in accordance with GDPR and our Privacy Policy and Cookie
          Policy.
        </p>
      </Section>

      <Section title="10. Governing Law">
        <p>
          These terms are governed by the laws of Ireland and disputes are subject to the
          jurisdiction of the Irish courts.
        </p>
      </Section>
    </>
  )
}

function ReturnsAndRefundsContent() {
  return (
    <>
      <p>
        This Returns and Refunds Policy explains your rights and our process for returns,
        replacements, and refunds.
      </p>

      <Section title="1. Consumer Rights">
        <p>
          If you are a consumer purchasing online in Ireland or the EU, you may have statutory
          cancellation and refund rights under consumer law, including rights in respect of faulty
          or misdescribed goods.
        </p>
      </Section>

      <Section title="2. Change-of-Mind Returns">
        <p>
          Where eligible, change-of-mind returns should be requested promptly and items must be
          unused, in saleable condition, and returned with original packaging.
        </p>
      </Section>

      <Section title="3. Faulty or Damaged Items">
        <p>
          If your item is faulty, damaged, or incorrect, contact us at {CONTACT_EMAIL} with your
          order details and photographs where possible. We will assess and arrange replacement,
          repair, or refund in line with your legal rights.
        </p>
      </Section>

      <Section title="4. Return Process">
        <ul className="list-disc space-y-2 pl-6">
          <li>Email us with your order number and reason for return.</li>
          <li>Wait for return instructions and reference details.</li>
          <li>Send the item securely packaged to the advised return address.</li>
        </ul>
      </Section>

      <Section title="5. Refund Timing">
        <p>
          Approved refunds are issued to the original payment method. Processing time can vary by
          payment provider and may take several business days to appear.
        </p>
      </Section>

      <Section title="6. Non-Returnable Items">
        <p>
          Certain items may be excluded where legally permitted (for example customised, special
          order, or safety-critical goods once opened or used). Any exclusions will be clearly
          communicated at the point of sale.
        </p>
      </Section>
    </>
  )
}

function ShippingAndDeliveryContent() {
  return (
    <>
      <p>
        This Shipping and Delivery Policy explains delivery options, lead times, and responsibilities.
      </p>

      <Section title="1. Delivery Areas">
        <p>
          We deliver within Ireland and may offer delivery to additional regions subject to carrier
          availability and quotation.
        </p>
      </Section>

      <Section title="2. Dispatch and Lead Times">
        <p>
          Dispatch times vary by stock availability and order type. Estimated delivery windows are
          provided during checkout or on request and are not guaranteed unless explicitly agreed.
        </p>
      </Section>

      <Section title="3. Delivery Charges">
        <p>
          Delivery costs are shown at checkout before payment confirmation. Additional charges may
          apply for oversized or specialist lifting equipment.
        </p>
      </Section>

      <Section title="4. Receiving Your Order">
        <p>
          Please inspect deliveries promptly. If goods arrive damaged or incomplete, notify us as
          soon as possible at {CONTACT_EMAIL} so we can investigate with the carrier.
        </p>
      </Section>

      <Section title="5. Delays and Force Majeure">
        <p>
          We are not responsible for delays caused by events outside our reasonable control,
          including severe weather, transport disruption, customs delays, or carrier issues.
        </p>
      </Section>

      <Section title="6. Risk and Ownership">
        <p>
          Risk in goods passes to you on delivery. Ownership transfers once full payment is
          received, subject to applicable law.
        </p>
      </Section>
    </>
  )
}

function AccessibilityStatementContent() {
  return (
    <>
      <p>
        Manley Lifting is committed to making manleylifting.ie accessible and usable for as many
        people as possible.
      </p>

      <Section title="1. Accessibility Commitment">
        <p>
          We aim to follow recognised accessibility standards and good practices, including clear
          navigation, readable content, keyboard support, and responsive layouts.
        </p>
      </Section>

      <Section title="2. Ongoing Improvements">
        <p>
          Accessibility is an ongoing process. We regularly review user journeys and make practical
          improvements to reduce barriers.
        </p>
      </Section>

      <Section title="3. Feedback and Contact">
        <p>
          If you encounter accessibility barriers, please contact us and include the page URL,
          issue description, and any assistive technology used.
        </p>
        <p>Email: {CONTACT_EMAIL}</p>
      </Section>

      <Section title="4. Alternative Support">
        <p>
          If any part of the Website is not accessible to you, we will do our best to provide the
          requested information or service through an alternative method.
        </p>
      </Section>
    </>
  )
}

function policyContentByTitle(title) {
  if (title === 'Privacy Policy') return <PrivacyPolicyContent />
  if (title === 'Cookie Policy') return <CookiePolicyContent />
  if (title === 'Terms and Conditions') return <TermsAndConditionsContent />
  if (title === 'Returns and Refunds') return <ReturnsAndRefundsContent />
  if (title === 'Shipping and Delivery') return <ShippingAndDeliveryContent />
  if (title === 'Accessibility Statement') return <AccessibilityStatementContent />

  return (
    <p>
      This page is currently being updated. For legal requests, please contact us at
      {' '}
      <a className="font-semibold text-[#123A7A] underline" href={`mailto:${CONTACT_EMAIL}`}>
        {CONTACT_EMAIL}
      </a>
      .
    </p>
  )
}

export default function LegalPage({ title }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [title])

  usePageMeta({
    title,
    description: `${title} for Manley Lifting.`,
    noIndex: true,
  })

  return <PolicyLayout title={title}>{policyContentByTitle(title)}</PolicyLayout>
}
