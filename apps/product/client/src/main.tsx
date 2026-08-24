import { ClerkProvider } from "@clerk/clerk-react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./product-review.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPublishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set — see apps/product/.env.local.");
}

createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={clerkPublishableKey}
    proxyUrl="/__clerk"
    afterSignOutUrl="/"
  >
    <App />
  </ClerkProvider>,
);
