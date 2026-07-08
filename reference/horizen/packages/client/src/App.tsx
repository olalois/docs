import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Agents from "./pages/Agents";
import AgentProfile from "./pages/AgentProfile";
import Pay from "./pages/Pay";
import PayInvoice from "./pages/PayInvoice";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/agent/:name" element={<AgentProfile />} />
      <Route path="/pay/:name" element={<Pay />} />
      <Route path="/pay/invoice/:invoiceId" element={<PayInvoice />} />
    </Routes>
  );
}
