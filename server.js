require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const CPCB_API_BASE = 'https://api.cpcb.gov.in/api/v1';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const POLL_INTERVAL_MINUTES = 15;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 60000; // 1 minute

// Jaipur station IDs from CPCB
const JAIPUR_STATIONS = [
  { id: 'RJ001', name: 'Adarsh Nagar', lat: 26.9247, lon: 75.8034 },
  { id: 'RJ002', name: 'Jawahar Nagar', lat: 26.8992, lon: 75.8098 },
  { id: 'RJ003', name: 'Police Commissionerate', lat: 26.9124, lon: 75.7873 },
  { id: 'RJ004', name: 'Shastri Nagar', lat: 26.9078, lon: 75.8012 },
  { id: 'RJ005', name: 'Vidyadhar Nagar', lat: 26.9431, lon: 75.7894 },
  { id: 'RJ006', name: 'Mansarovar', lat: 26.8521, lon: 75.7689 },
  { id: 'RJ007', name: 'Sitapura', lat: 26.8012, lon: 75.8034 },
  { id: 'RJ008', name: 'Chandpole', lat: 26.9234, lon: 75.7892 }
];

const POLLUTANTS = ['PM2.5', 'PM10', 'NO2', 'SO2', 'CO', 'O3'];
const PM25_WARNING = parseInt(process.env.PM25_WARNING) || 60;
const PM25_DANGEROUS = parseInt(process.env.PM25_DANGEROUS) || 120;

// Initialize SQLite database
const db = new Database('aqi.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database helpers ---
function initDatabase() {
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'database/schema.sql'), 'utf8');
  db.exec(schema);
  console.log('Database initialized');
}

function insertReading(stationId, reading) {
  const stmt = db.prepare(`
    INSERT INTO readings (station_id, timestamp, pm25, pm10, no2, so2, co, o3, aqi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    stationId,
    reading.timestamp,
    reading.pm25,
    reading.pm10,
    reading.no2,
    reading.so2,
    reading.co,
    reading.o3,
    reading.aqi
  );
}

function getLatestReadings(stationId, limit = 1) {
  const stmt = db.prepare(`
    SELECT * FROM readings WHERE station_id = ? ORDER BY timestamp DESC LIMIT ?
  `);
  return stmt.all(stationId, limit);
}

function getHistory(stationId, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(`
    SELECT * FROM readings WHERE station_id = ? AND timestamp >= ? ORDER BY timestamp ASC
  `);
  return stmt.all(stationId, since);
}

function insertPrediction(stationId, prediction) {
  const stmt = db.prepare(`
    INSERT INTO predictions (station_id, timestamp, predicted_pm25, model_mae)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(stationId, prediction.timestamp, prediction.predicted_pm25, prediction.mae);
}

function getLatestPrediction(stationId) {
  const stmt = db.prepare(`
    SELECT * FROM predictions WHERE station_id = ? ORDER BY timestamp DESC LIMIT 1
  `);
  return stmt.get(stationId);
}

// --- CPCB API polling with exponential backoff ---
async function fetchCPCBData(stationId, attempt = 1) {
  try {
    const response = await axios.get(`${CPCB_API_BASE}/station/${stationId}/latest`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    return response.data;
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      throw error;
    }
    const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    console.warn(`CPCB fetch failed for ${stationId} (attempt ${attempt}), retrying in ${delay}ms:`, error.message);
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchCPCBData(stationId, attempt + 1);
  }
}

function parseCPCBResponse(stationId, data) {
  // CPCB returns data in a specific format; adapt as needed
  const pollutants = {};
  data.pollutants?.forEach(p => {
    pollutants[p.name] = p.value;
  });
  return {
    timestamp: new Date(data.timestamp || Date.now()).toISOString(),
    pm25: pollutants['PM2.5'] || null,
    pm10: pollutants['PM10'] || null,
    no2: pollutants['NO2'] || null,
    so2: pollutants['SO2'] || null,
    co: pollutants['CO'] || null,
    o3: pollutants['O3'] || null,
    aqi: data.aqi || calculateAQI(pollutants)
  };
}

function calculateAQI(pollutants) {
  // Simplified AQI calculation based on Indian breakpoints
  // In production, use official CPCB formula
  const pm25 = pollutants['PM2.5'] || 0;
  if (pm25 <= 30) return 50;
  if (pm25 <= 60) return 100;
  if (pm25 <= 90) return 200;
  if (pm25 <= 120) return 300;
  if (pm25 <= 250) return 400;
  return 500;
}

async function pollAllStations() {
  console.log(`[${new Date().toISOString()}] Starting CPCB poll cycle for ${JAIPUR_STATIONS.length} stations`);
  
  for (const station of JAIPUR_STATIONS) {
    try {
      const rawData = await fetchCPCBData(station.id);
      const reading = parseCPCBResponse(station.id, rawData);
      insertReading(station.id, reading);
      
      // Fetch prediction from ML service
      try {
        const predResponse = await axios.get(`${ML_SERVICE_URL}/predict/${station.id}`, { timeout: 5000 });
        if (predResponse.data) {
          insertPrediction(station.id, predResponse.data);
        }
      } catch (mlError) {
        console.warn(`ML service unavailable for ${station.id}:`, mlError.message);
      }
      
      // Broadcast to WebSocket clients
      broadcast({
        type: 'reading',
        stationId: station.id,
        stationName: station.name,
        data: reading
      });
      
      // Check alert thresholds
      if (reading.pm25) {
        if (reading.pm25 >= PM25_DANGEROUS) {
          broadcast({ type: 'alert', level: 'dangerous', stationId: station.id, pm25: reading.pm25 });
        } else if (reading.pm25 >= PM25_WARNING) {
          broadcast({ type: 'alert', level: 'warning', stationId: station.id, pm25: reading.pm25 });
        }
      }
      
      console.log(`  ✓ ${station.name}: PM2.5=${reading.pm25}, AQI=${reading.aqi}`);
    } catch (error) {
      console.error(`  ✗ ${station.name} failed after ${MAX_RETRIES} attempts:`, error.message);
    }
  }
  console.log(`[${new Date().toISOString()}] Poll cycle complete`);
}

// --- WebSocket handling ---
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket client disconnected');
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    clients.delete(ws);
  });
});

function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// --- REST API Endpoints ---
app.get('/api/stations', (req, res) => {
  res.json(JAIPUR_STATIONS);
});

app.get('/api/readings/:stationId', (req, res) => {
  const readings = getLatestReadings(req.params.stationId, 1);
  if (readings.length === 0) {
    return res.status(404).json({ error: 'No readings found' });
  }
  res.json(readings[0]);
});

app.get('/api/history/:stationId', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const history = getHistory(req.params.stationId, hours);
  res.json(history);
});

app.get('/api/predictions/:stationId', (req, res) => {
  const prediction = getLatestPrediction(req.params.stationId);
  if (!prediction) {
    return res.status(404).json({ error: 'No prediction available' });
  }
  res.json(prediction);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve dashboard for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Scheduler ---
// Run every 15 minutes
cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, pollAllStations);

// Initial poll on startup
pollAllStations();

// --- Start server ---
server.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
  console.log(`Polling CPCB every ${POLL_INTERVAL_MINUTES} minutes`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close();
  db.close();
  server.close(() => process.exit(0));
});

module.exports = { app, server, pollAllStations, broadcast };
