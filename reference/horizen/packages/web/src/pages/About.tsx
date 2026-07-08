export default function About() {
  return (
    <div className="space-y-24">
      <section className="space-y-8">
        <h1 className="text-6xl font-headline font-bold tracking-tighter text-primary leading-none uppercase">
          Stealth
          <br />
          Protocol.
        </h1>
        <div className="h-1 w-24 bg-primary" />
        <p className="text-xl text-on-surface leading-relaxed max-w-prose font-light">
          Wraith is a privacy tool for Horizen, using stealth addresses to
          decouple your identity from your transactions. Non-custodial,
          deterministic, and invisible to outside observers.
        </p>
      </section>

      <section className="space-y-12">
        <div className="space-y-4">
          <span className="font-headline text-xs tracking-[0.3em] text-outline uppercase">
            Mechanism 01
          </span>
          <h2 className="text-3xl font-headline font-bold text-primary uppercase tracking-tight">
            Stealth Addressing
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-12 text-on-surface-variant">
          <div className="bg-surface-container-low p-8 border-l-2 border-primary">
            <p className="text-lg leading-relaxed text-on-surface">
              Every time you receive assets via Wraith, a unique one-time
              address is generated. To an outside observer, the transaction
              appears to be sent to a fresh wallet with no history. Only the
              intended recipient can derive the private key for this address.
            </p>
          </div>

          <div className="space-y-6">
            <p className="leading-relaxed">
              Wraith uses Diffie-Hellman key exchanges over the secp256k1
              elliptic curve. A sender creates an obfuscated destination that
              only the receiver can claim, breaking the link between the
              receiver's public identity and their on-chain holdings.
            </p>
            <p className="leading-relaxed">
              Two keys make this possible: a{" "}
              <span className="text-primary">viewing key</span> that finds
              incoming transfers by scanning announcements, and a{" "}
              <span className="text-primary">spending key</span> that derives
              the private key to access funds. You can delegate scanning without
              ever putting funds at risk.
            </p>
          </div>
        </div>
      </section>

      <section className="w-full h-48 bg-surface-container-lowest overflow-hidden relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="text-xs font-headline tracking-[0.5em] text-outline uppercase">
              Security Protocol
            </div>
            <div className="text-4xl font-headline font-bold text-primary tracking-tighter">
              NON-CUSTODIAL BY DESIGN
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-12">
        <div className="space-y-4">
          <span className="font-headline text-xs tracking-[0.3em] text-outline uppercase">
            Mechanism 02
          </span>
          <h2 className="text-3xl font-headline font-bold text-primary uppercase tracking-tight">
            The ERC-5564 Standard
          </h2>
        </div>

        <div className="space-y-8">
          <p className="leading-relaxed text-on-surface-variant">
            Wraith is built on ERC-5564, which defines a universal way to
            announce stealth meta-addresses. Any compatible application can send
            private payments without prior coordination. The companion ERC-6538
            provides an on-chain registry for meta-address lookup.
          </p>

          <div className="flex flex-col gap-4">
            <a
              href="https://eips.ethereum.org/EIPS/eip-5564"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between p-6 bg-surface-container hover:bg-surface-container-high transition-all duration-150 border border-outline-variant/10"
            >
              <div className="flex flex-col">
                <span className="font-headline text-[10px] tracking-widest text-outline uppercase">
                  Specification
                </span>
                <span className="text-lg font-headline font-bold text-primary">
                  ERC-5564: Stealth Addresses
                </span>
              </div>
              <span className="text-primary group-hover:translate-x-1 transition-transform font-headline">
                &rarr;
              </span>
            </a>

            <a
              href="https://eips.ethereum.org/EIPS/eip-6538"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between p-6 bg-surface-container hover:bg-surface-container-high transition-all duration-150 border border-outline-variant/10"
            >
              <div className="flex flex-col">
                <span className="font-headline text-[10px] tracking-widest text-outline uppercase">
                  Registry
                </span>
                <span className="text-lg font-headline font-bold text-primary">
                  ERC-6538: Stealth Meta-Address Registry
                </span>
              </div>
              <span className="text-primary group-hover:translate-x-1 transition-transform font-headline">
                &rarr;
              </span>
            </a>

            <a
              href="https://vitalik.ca/general/2023/01/20/stealth.html"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between p-6 bg-surface-container hover:bg-surface-container-high transition-all duration-150 border border-outline-variant/10"
            >
              <div className="flex flex-col">
                <span className="font-headline text-[10px] tracking-widest text-outline uppercase">
                  Reference
                </span>
                <span className="text-lg font-headline font-bold text-primary">
                  Vitalik's Stealth Address Guide
                </span>
              </div>
              <span className="text-primary group-hover:translate-x-1 transition-transform font-headline">
                &rarr;
              </span>
            </a>
          </div>
        </div>
      </section>

      <section className="py-16 border-t border-outline-variant/20 flex flex-col items-center text-center space-y-6">
        <div className="w-12 h-12 bg-primary flex items-center justify-center">
          <span className="text-surface text-2xl font-headline font-bold">
            W
          </span>
        </div>
        <h3 className="text-2xl font-headline font-bold text-primary uppercase">
          Privacy is a human right.
        </h3>
        <p className="max-w-md text-sm text-outline leading-relaxed uppercase tracking-wider font-headline">
          Wraith provides the tools to exercise that right on Horizen.
        </p>
      </section>
    </div>
  );
}
