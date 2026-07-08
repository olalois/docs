import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { horizenMainnet, horizenTestnet } from "./chains";
import { http } from "wagmi";

export const config = getDefaultConfig({
  appName: "Wraith",
  projectId: import.meta.env.VITE_WC_PROJECT_ID || "YOUR_PROJECT_ID",
  chains: [horizenTestnet, horizenMainnet],
  transports: {
    [horizenMainnet.id]: http(),
    [horizenTestnet.id]: http(),
  },
});
