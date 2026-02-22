import { Router } from 'express';
import { pool } from '../db';

const router = Router();

router.get('/drivers/locations', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        driver_id as "driverId",
        driver_name as "driverName",
        vehicle_reg_no as "vehicleRegNo",
        latitude,
        longitude,
        speed,
        heading,
        accuracy,
        current_order_id as "currentOrderId",
        current_order_number as "currentOrderNumber",
        status,
        updated_at as "updatedAt"
      FROM driver_locations
      WHERE updated_at > NOW() - INTERVAL '24 hours'
      ORDER BY driver_name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching driver locations:', error);
    res.status(500).json({ error: 'Kunde inte hämta positioner' });
  }
});

export { router as plannerRoutes };
