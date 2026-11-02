import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// The service worker makes the app installable on the home screen and lets it open offline.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error: Error) => console.error(`The service worker didn't register: ${error.message}`));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
