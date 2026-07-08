import { Link, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { WalletButton } from "@/components/connect-button";
import { useEffect, useState } from "react";

const links = [
  { href: "/setup", label: "Setup" },
  { href: "/send", label: "Send" },
  { href: "/receive", label: "Receive" },
  { href: "/about", label: "About" },
];

export function Nav() {
  const { pathname } = useLocation();
  const { isConnected } = useAccount();
  const { clear } = useStealthKeysContext();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isConnected) clear();
  }, [isConnected, clear]);

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <nav className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[720px] z-50 flex justify-between items-center px-6 h-20 bg-surface-container-low">
        <Link to="/" className="hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="Wraith" className="h-9 w-auto" />
        </Link>
        <div className="hidden md:flex gap-8 items-center">
          {links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className={`font-headline tracking-tighter uppercase text-xs transition-colors duration-150 ${
                pathname === link.href
                  ? "text-primary font-bold"
                  : "text-primary-container hover:text-primary"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <WalletButton />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden font-headline text-primary text-sm tracking-widest"
          >
            {menuOpen ? "[x]" : "[=]"}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 w-full max-w-[720px] z-40 bg-surface-container-low flex flex-col py-4 px-6 gap-4 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className={`font-headline tracking-tighter uppercase text-sm py-2 transition-colors duration-150 ${
                pathname === link.href
                  ? "text-primary font-bold"
                  : "text-primary-container hover:text-primary"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
