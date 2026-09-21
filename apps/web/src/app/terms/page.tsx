import type { Metadata } from "next";

// Restored from XCP/xcp.io; retain the published policy wording and effective dates.
export const metadata: Metadata = {
  title: "XCP Wallet Terms of Service",
  description: "Terms of Service for the XCP Wallet browser extension.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-2 py-8 sm:px-6 sm:py-12">
      <article className="text-zinc-300 leading-7">
        <h1 className="text-3xl font-bold text-zinc-100 mb-4">Terms of Service</h1>

        <p className="text-sm text-zinc-400 mb-8">
          <strong className="text-zinc-300 leading-7">Last Modified:</strong> February 2, 2025
          <br />
          <strong className="text-zinc-300 leading-7">Effective Date:</strong> February 2, 2025
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">1. Acceptance of Terms</h2>
        <p className="mb-6">
          By accessing or using XCP Wallet, a product of Family Media LLC d.b.a. 21e14 Labs (&ldquo;we,&rdquo;
          &ldquo;our,&rdquo; or &ldquo;us&rdquo;), you agree to comply with and be bound by these Terms of Service
          (&ldquo;Terms&rdquo;). If you do not agree to these Terms, you are not permitted to use XCP Wallet.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">2. Description of Service</h2>
        <p className="mb-4">
          XCP Wallet is a non-custodial browser extension wallet for Bitcoin and Counterparty assets. The wallet allows
          you to:
        </p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>Generate and store cryptographic keys locally on your device</li>
          <li>View your Bitcoin and Counterparty asset balances</li>
          <li>Construct, sign, and broadcast Bitcoin and Counterparty transactions</li>
          <li>Connect to Counterparty-compatible decentralized applications (&ldquo;dApps&rdquo;)</li>
        </ul>
        <p className="mb-6">
          <strong className="text-zinc-100">Non-Custodial Nature:</strong> XCP Wallet is a non-custodial wallet, meaning
          we do not have access to your private keys, recovery phrases, or funds. You are solely responsible for
          securing your wallet credentials. We cannot recover lost keys or reverse transactions.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">3. Modification of Terms</h2>
        <p className="mb-6">
          We reserve the right to modify these Terms at any time. Any changes will be effective immediately upon posting
          the updated Terms. Your continued use of XCP Wallet after any such changes constitutes your acceptance of the
          new Terms. It is your responsibility to review these Terms periodically.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">4. License Grant</h2>
        <p className="mb-4">
          Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable,
          revocable license to:
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>
            Download, install, and use XCP Wallet for your personal, non-commercial use on devices you own or control
          </li>
          <li>Access and use the features and functionality of XCP Wallet in accordance with these Terms</li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">5. License Restrictions</h2>
        <p className="mb-4">You shall not:</p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>
            Copy, modify, or create derivative works of XCP Wallet, except as permitted by applicable open-source
            licenses
          </li>
          <li>Reverse engineer, disassemble, or decompile XCP Wallet, except as permitted by applicable law</li>
          <li>Remove or alter any proprietary notices, trademarks, or labels</li>
          <li>Rent, lease, lend, sell, sublicense, or distribute XCP Wallet to third parties</li>
          <li>Use XCP Wallet for any unlawful purpose or in violation of any applicable laws or regulations</li>
          <li>Attempt to circumvent any security features or access controls</li>
          <li>Use XCP Wallet to engage in fraud, money laundering, or other illegal activities</li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">6. Open Source</h2>
        <p className="mb-6">
          XCP Wallet incorporates open-source software components. The source code is available at{" "}
          <a
            href="https://github.com/XCP/extension"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline"
          >
            https://github.com/XCP/extension
          </a>{" "}
          and is licensed under the terms specified in the repository. Your use of open-source components is subject to
          the applicable open-source licenses.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">7. Connected Services and dApps</h2>
        <p className="mb-4">XCP Wallet may interact with third-party services, including:</p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>
            <strong className="text-zinc-100">Counterparty API servers</strong> for blockchain data and transaction
            broadcasting
          </li>
          <li>
            <strong className="text-zinc-100">Bitcoin network nodes</strong> for Bitcoin blockchain data
          </li>
          <li>
            <strong className="text-zinc-100">Counterparty dApps</strong> that you choose to connect to
          </li>
        </ul>
        <p className="mb-4">
          <strong className="text-zinc-100">Third-Party Responsibility:</strong> When you connect to a dApp or
          third-party service, your interaction is governed by that service&apos;s terms and policies. We are not
          responsible for the content, functionality, security, or practices of any third-party service. You connect to
          dApps at your own risk.
        </p>
        <p className="mb-6">
          <strong className="text-zinc-100">Per-Site Permissions:</strong> XCP Wallet requires your explicit approval
          before any dApp can access your wallet addresses or request transaction signatures. You can revoke these
          permissions at any time in Settings.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">8. Fees</h2>
        <p className="mb-4">
          <strong className="text-zinc-100">Network Fees:</strong> Blockchain transactions require payment of network
          fees (miner fees) to the Bitcoin network. You are responsible for all network fees associated with your
          transactions. Network fees are paid to miners, not to us.
        </p>
        <p className="mb-6">
          <strong className="text-zinc-100">No Service Fees:</strong> We do not currently charge fees for using XCP
          Wallet. If this changes, we will update these Terms and notify you.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">9. User Responsibilities</h2>
        <p className="mb-4">You are solely responsible for:</p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>Maintaining the security of your wallet, including your recovery phrase, password, and private keys</li>
          <li>All activities that occur using your wallet</li>
          <li>Ensuring your use of XCP Wallet complies with all applicable laws and regulations</li>
          <li>Backing up your recovery phrase in a secure location</li>
          <li>Understanding the risks associated with cryptocurrency transactions</li>
        </ul>
        <p className="mb-6">
          <strong className="text-zinc-100">No Recovery:</strong> We cannot recover your wallet if you lose your
          recovery phrase or password. Cryptocurrency transactions are irreversible. We cannot reverse, cancel, or
          refund any transaction.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">10. Eligibility</h2>
        <p className="mb-4">By using XCP Wallet, you represent and warrant that:</p>
        <p className="mb-4">
          <strong className="text-zinc-100">Age and Capacity:</strong> You are at least eighteen (18) years old (or the
          age of majority in your jurisdiction) and have the legal capacity to enter into binding agreements.
        </p>
        <p className="mb-4">
          <strong className="text-zinc-100">Sanctions Compliance:</strong> You are not located in, established under the
          laws of, or a resident of any country or region subject to comprehensive sanctions, including but not limited
          to:
        </p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>Cuba</li>
          <li>Iran</li>
          <li>North Korea</li>
          <li>Syria</li>
          <li>Russia</li>
          <li>Belarus</li>
          <li>The Crimea, Donetsk, Luhansk, Zaporizhzhia, and Kherson regions of Ukraine</li>
        </ul>
        <p className="mb-4">
          You are not identified on any sanctions list maintained by the U.S. Treasury Department&apos;s Office of
          Foreign Assets Control (OFAC), the United Nations, the European Union, or other applicable authorities.
        </p>
        <p className="mb-6">
          <strong className="text-zinc-100">No Circumvention:</strong> You will not use any technology, including VPNs,
          to circumvent geographic restrictions or access XCP Wallet from a restricted jurisdiction.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">11. Privacy</h2>
        <p className="mb-6">
          XCP Wallet does not collect or store personal information on our servers. All wallet data is stored locally on
          your device. Please review our{" "}
          <a href="/privacy" className="text-blue-400 underline">
            Privacy Policy
          </a>{" "}
          for details on how we handle information.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">12. Disclaimer of Warranties</h2>
        <p className="mb-4 uppercase text-sm">
          XCP WALLET IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND,
          WHETHER EXPRESS, IMPLIED, OR STATUTORY. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES,
          INCLUDING BUT NOT LIMITED TO:
        </p>
        <ul className="list-disc pl-6 mb-4 space-y-2 uppercase text-sm">
          <li>IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT</li>
          <li>WARRANTIES THAT XCP WALLET WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS</li>
          <li>WARRANTIES REGARDING THE ACCURACY, RELIABILITY, OR COMPLETENESS OF ANY INFORMATION PROVIDED</li>
        </ul>
        <p className="mb-4">
          <strong className="text-zinc-100">Cryptocurrency Risks:</strong> You acknowledge that:
        </p>
        <ul className="list-disc pl-6 mb-4 space-y-2">
          <li>Cryptocurrency markets are highly volatile and speculative</li>
          <li>Blockchain technology and protocols may contain bugs or vulnerabilities</li>
          <li>Transactions are irreversible once confirmed on the blockchain</li>
          <li>Digital assets may lose all value</li>
          <li>Regulatory changes may affect the legality or functionality of digital assets</li>
          <li>Smart contracts and protocols may behave unexpectedly</li>
        </ul>
        <p className="mb-6">
          <strong className="text-zinc-100">No Financial Advice:</strong> Nothing in XCP Wallet constitutes financial,
          investment, tax, or legal advice. You should consult qualified professionals before making any financial
          decisions.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">13. Limitation of Liability</h2>
        <p className="mb-4 uppercase text-sm">
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WE SHALL NOT BE LIABLE FOR ANY:
        </p>
        <ul className="list-disc pl-6 mb-4 space-y-2 uppercase text-sm">
          <li>INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES</li>
          <li>LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL</li>
          <li>LOSS OF CRYPTOCURRENCY OR DIGITAL ASSETS</li>
          <li>UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR DATA</li>
          <li>DAMAGES RESULTING FROM YOUR FAILURE TO MAINTAIN WALLET SECURITY</li>
          <li>DAMAGES RESULTING FROM THIRD-PARTY SERVICES OR DAPPS</li>
          <li>DAMAGES RESULTING FROM BLOCKCHAIN NETWORK ISSUES OR FAILURES</li>
        </ul>
        <p className="mb-4 uppercase text-sm">
          IN NO EVENT SHALL OUR TOTAL LIABILITY EXCEED ONE HUNDRED UNITED STATES DOLLARS (US$100.00).
        </p>
        <p className="mb-6 uppercase text-sm">
          SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES, SO SOME OF THE ABOVE
          LIMITATIONS MAY NOT APPLY TO YOU.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">14. Indemnification</h2>
        <p className="mb-4">
          You agree to indemnify, defend, and hold harmless Family Media LLC d.b.a. 21e14 Labs and its officers,
          directors, employees, agents, and affiliates from and against any claims, damages, losses, liabilities, costs,
          and expenses (including reasonable attorneys&apos; fees) arising from:
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>Your use of XCP Wallet</li>
          <li>Your violation of these Terms</li>
          <li>Your violation of any applicable laws or regulations</li>
          <li>Your violation of any third-party rights</li>
          <li>Any content or data you transmit through XCP Wallet</li>
        </ul>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">15. Intellectual Property</h2>
        <p className="mb-6">
          XCP Wallet is open-source software. Certain elements, including our trademarks, logos, and proprietary
          graphics, remain the property of Family Media LLC d.b.a. 21e14 Labs and are protected by applicable
          intellectual property laws. You may not use our trademarks or branding without prior written consent.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">16. Termination</h2>
        <p className="mb-4">
          You may terminate your use of XCP Wallet at any time by uninstalling the extension and deleting all copies
          from your devices.
        </p>
        <p className="mb-4">
          We may terminate or suspend your access to XCP Wallet at any time, without notice, for any reason, including
          if we believe you have violated these Terms.
        </p>
        <p className="mb-6">
          Upon termination, all rights granted to you under these Terms will immediately cease. Sections 12, 13, 14, and
          17 shall survive termination.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">17. Governing Law and Dispute Resolution</h2>
        <p className="mb-4">
          These Terms shall be governed by and construed in accordance with the laws of the State of Wyoming, United
          States, without regard to its conflict of law provisions.
        </p>
        <p className="mb-4">
          Any dispute arising out of or relating to these Terms or your use of XCP Wallet shall be resolved through
          binding arbitration in accordance with the rules of the American Arbitration Association. The arbitration
          shall take place in Wyoming, and the decision of the arbitrator shall be final and binding.
        </p>
        <p className="mb-6">
          <strong className="text-zinc-100">Class Action Waiver:</strong> You agree that any dispute resolution
          proceedings will be conducted only on an individual basis and not in a class, consolidated, or representative
          action. You waive any right to participate in a class action lawsuit or class-wide arbitration.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">18. Severability</h2>
        <p className="mb-6">
          If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions shall
          continue in full force and effect. The invalid or unenforceable provision shall be modified to the minimum
          extent necessary to make it valid and enforceable.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">19. Entire Agreement</h2>
        <p className="mb-6">
          These Terms, together with our Privacy Policy, constitute the entire agreement between you and Family Media
          LLC d.b.a. 21e14 Labs regarding your use of XCP Wallet and supersede any prior agreements.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">20. No Waiver</h2>
        <p className="mb-6">
          Our failure to enforce any provision of these Terms shall not constitute a waiver of that provision or any
          other provision. Any waiver must be in writing and signed by us.
        </p>

        <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-4">21. Contact Information</h2>
        <p className="mb-4">If you have any questions about these Terms of Service, please contact us at:</p>
        <p className="mb-6">
          <strong className="text-zinc-100">Family Media LLC d.b.a. 21e14 Labs</strong>
          <br />
          Email:{" "}
          <a href="mailto:legal@21e14.com" className="text-blue-400 underline">
            legal@21e14.com
          </a>
        </p>

        <hr className="border-zinc-700 my-8" />
        <p className="text-sm text-zinc-400 italic">These Terms of Service were last reviewed on February 2, 2025.</p>
      </article>
    </div>
  );
}
