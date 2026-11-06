import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import "./styles.css";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import Vault from "./pages/Vault.jsx";
import Ask from "./pages/Ask.jsx";
import Ledger from "./pages/Ledger.jsx";

/**
 * Injected only, on purpose.
 *
 * RainbowKit and WalletConnect both want a cloud projectId, which means a
 * third-party service in the critical path of a demo being given on venue
 * wifi. MetaMask's injected provider needs nothing, works offline from any
 * cloud service, and is what the people in the room already have.
 */
const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: { [sepolia.id]: http() },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/vault" element={<Vault />} />
              <Route path="/ask" element={<Ask />} />
              <Route path="/ledger" element={<Ledger />} />
            </Routes>
          </Shell>
          <Toaster
            position="bottom-center"
            toastOptions={{
              style: {
                background: "#faf7e4",
                color: "#1a1a1a",
                border: "1.6px solid #1a1a1a",
                borderRadius: "999px",
                fontFamily: "Figtree, sans-serif",
                fontSize: "0.875rem",
                fontWeight: 500,
              },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
