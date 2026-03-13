import { useAuth } from "@/hooks/use-auth";
import { canAccessRoute, isTechnicianRole } from "@/lib/role-config";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  component: React.ComponentType;
  path?: string;
}

export function ProtectedRoute({ component: Component, path }: ProtectedRouteProps) {
  const { user } = useAuth();
  const userRole = user?.role || "user";

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

  return <Component />;
}
