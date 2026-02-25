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
    const redirectTo = isTechnicianRole(userRole) ? "/mobile" : "/";
    return <Redirect to={redirectTo} />;
  }

  return <Component />;
}
