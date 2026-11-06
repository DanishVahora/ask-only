import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { MotionConfig } from "motion/react";

import "./styles.css";
import Shell from "./components/Shell.jsx";
import Documents from "./pages/Documents.jsx";
import Reviewers from "./pages/Reviewers.jsx";
import Questions from "./pages/Questions.jsx";
import Ask, { Shared } from "./pages/Ask.jsx";
import { AnsweringProvider } from "./lib/answering.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import SmoothScroll from "./lib/smooth.jsx";

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
/* Loaded on its own. It is the heaviest page and most people opening a link never see
 * it, and a mistake in it must not be able to take the product down with it. */
const Landing = lazy(() => import("./pages/Landing.jsx"));

/* A page that throws takes only itself down. The boundary at the root sat above the
 * answering engine, so any crash on any page also stopped answering until a reload.
 * Keyed by path, so going to another page clears it. */
function Page({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname} inline>{children}</ErrorBoundary>;
}

const config = createConfig({
  chains: [sepolia],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [sepolia.id]: http() },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/* One root per container. If this file re-runs without a page reload, a second root
 * fights the first over the same DOM and React dies with a removeChild error. */
const container = document.getElementById("root");
container.askOnlyRoot ??= createRoot(container);

container.askOnlyRoot.render(
  <React.StrictMode>
    <ErrorBoundary>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <AnsweringProvider>
            <BrowserRouter>
              <SmoothScroll />
              <Shell>
                <Page>
                <Routes>
                  <Route path="/" element={<Suspense fallback={null}><Landing /></Suspense>} />
                  <Route path="/documents" element={<Documents />} />
                  <Route path="/reviewers" element={<Reviewers />} />
                  <Route path="/questions" element={<Questions />} />
                  <Route path="/shared" element={<Shared />} />
                  <Route path="/ask" element={<Ask />} />
                  {/* links already handed out, and the old names */}
                  <Route path="/vault" element={<Navigate to="/documents" replace />} />
                  <Route path="/ledger" element={<Navigate to="/questions" replace />} />
                  <Route path="*" element={<Navigate to="/documents" replace />} />
                </Routes>
                </Page>
              </Shell>
              <Toaster
                position="bottom-center"
                toastOptions={{
                  style: {
                    background: "#123a2c",
                    color: "#f4f3dc",
                    border: "none",
                    borderRadius: "12px",
                    fontFamily: "Figtree, sans-serif",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    boxShadow: "0 8px 24px rgba(16,26,21,0.24)",
                  },
                }}
              />
            </BrowserRouter>
          </AnsweringProvider>
        </MotionConfig>
      </QueryClientProvider>
    </WagmiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
