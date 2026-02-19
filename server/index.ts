import express from 'express';
import cors from 'cors';
import path from 'path';
import { mobileRoutes } from './routes/mobile';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/mobile', mobileRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'driver-core-api' });
});

app.use(express.static(path.join(__dirname, 'templates')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'landing-page.html'));
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Driver Core API running on port ${PORT}`);
});
