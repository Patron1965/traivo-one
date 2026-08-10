export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

// Starta Replit OIDC-inloggning. I den inbäddade Workspace-förhandsvisningen körs
// appen i en cross-site iframe (topp-ramen är replit.com). Replits OIDC-sida kan
// inte renderas i en iframe — navigerar vi inuti iframen får användaren Replits
// generiska felsida. Är vi inramade öppnar vi därför inloggningen i en ny topp-
// nivå-flik; annars navigerar vi som vanligt.
export function goToLogin(returnTo?: string) {
  const path =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? `/api/login?returnTo=${encodeURIComponent(returnTo)}`
      : "/api/login";

  const inIframe = typeof window !== "undefined" && window.self !== window.top;
  if (inIframe) {
    const absolute = window.location.origin + path;
    const opened = window.open(absolute, "_blank", "noopener");
    if (opened) return;
    // Popup blockerad — försök navigera topp-ramen som sista utväg.
    try {
      window.top!.location.href = absolute;
      return;
    } catch {
      /* faller igenom till in-iframe-navigering */
    }
  }
  window.location.href = path;
}

// Redirect to login with a toast notification
export function redirectToLogin(toast?: (options: { title: string; description: string; variant: string }) => void) {
  if (toast) {
    toast({
      title: "Unauthorized",
      description: "You are logged out. Logging in again...",
      variant: "destructive",
    });
  }
  setTimeout(() => {
    goToLogin();
  }, 500);
}
