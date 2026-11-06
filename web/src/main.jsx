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
 * Every injected wallet, discovered automatically. Not MetaMask-only.
 *
 * multiInjectedProviderDiscovery turns on EIP-6963, so each wallet the browser
 * has - MetaMask, Rabby, Coinbase, Brave, OKX, Phantom, Frame - announces
 * itself and gets its own connector with its own name and icon. The injected()
 * fallback covers older wallets that predate 6963.
 *
 * No WalletConnect and no RainbowKit, on purpose: both want a cloud projectId,
 * which puts a third-party service in the critical path of a demo given on
 * venue wifi. Nothing here needs the network to connect a wallet.
 *
 * Sepolia is listed because that is where ENSv2 lives and where the app READS
 * from. It is not required for signing - the EIP-712 domain is chain-agnostic,
 * so a wallet sitting on any network can sign without being asked to switch.
 */
const config = createConfig({
  chains: [sepolia],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
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
