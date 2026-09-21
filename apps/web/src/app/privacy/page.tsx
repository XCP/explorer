import type { Metadata } from "next";

// Restored from XCP/xcp.io; retain the published policy wording and effective dates.
export const metadata: Metadata = {
  title: "XCP Wallet Privacy Policy",
  description: "Privacy Policy for the XCP Wallet browser extension.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-2 py-8 sm:px-6 sm:py-12">
      <article className="text-zinc-300 leading-7">
        <h1 className="text-3xl font-bold text-zinc-100 mb-4">Privacy Policy</h1>

        <p className="text-sm text-zinc-400 mb-8">
          <strong className="text-zinc-300 leading-7">Effective Date:</strong> February 2, 2025
          <br />
          <strong className="text-zinc-300 leading-7">Last Updated:</strong> February 2, 2025
        </p>

        <p className="mb-6">
          Family Media LLC d.b.a. 21e14 Labs (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the XCP
          Wallet browser extension (&ldquo;the Extension&rdquo;). This Privacy Policy explains how we collect, use, and
          protect your information when you use our Extension.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Summary</h2>
        <p className="mb-6">
          XCP Wallet is a self-custodial cryptocurrency wallet.{" "}
          <strong className="text-zinc-100">Your private keys and recovery phrases never leave your device.</strong> We
          do not have access to your funds, cannot recover your wallet, and cannot reverse transactions.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Information We Collect</h2>

        <h3 className="text-lg font-medium text-zinc-100 mt-6 mb-3">Information Stored Locally on Your Device</h3>
        <p className="mb-4">
          The following data is stored <strong className="text-zinc-100">only on your device</strong> and is{" "}
          <strong className="text-zinc-100">never transmitted</strong> to our servers or any third party:
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>
            <strong className="text-zinc-100">Encrypted Wallet Data:</strong> Recovery phrases and private keys are
            encrypted using AES-256-GCM encryption before being stored in your browser&apos;s local storage. We cannot
            access this data.
          </li>
          <li>
            <strong className="text-zinc-100">Authentication Information:</strong> Your wallet password is used to
            encrypt/decrypt your wallet data locally. We never receive or store your password.
          </li>
          <li>
            <strong className="text-zinc-100">User Preferences:</strong> Settings such as currency display preferences,
            auto-lock timeout duration, and UI preferences.
          </li>
          <li>
            <strong className="text-zinc-100">Approved dApp Connections:</strong> A list of websites you have authorized
            to connect to your wallet, which you can revoke at any time in Settings.
          </li>
        </ul>

        <h3 className="text-lg font-medium text-zinc-100 mt-6 mb-3">Information We Do Not Collect</h3>
        <p className="mb-4">
          We do <strong className="text-zinc-100">not</strong> collect, store, or transmit:
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>Your private keys or recovery phrases</li>
          <li>Your wallet password</li>
          <li>Your transaction history</li>
          <li>Your IP address (through the Extension)</li>
          <li>Browsing history or web activity</li>
          <li>Keystrokes, form inputs, or page content</li>
          <li>Personal identification information</li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Browser Permissions</h2>
        <p className="mb-4">
          The Extension requires certain browser permissions to function. Here is how each permission is used:
        </p>

        <div className="overflow-x-auto mb-6">
          <table className="min-w-full border border-zinc-700">
            <thead>
              <tr className="bg-zinc-800">
                <th className="px-4 py-2 text-left text-zinc-100 border-b border-zinc-700">Permission</th>
                <th className="px-4 py-2 text-left text-zinc-100 border-b border-zinc-700">Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-700">
                <td className="px-4 py-2 font-medium text-zinc-100">sidePanel</td>
                <td className="px-4 py-2">
                  Provides a persistent wallet interface that remains open while you browse Counterparty dApps, allowing
                  you to monitor your portfolio and manage transactions without repeatedly reopening the wallet.
                </td>
              </tr>
              <tr className="border-b border-zinc-700 bg-zinc-800/50">
                <td className="px-4 py-2 font-medium text-zinc-100">storage</td>
                <td className="px-4 py-2">
                  Stores your encrypted wallet data and preferences locally on your device. All sensitive data is
                  encrypted before storage. No data is synced or transmitted externally.
                </td>
              </tr>
              <tr className="border-b border-zinc-700">
                <td className="px-4 py-2 font-medium text-zinc-100">tabs</td>
                <td className="px-4 py-2">
                  Routes dApp request/response messages to the correct browser tab. Used only to identify the requesting
                  tab and deliver approval results. No page titles, URLs, or browsing history are collected.
                </td>
              </tr>
              <tr className="border-b border-zinc-700 bg-zinc-800/50">
                <td className="px-4 py-2 font-medium text-zinc-100">alarms</td>
                <td className="px-4 py-2">
                  Enables auto-lock after user-configured inactivity (1–30 minutes) and schedules periodic refresh tasks
                  (e.g., updating displayed prices) when the wallet UI is open. No background activity is performed for
                  tracking.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium text-zinc-100">Host permissions</td>
                <td className="px-4 py-2">
                  Injects the minimal <code className="bg-zinc-800 px-1 rounded">window.xcp</code> provider API for dApp
                  connectivity. The Extension does NOT read page content, keystrokes, or form fields. Each site must be
                  explicitly approved by you before it can request addresses or signatures.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Website Analytics</h2>
        <p className="mb-4">
          For our marketing website (not the Extension), we use{" "}
          <a href="https://usefathom.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
            Fathom Analytics
          </a>
          , a privacy-focused analytics service that:
        </p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>Does not use cookies</li>
          <li>Does not collect personal data</li>
          <li>Complies with GDPR, ePrivacy (including PECR), COPPA, and CCPA</li>
          <li>Only briefly processes IP addresses, which are then discarded</li>
          <li>Makes it impossible for us to identify individual visitors</li>
        </ul>
        <p className="mb-4">
          The purpose of using Fathom Analytics is to understand our website traffic in the most privacy-friendly way
          possible so we can improve our website and services. The lawful basis under GDPR is &ldquo;Article
          6(1)(f)&rdquo; (legitimate interests to improve our website and business). No personal data is stored over
          time.
        </p>
        <p className="mb-6">
          <strong className="text-zinc-100">
            The Extension allows you to opt-out of anonymous analytics under Advanced Settings.
          </strong>
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Third-Party Services</h2>
        <p className="mb-4">The Extension connects to the following external services to function:</p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>
            <strong className="text-zinc-100">Counterparty API servers:</strong> To fetch your wallet balances,
            transaction history, and broadcast signed transactions to the network.
          </li>
          <li>
            <strong className="text-zinc-100">Bitcoin network nodes:</strong> To retrieve Bitcoin blockchain data and
            broadcast Bitcoin transactions.
          </li>
          <li>
            <strong className="text-zinc-100">Price data providers:</strong> To display current cryptocurrency prices
            (optional feature).
          </li>
        </ul>
        <p className="mb-6">
          These connections transmit only the minimum data necessary (such as your public addresses) to retrieve
          blockchain information. Your private keys are never transmitted.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Data Security</h2>
        <p className="mb-4">We implement security measures to protect your data:</p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>
            <strong className="text-zinc-100">Encryption:</strong> All sensitive wallet data is encrypted with
            AES-256-GCM before storage.
          </li>
          <li>
            <strong className="text-zinc-100">Local Storage Only:</strong> Your encrypted data is stored only in your
            browser&apos;s local storage and is never transmitted to external servers.
          </li>
          <li>
            <strong className="text-zinc-100">Auto-Lock:</strong> The wallet automatically locks after a configurable
            period of inactivity.
          </li>
          <li>
            <strong className="text-zinc-100">No Remote Code:</strong> The Extension does not load or execute any remote
            code.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Data Sharing</h2>
        <p className="mb-4">
          We do <strong className="text-zinc-100">not</strong> sell, trade, or transfer your data to third parties.
        </p>
        <p className="mb-4">
          We do <strong className="text-zinc-100">not</strong> use your data for:
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>Advertising or marketing purposes</li>
          <li>Determining creditworthiness</li>
          <li>Lending purposes</li>
          <li>Any purpose unrelated to the Extension&apos;s core functionality</li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Your Rights</h2>
        <p className="mb-4">You have full control over your data:</p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>
            <strong className="text-zinc-100">Access:</strong> All your wallet data is stored locally on your device and
            can be viewed within the Extension.
          </li>
          <li>
            <strong className="text-zinc-100">Export:</strong> You can export your recovery phrase at any time to back
            up or migrate your wallet.
          </li>
          <li>
            <strong className="text-zinc-100">Deletion:</strong> You can delete all Extension data by removing the
            Extension from your browser or clearing its storage in browser settings.
          </li>
          <li>
            <strong className="text-zinc-100">dApp Permissions:</strong> You can view and revoke website permissions at
            any time in the Extension&apos;s Settings.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Children&apos;s Privacy</h2>
        <p className="mb-6">
          The Extension is not intended for use by children under 13 years of age. We do not knowingly collect
          information from children under 13.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Changes to This Policy</h2>
        <p className="mb-6">
          We may update this Privacy Policy from time to time. We will notify you of any changes by updating the
          &ldquo;Last Updated&rdquo; date at the top of this policy. We encourage you to review this Privacy Policy
          periodically.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Contact Us</h2>
        <p className="mb-4">
          If you have questions about this Privacy Policy or our privacy practices, please contact us at:
        </p>
        <p className="mb-6">
          <strong className="text-zinc-100">Family Media LLC d.b.a. 21e14 Labs</strong>
          <br />
          Email:{" "}
          <a href="mailto:privacy@21e14.com" className="text-blue-400 underline">
            privacy@21e14.com
          </a>
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">Compliance</h2>
        <p className="mb-4">This Privacy Policy is designed to comply with:</p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>General Data Protection Regulation (GDPR)</li>
          <li>California Consumer Privacy Act (CCPA)</li>
          <li>Children&apos;s Online Privacy Protection Act (COPPA)</li>
          <li>ePrivacy Directive (including PECR)</li>
        </ul>

        <hr className="border-zinc-700 my-8" />
        <p className="text-sm text-zinc-400 italic">This privacy policy was last reviewed on February 2, 2025.</p>
      </article>
    </div>
  );
}
