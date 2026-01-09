import crypto from "crypto";
import { storage } from "./storage";

const TOKEN_EXPIRY_MINUTES = 15;
const SESSION_EXPIRY_DAYS = 30;

export function generateSecureToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export async function requestMagicLink(
  email: string,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ success: boolean; error?: string; token?: string; customer?: any }> {
  const customer = await storage.getCustomerByEmail(email, tenantId);
  
  if (!customer) {
    return { success: false, error: "Ingen kund hittades med denna e-postadress" };
  }

  const { token, hash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await storage.createPortalToken({
    tenantId,
    customerId: customer.id,
    tokenHash: hash,
    email,
    expiresAt,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });

  return { success: true, token, customer };
}

export async function verifyMagicLink(
  token: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ success: boolean; error?: string; session?: { token: string; customer: any; tenant: any } }> {
  const tokenHash = hashToken(token);
  const portalToken = await storage.getPortalTokenByHash(tokenHash);

  if (!portalToken) {
    return { success: false, error: "Ogiltig eller utgången länk" };
  }

  if (portalToken.usedAt) {
    return { success: false, error: "Denna länk har redan använts" };
  }

  if (new Date() > portalToken.expiresAt) {
    return { success: false, error: "Länken har gått ut. Begär en ny inloggningslänk." };
  }

  await storage.markPortalTokenUsed(portalToken.id);

  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await storage.createPortalSession({
    tenantId: portalToken.tenantId,
    customerId: portalToken.customerId,
    sessionToken,
    expiresAt,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });

  const customer = await storage.getCustomer(portalToken.customerId);
  const tenant = await storage.getTenant(portalToken.tenantId);

  return {
    success: true,
    session: {
      token: sessionToken,
      customer,
      tenant,
    },
  };
}

export async function validateSession(sessionToken: string): Promise<{
  valid: boolean;
  customerId?: string;
  tenantId?: string;
  customer?: any;
}> {
  const session = await storage.getPortalSessionByToken(sessionToken);

  if (!session) {
    return { valid: false };
  }

  if (new Date() > session.expiresAt) {
    await storage.deletePortalSession(session.id);
    return { valid: false };
  }

  await storage.updatePortalSessionAccess(session.id);
  const customer = await storage.getCustomer(session.customerId);

  return {
    valid: true,
    customerId: session.customerId,
    tenantId: session.tenantId,
    customer,
  };
}

export async function logout(sessionToken: string): Promise<void> {
  const session = await storage.getPortalSessionByToken(sessionToken);
  if (session) {
    await storage.deletePortalSession(session.id);
  }
}

export async function sendPortalMagicLinkEmail(
  email: string,
  magicLinkUrl: string,
  customerName: string,
  companyName: string
): Promise<boolean> {
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "noreply@unicorn.se",
      to: email,
      subject: `Logga in på kundportalen - ${companyName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
  <div style="background-color: white; border-radius: 8px; padding: 32px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h1 style="color: #1a1a1a; margin-top: 0; font-size: 24px;">Hej ${customerName}!</h1>
    
    <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
      Du har begärt att logga in på kundportalen hos <strong>${companyName}</strong>.
    </p>
    
    <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">
      Klicka på knappen nedan för att logga in:
    </p>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${magicLinkUrl}" 
         style="background-color: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; display: inline-block;">
        Logga in på kundportalen
      </a>
    </div>
    
    <p style="color: #6b6b6b; font-size: 14px; line-height: 1.5;">
      Denna länk är giltig i 15 minuter och kan endast användas en gång.
    </p>
    
    <p style="color: #6b6b6b; font-size: 14px; line-height: 1.5;">
      Om du inte begärde denna inloggning kan du ignorera detta meddelande.
    </p>
    
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
    
    <p style="color: #9a9a9a; font-size: 12px; margin-bottom: 0;">
      Detta meddelande skickades från ${companyName} via Unicorn-plattformen.
    </p>
  </div>
</body>
</html>
      `,
    });

    return !!result.data?.id;
  } catch (error) {
    console.error("Failed to send portal magic link email:", error);
    return false;
  }
}
