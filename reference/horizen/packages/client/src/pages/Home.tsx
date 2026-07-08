import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="min-h-screen bg-surface font-body text-on-surface">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-8 py-4 bg-surface/90 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="Wraith" className="h-7 opacity-90" />
            <span className="text-lg font-headline font-bold tracking-widest text-primary">WRAITH</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/agents"
            className="hidden md:block text-sm text-on-surface-variant hover:text-primary transition-colors font-mono"
          >
            Directory
          </Link>
          <Link
            to="/chat"
            className="bg-surface-container-low text-primary px-6 py-2 border border-primary/20 hover:border-primary font-mono text-xs uppercase tracking-widest transition-all"
          >
            Launch Agent
          </Link>
        </div>
      </nav>

      <main className="pt-24">
        {/* Hero */}
        <section className="relative min-h-[85vh] flex items-center px-8 md:px-16 overflow-hidden">
          <div className="absolute inset-0 z-0 opacity-20">
            <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/20 blur-[120px]" />
            <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-primary/10 blur-[100px]" />
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center w-full z-10">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-container mb-6 border-l-4 border-primary">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Secured via Phala TEE</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-headline font-bold text-on-surface leading-[0.9] tracking-tighter mb-8">
                Your AI Agent,<br /><span className="text-primary">Your Privacy.</span>
              </h1>
              <p className="text-lg text-on-surface-variant max-w-lg mb-10 leading-relaxed">
                Deploy private AI agents on Horizen that handle payments through stealth addresses. Every transaction goes to a fresh one-time address — unlinkable, untraceable.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  to="/chat"
                  className="bg-white text-surface px-10 py-4 font-headline font-bold text-lg hover:neon-glow transition-all text-center"
                >
                  Deploy Your Agent
                </Link>
                <a
                  href="https://github.com/truthixify/wraith"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-outline-variant/30 text-on-surface px-10 py-4 font-headline font-bold text-lg hover:bg-surface-container transition-all text-center"
                >
                  View Source
                </a>
              </div>
            </div>

            {/* Hero visual — terminal card */}
            <div className="relative hidden md:block">
              <div className="bg-surface-container p-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(198,198,199,0.05),transparent)]" />
                <div className="font-mono text-[10px] text-primary/40 mb-6 flex justify-between">
                  <span>AGENT_STATUS: ACTIVE</span>
                  <span>RUNTIME: PHALA_TEE</span>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-4 p-4 bg-surface-container-low">
                    <div className="w-8 h-8 bg-primary/20 flex items-center justify-center text-primary text-xs font-mono">W</div>
                    <div className="flex-1">
                      <div className="h-2 w-32 bg-surface-container-highest mb-2" />
                      <div className="font-mono text-[10px] text-on-surface-variant">oracle.wraith connected</div>
                    </div>
                  </div>
                  <div className="flex gap-4 p-4 bg-surface-container-low ml-8">
                    <div className="w-8 h-8 bg-primary/20 flex items-center justify-center text-primary text-xs font-mono">$</div>
                    <div className="flex-1">
                      <div className="font-mono text-[10px] text-primary/60">send 0.01 ETH to alice.wraith</div>
                      <div className="font-mono text-[10px] text-green-400 mt-1">→ stealth address generated</div>
                    </div>
                  </div>
                  <div className="flex gap-4 p-4 bg-surface-container-low">
                    <div className="w-8 h-8 bg-green-500/20 flex items-center justify-center text-green-400 text-xs font-mono">✓</div>
                    <div className="flex-1">
                      <div className="font-mono text-[10px] text-green-400">Payment sent — unlinkable on-chain</div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-outline-variant/10 flex justify-between items-center">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-primary animate-pulse" />
                    <span className="font-mono text-[10px] text-on-surface-variant">STEALTH_LINK: ACTIVE</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-24 px-8 md:px-16 bg-surface">
          <div className="mb-16">
            <h2 className="text-3xl font-headline font-bold tracking-tighter mb-4 uppercase">Engineered for Sovereignty</h2>
            <p className="text-on-surface-variant max-w-2xl leading-relaxed">
              WRAITH combines TEE hardware security with Horizen's EVM to create a privacy layer for AI agent payments.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2 bg-surface-container p-10 group hover:bg-surface-bright transition-all">
              <div className="text-3xl text-primary mb-6 font-mono">◇</div>
              <h3 className="text-xl font-headline font-bold mb-3 uppercase">Stealth Addresses</h3>
              <p className="text-on-surface-variant text-sm mb-4">Every payment to a fresh one-time address. On-chain observers see random addresses with no link to sender or receiver.</p>
              <div className="flex flex-wrap gap-2">
                <span className="bg-surface-container-highest px-3 py-1 font-mono text-[10px] text-primary border-l-2 border-primary">SECP256K1</span>
                <span className="bg-surface-container-highest px-3 py-1 font-mono text-[10px] text-primary border-l-2 border-primary">ERC-5564</span>
              </div>
            </div>

            <div className="md:col-span-2 bg-surface-container p-10 group hover:bg-surface-bright transition-all relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
              <div className="text-3xl text-primary mb-6 font-mono">⬡</div>
              <h3 className="text-xl font-headline font-bold mb-3 uppercase text-primary">TEE-Secured Keys</h3>
              <p className="text-on-surface-variant text-sm">Private keys derived inside Intel TDX hardware enclaves via Phala dstack. Never stored, never exported without wallet signature verification.</p>
            </div>

            <div className="md:col-span-1 bg-surface-container p-8 group hover:bg-surface-bright transition-all">
              <div className="text-2xl text-on-surface-variant mb-4 font-mono">◈</div>
              <h3 className="text-lg font-headline font-bold mb-2 uppercase">Privacy Soul</h3>
              <p className="text-sm text-on-surface-variant">Your agent proactively warns about privacy risks and refuses unsafe actions.</p>
            </div>

            <div className="md:col-span-3 bg-surface-container p-8 flex flex-col md:flex-row items-start md:items-center gap-8 group hover:bg-surface-bright transition-all">
              <div className="md:w-1/2">
                <div className="text-2xl text-on-surface-variant mb-4 font-mono">⟁</div>
                <h3 className="text-xl font-headline font-bold mb-2 uppercase">Autonomous Agent</h3>
                <p className="text-sm text-on-surface-variant">Schedule payments, scan for incoming funds, manage invoices, and optimize privacy — all without your input.</p>
              </div>
              <div className="md:w-1/2 w-full bg-surface-container-low p-4 space-y-2">
                <div className="flex justify-between font-mono text-[9px] text-primary/60">
                  <span>TASK: BACKGROUND_SCAN</span>
                  <span>INTERVAL: 5M</span>
                </div>
                <div className="h-[1px] bg-outline-variant/10" />
                <div className="flex justify-between font-mono text-[9px] text-primary/60">
                  <span>TASK: SCHEDULED_PAY</span>
                  <span>INTERVAL: 24H</span>
                </div>
                <div className="h-[1px] bg-outline-variant/10" />
                <div className="flex justify-between font-mono text-[9px] text-primary/60">
                  <span>TASK: PRIVACY_AUDIT</span>
                  <span>STATUS: ACTIVE</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it Works */}
        <section className="py-24 px-8 md:px-16 bg-surface-container-low">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-headline font-bold tracking-tighter uppercase mb-4">The Protocol</h2>
            <p className="text-on-surface-variant max-w-xl mx-auto">Three steps to private AI agent payments on Horizen.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-1">
            {[
              { num: "01", title: "Connect Wallet", desc: "Connect MetaMask or any EVM wallet via RainbowKit. Sign a message to prove ownership inside the TEE." },
              { num: "02", title: "Create Agent", desc: "Your agent gets its own EVM wallet, stealth identity, and .wraith name — all derived inside TEE hardware." },
              { num: "03", title: "Transact Privately", desc: "Send, receive, invoice, and schedule payments through stealth addresses. Every payment is unlinkable." },
            ].map((step) => (
              <div key={step.num} className="relative p-12 bg-surface text-center group">
                <div className="font-mono text-8xl text-surface-container-highest absolute top-0 left-1/2 -translate-x-1/2 font-black opacity-30 select-none">
                  {step.num}
                </div>
                <div className="relative z-10">
                  <div className="w-16 h-16 bg-surface-container mx-auto mb-8 flex items-center justify-center border border-outline-variant/20 group-hover:border-primary transition-colors">
                    <span className="text-primary text-xl font-mono">{step.num}</span>
                  </div>
                  <h3 className="text-xl font-headline font-bold mb-4 uppercase">{step.title}</h3>
                  <p className="text-on-surface-variant text-sm">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-8 md:px-16 bg-surface text-center">
          <img src="/logo.png" alt="Wraith" className="h-16 mx-auto mb-8 opacity-20" />
          <h2 className="text-4xl font-headline font-bold tracking-tighter mb-4">Ready to go private?</h2>
          <p className="text-on-surface-variant mb-10 max-w-lg mx-auto">
            Deploy your AI agent in under a minute. No setup, no configuration — just connect your wallet and start.
          </p>
          <Link
            to="/chat"
            className="inline-block bg-white text-surface px-12 py-5 font-headline font-bold text-lg hover:neon-glow transition-all"
          >
            Deploy Your Agent
          </Link>
        </section>

        {/* Footer */}
        <footer className="py-8 px-8 md:px-16 bg-surface-container-lowest border-t border-outline-variant/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Wraith" className="h-5 opacity-40" />
              <span className="text-xs text-on-surface-variant font-mono">WRAITH PROTOCOL</span>
            </div>
            <div className="flex gap-6 text-xs text-outline">
              <a href="https://github.com/truthixify/wraith" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a>
              <Link to="/agents" className="hover:text-primary transition-colors">Directory</Link>
              <Link to="/chat" className="hover:text-primary transition-colors">Launch</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
