import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="w-full max-w-[720px] mx-auto py-8 flex flex-col items-center gap-4 mt-auto">
      <div className="flex gap-8">
        <Link
          to="/about"
          className="font-body text-[10px] uppercase tracking-[0.2em] text-primary-container hover:text-primary transition-colors duration-150"
        >
          Privacy
        </Link>
        <Link
          to="/about"
          className="font-body text-[10px] uppercase tracking-[0.2em] text-primary-container hover:text-primary transition-colors duration-150"
        >
          Security
        </Link>
        <a
          href="https://github.com/truthixify/wraith"
          target="_blank"
          rel="noopener noreferrer"
          className="font-body text-[10px] uppercase tracking-[0.2em] text-primary-container hover:text-primary transition-colors duration-150"
        >
          GitHub
        </a>
      </div>
      <div className="text-xs font-bold text-primary font-headline tracking-widest">
        WRAITH
      </div>
      <p className="font-body text-[10px] uppercase tracking-[0.2em] text-primary-container">
        Built on Horizen
      </p>
    </footer>
  );
}
