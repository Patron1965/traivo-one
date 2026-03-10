import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

async function initPushTokensTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        driver_id VARCHAR(255) UNIQUE NOT NULL,
        expo_push_token VARCHAR(255) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('push_tokens table ready');
  } catch (err: any) {
    console.error('Failed to create push_tokens table:', err.message);
  }
}

initPushTokensTable();

async function sendPushNotification(
  driverId: string,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<boolean> {
  try {
    const result = await pool.query(
      'SELECT expo_push_token FROM push_tokens WHERE driver_id = $1',
      [driverId]
    );
    if (result.rows.length === 0) {
      return false;
    }
    const token = result.rows[0].expo_push_token;

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        sound: 'default',
        title,
        body,
        data: data || {},
      }),
    });

    const responseData = await response.json();

    if (responseData?.data?.status === 'error') {
      const details = responseData.data.details;
      if (details?.error === 'DeviceNotRegistered' || details?.error === 'InvalidCredentials') {
        await pool.query('DELETE FROM push_tokens WHERE driver_id = $1', [driverId]);
        console.log(`Removed invalid push token for driver ${driverId}`);
      }
      return false;
    }

    return true;
  } catch (err: any) {
    console.error(`Push notification error for driver ${driverId}:`, err.message);
    return false;
  }
}

export { pool, sendPushNotification };
