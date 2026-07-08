import { Link } from "react-router-dom";
import { VaultStatus } from "@/components/vault-status";

const cards = [
  {
    href: "/setup",
    num: "01",
    subtitle: "Terminal Initialization",
    title: "Setup",
    desc: "Generate your stealth keys and register your meta-address on-chain.",
  },
  {
    href: "/send",
    num: "02",
    subtitle: "Secure Transmission",
    title: "Send",
    desc: "Send assets privately to any stealth meta-address on Horizen.",
  },
  {
    href: "/receive",
    num: "03",
    subtitle: "Stealth Acquisition",
    title: "Receive",
    desc: "Scan for incoming stealth transfers and access your funds.",
  },
  {
    href: "/about",
    num: "04",
    subtitle: "Protocol Intelligence",
    title: "About",
    desc: "How stealth addresses work and the standards behind Wraith.",
  },
];

export default function Home() {
  return (
    <>
      <VaultStatus />

      <header className="mb-20">
        <h1 className="font-headline text-5xl md:text-7xl font-bold tracking-tighter leading-none text-primary mb-8 uppercase">
          Privacy is <br /> Sovereign.
        </h1>
        <p className="font-body text-on-surface-variant text-lg max-w-md leading-relaxed">
          Wraith is a privacy tool for Horizen, using stealth addresses to
          ensure your financial activity remains private.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            to={card.href}
            className="group block bg-surface-container-low p-8 hover:bg-surface-container-high transition-all duration-150"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="font-label text-[10px] text-primary/40 uppercase tracking-widest">
                {card.num} / {card.subtitle}
              </span>
            </div>
            <h2 className="font-headline text-2xl font-bold text-primary uppercase tracking-tight group-hover:translate-x-1 transition-transform duration-150">
              {card.title}
            </h2>
            <p className="font-body text-sm text-on-surface-variant mt-2">
              {card.desc}
            </p>
          </Link>
        ))}
      </section>
    </>
  );
}
