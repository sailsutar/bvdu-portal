import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { hydrateCohortFromLocal } from "./lib/cohort-store.js";
import { startLoading, stopLoading } from "./lib/loading-bus.js";
import "./styles.css";

/**
 * Global fetch interceptor — top bar for real API work.
 * Skips noisy/lightweight endpoints so the UI does not feel heavy.
 * Full-screen brand overlay only after ~1.2s (GlobalLoading).
 */
const _fetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  let url = "";
  try {
    url = typeof input === "string" ? input : input?.url || "";
  } catch (_) {
    url = "";
  }

  const skip =
    typeof url === "string" &&
    (/\/api\/(health|portal-config|settings|announcements|tg-assignments)\b/i.test(url) ||
      /\/model-health\b/i.test(url) ||
      /\/sentiment\/health\b/i.test(url));

  const track =
    !skip &&
    typeof url === "string" &&
    (url.includes("/api/") ||
      url.startsWith("/api") ||
      url.includes(":4000") ||
      url.includes(":8001"));

  if (track) startLoading("fetch");
  try {
    return await _fetch(input, init);
  } finally {
    if (track) stopLoading();
  }
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
      retryDelay: (n) => Math.min(4000, 800 * 2 ** n),
      networkMode: "offlineFirst",
    },
    mutations: {
      networkMode: "offlineFirst",
      retry: 1,
    },
  },
});

hydrateCohortFromLocal();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
