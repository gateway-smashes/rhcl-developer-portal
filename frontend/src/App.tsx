import { Navigate, Route, Routes } from "react-router-dom";
import { usePortalAuth } from "./auth/auth";
import AppShell from "./components/AppShell";
import RequireAuth from "./components/RequireAuth";
import { Spinner } from "./components/ui";
import Home from "./pages/Home";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import Subscribe from "./pages/Subscribe";
import Applications from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import Analytics from "./pages/Analytics";
import Billing from "./pages/Billing";
import Documentation from "./pages/Documentation";
import Settings from "./pages/Settings";
import AdminApis from "./pages/admin/AdminApis";
import AdminSubscriptions from "./pages/admin/AdminSubscriptions";
import AdminPlans from "./pages/admin/AdminPlans";
import AdminSettings from "./pages/admin/AdminSettings";

export default function App() {
  const auth = usePortalAuth();

  // Wait for the OIDC silent-login probe to finish before deciding what to
  // render — otherwise the AppShell flickers as anonymous, then logged-in.
  if (auth.isLoading) return <Spinner />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        {/* Public — anyone can browse the catalogue and read docs. */}
        <Route path="/home" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/documentation" element={<Documentation />} />
        {/* Gated — consuming an API needs an identity (subscribe / apps / quotas). */}
        <Route
          path="/products/:id/subscribe"
          element={
            <RequireAuth title="Sign in to subscribe" hint="Subscribing to a plan creates an application and issues an API key, so we need to know who you are.">
              <Subscribe />
            </RequireAuth>
          }
        />
        {/* Same wizard as /products/:id/subscribe but with a product-picker
            step up front — entry point from Applications → New application. */}
        <Route
          path="/applications/new"
          element={
            <RequireAuth title="Sign in to create an application" hint="Applications are tied to a developer identity.">
              <Subscribe />
            </RequireAuth>
          }
        />
        <Route path="/applications" element={<RequireAuth><Applications /></RequireAuth>} />
        <Route path="/applications/:id" element={<RequireAuth><ApplicationDetail /></RequireAuth>} />
        <Route path="/analytics" element={<RequireAuth><Analytics /></RequireAuth>} />
        <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        {/* Administration — reachable from Settings, not in the primary nav. */}
        <Route path="/admin/apis" element={<RequireAuth requires="canPublishApi"><AdminApis /></RequireAuth>} />
        <Route path="/admin/subscriptions" element={<RequireAuth requires="canApprove"><AdminSubscriptions /></RequireAuth>} />
        <Route path="/admin/plans" element={<RequireAuth requires="canPublishApi"><AdminPlans /></RequireAuth>} />
        <Route path="/admin/settings" element={<RequireAuth requires="canApprove"><AdminSettings /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </AppShell>
  );
}
