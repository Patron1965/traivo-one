import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { logLoginEvent } from "../../login-audit";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  const userId = claims["sub"];
  const email = claims["email"];
  
  await authStorage.upsertUser({
    id: userId,
    email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
  
  // Process any pending invitations for this email
  if (email) {
    await authStorage.processInvitations(userId, email);
  }
  
  // Auto-assign new users to default tenant if they don't have any tenant assignment
  await authStorage.ensureDefaultTenantAssignment(userId);
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    // Tillåt anropare (t.ex. HTML-fallback för iframe) att skicka med
    // ?returnTo=/nån-sida så användaren hamnar tillbaka rätt efter login.
    // Vi accepterar bara same-origin-paths för att undvika open redirect.
    const rawReturnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : null;
    if (rawReturnTo && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")) {
      (req.session as any).returnTo = rawReturnTo;
    }
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, (err: any, user: any) => {
      if (err || !user) {
        void logLoginEvent({
          req,
          method: "replit",
          outcome: "failed",
          reason: err ? "callback_error" : "no_user",
          extra: err ? { error: String(err?.message ?? err) } : undefined,
        });
        return res.redirect("/api/login");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          void logLoginEvent({
            req,
            method: "replit",
            outcome: "failed",
            reason: "session_login_error",
            extra: { error: String(loginErr?.message ?? loginErr) },
          });
          return next(loginErr);
        }
        const claims = (user as any)?.claims ?? {};
        void logLoginEvent({
          req,
          method: "replit",
          outcome: "success",
          userId: claims.sub ?? null,
          email: claims.email ?? null,
        });
        const returnTo = (req.session as any)?.returnTo || "/?login=1";
        delete (req.session as any)?.returnTo;
        return res.redirect(returnTo);
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};

/**
 * HTML-variant av `isAuthenticated` för Express-routes som serverar
 * server-renderad HTML direkt till webben (t.ex. `/planner/map`-iframen).
 *
 * Skillnaden mot `isAuthenticated`: vid 401 skickas aldrig rått JSON
 * (`{"message":"Unauthorized"}`) eftersom det då hamnar som synlig text
 * inuti iframen. Istället renderas en liten svensk fallback-sida med en
 * knapp som öppnar `/api/login?returnTo=...` i topp-fönstret, så att
 * OIDC-redirecten kan ske utan att brytas av iframens sandbox. Sidan
 * skickar även `postMessage({type:"traivo:session-expired"})` till
 * `window.parent` så att värd-vyn kan reagera (t.ex. ladda om iframen
 * efter lyckad återinloggning).
 *
 * `returnTo` defaultar till request-URL:en men kan överstyras till den
 * yttre sid-pathen (`/planner-map`) för iframe-fall.
 */
export function isAuthenticatedHtml(options?: { returnTo?: string }): RequestHandler {
  return async (req, res, next) => {
    const user = req.user as any;
    const explicitReturnTo = options?.returnTo;
    const rawReturnTo = explicitReturnTo ?? req.originalUrl ?? "/";
    const safeReturnTo = rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : "/";

    const renderUnauthorized = () => {
      res.status(401)
        .type("text/html; charset=utf-8")
        .set("Cache-Control", "no-store");
      res.send(renderSessionExpiredHtml(safeReturnTo));
    };

    if (!req.isAuthenticated() || !user?.expires_at) {
      return renderUnauthorized();
    }

    const now = Math.floor(Date.now() / 1000);
    if (now <= user.expires_at) {
      return next();
    }

    const refreshToken = user.refresh_token;
    if (!refreshToken) {
      return renderUnauthorized();
    }

    try {
      const config = await getOidcConfig();
      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
      updateUserSession(user, tokenResponse);
      return next();
    } catch (error) {
      return renderUnauthorized();
    }
  };
}

function renderSessionExpiredHtml(returnTo: string): string {
  const loginHref = `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sessionen har gått ut</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    background: #E8F4F8;
    color: #1B4B6B;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1f24; color: #E8F4F8; }
    .card { background: #2C3E50; color: #E8F4F8; }
    .muted { color: #B6C5D1; }
  }
  .card {
    background: #ffffff;
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    box-shadow: 0 8px 24px rgba(27,75,107,0.15);
    text-align: center;
  }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 20px; line-height: 1.5; }
  .muted { color: #6B7C8C; font-size: 14px; }
  a.btn, button.btn {
    display: inline-block;
    background: #1B4B6B;
    color: #ffffff;
    text-decoration: none;
    padding: 10px 18px;
    border-radius: 8px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
    font-size: 14px;
  }
  a.btn:hover, button.btn:hover { background: #15405c; }
</style>
</head>
<body>
  <main class="card" role="alert">
    <h1>Sessionen har gått ut</h1>
    <p class="muted">Du behöver logga in igen för att se den här vyn.</p>
    <button type="button" class="btn" id="login-btn" data-testid="button-relogin">Logga in igen</button>
  </main>
  <script>
    (function () {
      var loginHref = ${JSON.stringify(loginHref)};
      var returnTo = ${JSON.stringify(safeReturnToForJs(returnTo))};
      // Meddela ev. förälder (iframe-värd) att sessionen har gått ut,
      // så att värd-vyn kan visa egen UI eller ladda om efter login.
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "traivo:session-expired", returnTo: returnTo }, "*");
        }
      } catch (e) { /* ignore */ }

      function go() {
        try {
          // Bryt ut ur iframen om vi är inbäddade — annars går OIDC-redirecten
          // sönder pga frame-restriktioner.
          if (window.top && window.top !== window.self) {
            window.top.location.href = loginHref;
            return;
          }
        } catch (e) {
          // Cross-origin parent: faller tillbaka på att försöka top-navigera
          try { window.top.location.href = loginHref; return; } catch (_) {}
        }
        window.location.href = loginHref;
      }
      var btn = document.getElementById("login-btn");
      if (btn) btn.addEventListener("click", go);
    })();
  </script>
</body>
</html>`;
}

function safeReturnToForJs(returnTo: string): string {
  // Bara same-origin-path tillåten — extra säkerhetsnät om någon framtida
  // anropare missar valideringen i `isAuthenticatedHtml`.
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  return returnTo;
}
