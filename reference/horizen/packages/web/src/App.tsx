import { Routes, Route } from "react-router-dom";
import { Nav } from "./components/nav";
import { Footer } from "./components/footer";
import { AutoSign } from "./components/auto-sign";
import Home from "./pages/Home";
import Setup from "./pages/Setup";
import Send from "./pages/Send";
import Receive from "./pages/Receive";
import About from "./pages/About";
import Pay from "./pages/Pay";

export function App() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <AutoSign />
      <main className="max-w-[720px] mx-auto w-full pt-36 pb-24 px-6 flex-1 flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="/about" element={<About />} />
          <Route path="/pay/:name" element={<Pay />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
