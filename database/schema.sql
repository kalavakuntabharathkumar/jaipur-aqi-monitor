-- SQLite schema for AQI readings and predictions

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  pm25 REAL,
  pm10 REAL,
  no2 REAL,
  so2 REAL,
  co REAL,
  o3 REAL,
  aqi INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE INDEX IF NOT EXISTS idx_readings_station_time ON readings(station_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  predicted_pm25 REAL NOT NULL,
  model_mae REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_station_time ON predictions(station_id, timestamp DESC);

-- Insert Jaipur stations
INSERT OR IGNORE INTO stations (id, name, latitude, longitude) VALUES
  ('RJ001', 'Adarsh Nagar', 26.9247, 75.8034),
  ('RJ002', 'Jawahar Nagar', 26.8992, 75.8098),
  ('RJ003', 'Police Commissionerate', 26.9124, 75.7873),
  ('RJ004', 'Shastri Nagar', 26.9078, 75.8012),
  ('RJ005', 'Vidyadhar Nagar', 26.9431, 75.7894),
  ('RJ006', 'Mansarovar', 26.8521, 75.7689),
  ('RJ007', 'Sitapura', 26.8012, 75.8034),
  ('RJ008', 'Chandpole', 26.9234, 75.7892);
