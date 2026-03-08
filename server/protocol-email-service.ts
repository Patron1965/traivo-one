import { Resend } from 'resend';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import {
  Protocol,
  PROTOCOL_TYPE_LABELS,
  type WorkOrder,
  type ServiceObject,
  type Customer,
  type Tenant,
} from '@shared/schema';
import { generateProtocolPdf } from './protocol-pdf-generator';

interface ProtocolContext {
  workOrder?: WorkOrder | null;
  object?: ServiceObject | null;
  customer?: Customer | null;
  tenant?: Tenant | null;
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendProtocolToCustomer(
  protocol: Protocol,
  context: ProtocolContext
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    if (!context.customer?.email) {
      throw new Error('Customer has no email address');
    }

    const protocolTypeLabel = PROTOCOL_TYPE_LABELS[protocol.protocolType as keyof typeof PROTOCOL_TYPE_LABELS] || protocol.protocolType;
    const executedDate = protocol.executedAt 
      ? format(new Date(protocol.executedAt), 'PPP', { locale: sv })
      : 'Okänt datum';

    const pdfBuffer = await generateProtocolPdf(protocol, context);
    const pdfBase64 = pdfBuffer.toString('base64');
    
    const fromName = context.tenant?.name || 'Nordfield Fältservice';
    const fromEmail = 'protokoll@resend.dev'; // In production, use verified domain

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2962ff 0%, #1e88e5 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 10px 0 0; opacity: 0.9; }
    .content { background: #f5f5f5; padding: 30px; }
    .info-box { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .info-row { display: flex; margin-bottom: 10px; }
    .info-label { font-weight: 600; width: 120px; color: #666; }
    .info-value { flex: 1; }
    .cta-section { text-align: center; padding: 20px 0; }
    .cta-button { display: inline-block; background: #2962ff; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${protocolTypeLabel}</h1>
      <p>${executedDate}</p>
    </div>
    
    <div class="content">
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Objekt:</span>
          <span class="info-value">${context.object?.name || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Adress:</span>
          <span class="info-value">${context.object?.address || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Utfört av:</span>
          <span class="info-value">${protocol.executedByName || '-'}</span>
        </div>
        ${protocol.totalDurationMinutes ? `
        <div class="info-row">
          <span class="info-label">Total tid:</span>
          <span class="info-value">${Math.floor(protocol.totalDurationMinutes / 60)}h ${protocol.totalDurationMinutes % 60}min</span>
        </div>
        ` : ''}
      </div>
      
      ${protocol.workDescription ? `
      <div class="info-box">
        <h3 style="margin-top: 0; color: #333;">Utfört arbete</h3>
        <p style="margin-bottom: 0;">${protocol.workDescription}</p>
      </div>
      ` : ''}
      
      <div class="cta-section">
        <p style="margin-bottom: 15px; color: #666;">Fullständigt protokoll bifogat som PDF</p>
      </div>
    </div>
    
    <div class="footer">
      <p>Detta är ett automatiskt meddelande från ${fromName}</p>
      <p>Har du frågor? Kontakta oss gärna.</p>
    </div>
  </div>
</body>
</html>
    `;

    const result = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: context.customer.email,
      subject: `${protocolTypeLabel} - ${context.object?.name || 'Besök'} - ${executedDate}`,
      html: emailHtml,
      attachments: [
        {
          filename: `protokoll-${protocol.protocolNumber || protocol.id.substring(0, 8)}.pdf`,
          content: pdfBase64,
        },
      ],
    });

    console.log(`[protocol-email] Sent protocol ${protocol.id} to ${context.customer.email}`);
    
    return {
      success: true,
      messageId: result.data?.id,
    };
  } catch (error) {
    console.error('[protocol-email] Failed to send protocol email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function sendDeviationReportToCustomer(
  deviation: {
    title: string;
    category: string;
    description?: string | null;
    severityLevel: string;
    suggestedAction?: string | null;
    reportedAt: Date;
    reportedByName?: string | null;
    photos?: string[] | null;
  },
  context: ProtocolContext,
  recipientEmail: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const fromName = context.tenant?.name || 'Nordfield Fältservice';
    const fromEmail = 'avvikelse@resend.dev';
    
    const reportedDate = format(new Date(deviation.reportedAt), 'PPP', { locale: sv });
    
    const severityColors: Record<string, string> = {
      low: '#4caf50',
      medium: '#ff9800',
      high: '#f44336',
      critical: '#9c27b0',
    };
    
    const severityLabels: Record<string, string> = {
      low: 'Låg',
      medium: 'Medel',
      high: 'Hög',
      critical: 'Kritisk',
    };

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #f44336 0%, #e53935 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .severity-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; background: ${severityColors[deviation.severityLevel] || '#666'}; font-size: 12px; font-weight: 600; margin-top: 10px; }
    .content { background: #f5f5f5; padding: 30px; }
    .info-box { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .info-row { margin-bottom: 12px; }
    .info-label { font-weight: 600; color: #666; display: block; margin-bottom: 4px; }
    .info-value { color: #333; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Avvikelserapport</h1>
      <span class="severity-badge">${severityLabels[deviation.severityLevel] || deviation.severityLevel}</span>
    </div>
    
    <div class="content">
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Titel</span>
          <span class="info-value">${deviation.title}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Objekt</span>
          <span class="info-value">${context.object?.name || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Adress</span>
          <span class="info-value">${context.object?.address || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Rapporterat</span>
          <span class="info-value">${reportedDate} av ${deviation.reportedByName || 'Okänd'}</span>
        </div>
      </div>
      
      ${deviation.description ? `
      <div class="info-box">
        <span class="info-label">Beskrivning</span>
        <p style="margin-bottom: 0;">${deviation.description}</p>
      </div>
      ` : ''}
      
      ${deviation.suggestedAction ? `
      <div class="info-box">
        <span class="info-label">Föreslagen åtgärd</span>
        <p style="margin-bottom: 0;">${deviation.suggestedAction}</p>
      </div>
      ` : ''}
    </div>
    
    <div class="footer">
      <p>Detta är ett automatiskt meddelande från ${fromName}</p>
    </div>
  </div>
</body>
</html>
    `;

    const result = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: recipientEmail,
      subject: `Avvikelse rapporterad: ${deviation.title} - ${context.object?.name || 'Objekt'}`,
      html: emailHtml,
    });

    console.log(`[protocol-email] Sent deviation report to ${recipientEmail}`);
    
    return {
      success: true,
      messageId: result.data?.id,
    };
  } catch (error) {
    console.error('[protocol-email] Failed to send deviation report email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
