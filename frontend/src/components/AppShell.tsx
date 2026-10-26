import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Boxes,
  CreditCard,
  Home,
  Inbox,
  LayoutGrid,
  Layers,
  LineChart,
  LogIn,
  LogOut,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import { useAdminSubscriptions } from "../api/hooks";
import { usePortalAuth } from "../auth/auth";
import { usePortalPermissions } from "../auth/permissions";
import { useTenant } from "../hooks/useTenant";
import { Button, cx } from "./ui";

type NavItem = { to: string; label: string; icon: typeof Home; auth?: boolean };
const NAV: NavItem[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/products", label: "Products", icon: LayoutGrid },
  { to: "/documentation", label: "Documentation", icon: BookOpen },
  { to: "/applications", label: "Applications", icon: Boxes, auth: true },
  { to: "/analytics", label: "Analytics", icon: LineChart, auth: true },
  { to: "/billing", label: "Billing", icon: CreditCard, auth: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon, auth: true },
];
// Surfaced as a separate "Admin" group below the main nav so reviewers can
// jump straight to the approvals queue without spelunking through Settings.
const ADMIN_NAV: NavItem[] = [
  { to: "/admin/subscriptions", label: "Approvals", icon: Inbox },
  { to: "/admin/apis", label: "APIs", icon: ShieldCheck },
  { to: "/admin/plans", label: "Plans", icon: Layers },
  { to: "/admin/settings", label: "System settings", icon: SettingsIcon },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const auth = usePortalAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initial = (auth.username ?? "?").slice(0, 1).toUpperCase();
  // Anonymous users see the public catalogue only; authenticated users get
  // the full nav. The auth-only entries don't redirect-on-click because the
  // route-level RequireAuth handles that, but hiding them keeps the sidebar
  // honest about what's available.
  const nav = NAV.filter((n) => !n.auth || auth.isAuthenticated);
  // hasAdminUI = can see the Administration nav group (either role).
  // canApprove = api-admin only — used to surface the header Approvals
  // queue button (api-owner manages APIs/Plans but doesn't approve keys).
  const { canApprove, hasAdminUI } = usePortalPermissions();
  const tenant = useTenant();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      {/* Sidebar */}
      <aside
        className={cx(
          "brand-gradient fixed inset-y-0 z-40 flex w-[264px] flex-col text-white transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button onClick={() => navigate("/home")} className="flex items-center gap-3 px-5 py-5 text-left">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-rh-500 text-lg font-black shadow-lift">
            ⬡
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold">{tenant.name}</div>
            <div className="text-[11px] text-white/55">Developer Portal</div>
          </div>
        </button>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((item) => (
            <SidebarLink key={item.to} item={item} onClick={() => setMobileOpen(false)} />
          ))}
          {hasAdminUI && (
            <>
              <div className="mb-1 mt-5 px-3.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
                Administration
              </div>
              {ADMIN_NAV
                // Approvals + System settings are admin-only; APIs and Plans
                // show for both owner and admin.
                .filter((item) =>
                  (item.to !== "/admin/subscriptions" && item.to !== "/admin/settings") || canApprove,
                )
                .map((item) => (
                  <SidebarLink
                    key={item.to}
                    item={item}
                    onClick={() => setMobileOpen(false)}
                    badge={item.to === "/admin/subscriptions" ? <PendingApprovalsBadge /> : undefined}
                  />
                ))}
            </>
          )}
        </nav>

        <div className="m-3 rounded-2xl bg-white/8 p-3">
          {auth.isAuthenticated ? (
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-sm font-bold">{initial}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{auth.username}</div>
                <div className="truncate text-[11px] text-white/55">{auth.email ?? tenant.name}</div>
              </div>
              {auth.enabled && (
                <button onClick={auth.logout} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" title="Sign out">
                  <LogOut size={16} />
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-center">
              <p className="text-xs text-white/65">Sign in to manage applications and API keys.</p>
              <Button className="w-full" onClick={auth.login}>
                <LogIn size={14} /> Sign in with SSO
              </Button>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)}>
            <LayoutGrid size={18} />
          </button>
          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              onClick={() => navigate("/products")}
              readOnly
              placeholder="Search products, APIs, docs…"
              className="w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-500 hover:bg-white"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {auth.isAuthenticated ? (
              <>
                {/* Admin-only: a prominent "Pending approvals" CTA at the right
                    of the header, with a live count badge. Most-used admin
                    action; shouldn't require scrolling to find. */}
                {canApprove && <PendingApprovalsHeaderButton />}
                <button className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100" title="Notifications">
                  <Bell size={18} />
                </button>
                <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  {initial}
                </div>
              </>
            ) : (
              <Button size="sm" onClick={auth.login}>
                <LogIn size={14} /> Sign in
              </Button>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-6 lg:py-9">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({
  item,
  badge,
  onClick,
}: {
  item: NavItem;
  badge?: ReactNode;
  onClick?: () => void;
}) {
  const { to, label, icon: Icon } = item;
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
          isActive ? "bg-white/12 text-white shadow-inner" : "text-white/70 hover:bg-white/8 hover:text-white",
        )
      }
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      {badge}
    </NavLink>
  );
}

/** Shows the pending-approvals count next to the Approvals nav entry. The
 *  hook is cheap (one GET) and the result drives the existing Bell dot. */
function PendingApprovalsBadge() {
  const { data } = useAdminSubscriptions("PENDING");
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <span className="rounded-full bg-rh-500 px-2 py-0.5 text-[10px] font-bold leading-none text-white">
      {count}
    </span>
  );
}

/**
 * The header-right entry point to the approvals queue — admin only. Always
 * visible (even when the queue is empty so users learn where it lives),
 * but renders a red count badge the moment there's a pending review.
 *
 * Kept separate from the bell so the bell stays for actual notifications.
 */
function PendingApprovalsHeaderButton() {
  const { data } = useAdminSubscriptions("PENDING");
  const count = data?.length ?? 0;
  return (
    <NavLink
      to="/admin/subscriptions"
      title="Subscription requests waiting for review"
      className={({ isActive }) =>
        cx(
          "relative inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-brand-50 text-brand-700"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )
      }
    >
      <Inbox size={16} />
      <span className="hidden sm:inline">Approvals</span>
      {count > 0 && (
        <span className="ml-0.5 rounded-full bg-rh-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
          {count}
        </span>
      )}
    </NavLink>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  emoji,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  emoji?: string;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4 animate-fade-up">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-slate-900">
          {title} {emoji && <span>{emoji}</span>}
        </h1>
        {subtitle && <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
