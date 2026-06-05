export type UserRole = "owner" | "admin" | "planner" | "technician" | "user" | "viewer" | "customer" | "reporter";

const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Ägare",
  admin: "Admin",
  planner: "Planerare",
  technician: "Tekniker",
  user: "Användare",
  viewer: "Betraktare",
  customer: "Kund",
  reporter: "Anmälare",
};

const ADMIN_ONLY_ROUTES = new Set([
  "/user-management",
  "/tenant-config",
  "/onboarding",
  "/import",
  "/import-templates",
  "/architecture",
  "/system-dashboard",
  "/industry-packages",
  "/api-costs",
  "/sms-settings",
  "/system-overview",
  "/data-requirements",
  "/metadata-settings",
  "/metadata-definitions",
  "/order-type-metadata",
  "/restore-dormant-customers",
  "/shadow-comparison",
  "/archive",
]);

const PLANNER_ROUTES = new Set([
  "/",
  "/home",
  "/planner",
  "/week-planner",
  "/veckoplan",
  "/grovplanering",
  "/distrikt",
  "/clusters",
  "/customers",
  "/routes",
  "/optimization",
  "/objects",
  "/work-orders",
  "/resources",
  "/procurements",
  "/articles",
  "/price-lists",
  "/order-stock",
  "/cases",
  "/vehicles",
  "/subscriptions",
  "/planning-parameters",
  "/planner-search-filters",
  "/article-components",
  "/invoice-recalculation-log",
  "/dashboard",
  "/economics",
  "/setup-analysis",
  "/predictive-planning",
  "/customer-portal",
  "/portal-messages",
  "/booking-slots",
  "/settings",
  "/mobile",
  "/project-report",
  "/invoicing",
  "/fleet",
  "/fortnox",
  "/environmental-certificates",
  "/order-concepts",
  "/assignments",
  "/ai-assistant",
  "/reporting",
  "/weekly-report",
  "/workflow-guide",
  "/ai-planning",
  "/ai-command-center",
  "/inspections",
  "/planner-map",
  "/historical-map",
  "/checklist-templates",
  "/annual-planning",
  "/enhetsansvarig",
]);

const TECHNICIAN_ROUTES = new Set([
  "/",
  "/home",
  "/mobile",
  "/settings",
]);

const CUSTOMER_ROUTES = new Set([
  "/",
  "/home",
  "/customer-portal",
  "/settings",
]);

const REPORTER_ROUTES = new Set([
  "/",
  "/home",
  "/settings",
  "/my-reports",
]);

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] || "Användare";
}

export function isAdminRole(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

export function isPlannerRole(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin" || role === "planner";
}

export function isTechnicianRole(role: string | undefined | null): boolean {
  return role === "technician";
}

export function canAccessRoute(role: string | undefined | null, route: string): boolean {
  if (!role) return false;

  const normalizedRole = role as UserRole;
  const basePath = route.split("/").slice(0, 2).join("/") || "/";

  if (normalizedRole === "owner" || normalizedRole === "admin") {
    return true;
  }

  if (ADMIN_ONLY_ROUTES.has(basePath)) {
    return false;
  }

  if (normalizedRole === "technician") {
    return TECHNICIAN_ROUTES.has(basePath);
  }

  if (normalizedRole === "customer") {
    return CUSTOMER_ROUTES.has(basePath);
  }

  if (normalizedRole === "reporter") {
    return REPORTER_ROUTES.has(basePath);
  }

  if (normalizedRole === "planner") {
    return PLANNER_ROUTES.has(basePath);
  }

  return PLANNER_ROUTES.has(basePath);
}

export type NavMenuGroup = "grunddata" | "ordrar" | "planering" | "falt" | "analys" | "admin";

const MENU_ACCESS: Record<NavMenuGroup, UserRole[]> = {
  grunddata: ["owner", "admin", "planner", "user", "viewer", "customer"],
  ordrar: ["owner", "admin", "planner"],
  planering: ["owner", "admin", "planner"],
  falt: ["owner", "admin", "user"],
  analys: ["owner", "admin", "planner"],
  admin: ["owner", "admin"],
};

export function canAccessMenu(role: string | undefined | null, menu: NavMenuGroup): boolean {
  if (!role) return false;
  return MENU_ACCESS[menu]?.includes(role as UserRole) ?? false;
}

export function filterNavItems<T extends { url: string }>(
  items: T[],
  role: string | undefined | null
): T[] {
  if (!role) return [];
  return items.filter((item) => canAccessRoute(role, item.url));
}

export function filterQuickLinks<T extends { url: string }>(
  links: T[],
  role: string | undefined | null
): T[] {
  if (!role) return [];
  return links.filter((link) => canAccessRoute(role, link.url));
}
