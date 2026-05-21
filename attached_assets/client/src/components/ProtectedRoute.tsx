import { useAuth } from "@/hooks/use-auth";
import { canAccessRoute, isTechnicianRole } from "@/lib/role-config";
import { useFeatures } from "@/lib/feature-context";
import { getModuleForRoute } from "@shared/modules";
import { Redirect } from "wouter";
import ModuleUpgradePage from "@/pages/ModuleUpgradePage";

interface ProtectedRouteProps {
  component: React.ComponentType;
  path?: string;
}

export function ProtectedRoute({ component: Component, path }: ProtectedRouteProps) {
  const { user } = useAuth();
  const userRole = user?.role || "user";
  const { isModuleEnabled } = useFeatures();

  if (path && !canAccessRoute(userRole, path)) {
    let redirectTo = "/";
    if (isTechnicianRole(userRole)) {
      redirectTo = "/mobile";
    } else if (userRole === "customer") {
      redirectTo = "/customer-portal";
    } else if (userRole === "reporter") {
      redirectTo = "/my-reports";
    }
    return <Redirect to={redirectTo} />;
  }

  if (path) {
    const moduleKey = getModuleForRoute(path);
    if (moduleKey && !isModuleEnabled(moduleKey)) {
      return <ModuleUpgradePage />;
    }
  }

  return <Component />;
}
