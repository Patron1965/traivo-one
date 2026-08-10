import { useUser, useAuth as useClerkAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";

type AuthUser = {
  id?: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
  tenantId?: string | null;
  accessGranted?: boolean;
  [key: string]: any;
};

async function fetchServerUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
  return response.json();
}

export function useAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: clerkUser } = useUser();

  // Fetch app-specific data (role, tenantId, accessGranted) from server.
  // Only runs when Clerk has loaded and the user is signed in to avoid transient 401s.
  const { data: serverUser, isLoading: serverLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchServerUser,
    enabled: isLoaded && !!isSignedIn,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const isLoading = !isLoaded || (!!isSignedIn && serverLoading && serverUser === undefined);

  const user: AuthUser | null =
    isSignedIn && serverUser
      ? {
          // Use externalId (original Replit Auth ID) for migrated users so existing
          // app data keyed by the legacy ID continues to work.
          id: clerkUser?.externalId ?? clerkUser?.id ?? serverUser?.id,
          email: clerkUser?.primaryEmailAddress?.emailAddress ?? serverUser?.email,
          firstName: clerkUser?.firstName ?? serverUser?.firstName,
          lastName: clerkUser?.lastName ?? serverUser?.lastName,
          profileImageUrl: clerkUser?.imageUrl ?? serverUser?.profileImageUrl,
          ...serverUser,
        }
      : null;

  return {
    user,
    isLoading,
    isAuthenticated: !!isSignedIn && serverUser !== null && serverUser !== undefined,
    accessGranted: serverUser?.accessGranted ?? false,
  };
}
