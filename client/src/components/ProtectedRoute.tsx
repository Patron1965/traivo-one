import { useAuth } from "@/hooks/use-auth";
import { canAccessRoute } from "@/lib/role-config";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  component: React.ComponentType;
  path?: string;
}

export function ProtectedRoute({ component: Component, path }: ProtectedRouteProps) {
  const { user } = useAuth();
  const userRole = user?.role || "user";

  if (path && !canAccessRoute(userRole, path)) {
    return <Redirect to="/" />;
  }

  return <Component />;
}
