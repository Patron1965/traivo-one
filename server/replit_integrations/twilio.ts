import Twilio from 'twilio';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=twilio',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.account_sid)) {
    throw new Error('Twilio not connected');
  }
  
  return { 
    accountSid: connectionSettings.settings.account_sid,
    authToken: connectionSettings.settings.auth_token,
    fromNumber: connectionSettings.settings.from_number
  };
}

export async function getUncachableTwilioClient() {
  const credentials = await getCredentials();
  return {
    client: Twilio(credentials.accountSid, credentials.authToken),
    fromNumber: credentials.fromNumber
  };
}

export async function sendSms(options: {
  to: string;
  body: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { client, fromNumber } = await getUncachableTwilioClient();
    
    const result = await client.messages.create({
      from: fromNumber,
      to: options.to,
      body: options.body,
    });
    
    return { 
      success: true, 
      messageId: result.sid 
    };
  } catch (error: any) {
    console.error('[twilio] Failed to send SMS:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to send SMS'
    };
  }
}

export async function isTwilioConfigured(): Promise<boolean> {
  try {
    await getCredentials();
    return true;
  } catch {
    return false;
  }
}
