/** Signal Cabinet style reminder: preserve the dark operational ground throughout the single Threshold route experience. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import { DocsPage, LegalPage, PrivacyPage } from "./pages/InfoPages";
import { OrganizationEntryPage, SignInPage, SignUpPage, VerifyPage } from "./pages/AuthPages";
import { ProductApp } from "./pages/ProductApp";
import { RequireRole } from "./components/RequireRole";

function GuardedProductApp() {
  return (
    <RequireRole>
      <ProductApp />
    </RequireRole>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/docs" component={DocsPage} />
      <Route path="/legal" component={LegalPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-up" component={SignUpPage} />
      <Route path="/verify" component={VerifyPage} />
      <Route path="/organization" component={OrganizationEntryPage} />
      <Route path="/app/:role/:page/:id" component={GuardedProductApp} />
      <Route path="/app/:role/:page" component={GuardedProductApp} />
      <Route path="/app/:role" component={GuardedProductApp} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
