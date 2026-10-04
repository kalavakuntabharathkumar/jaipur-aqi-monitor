# JaipurAir: Hyperlocal AQI Monitor & Alert System

Real-time air quality dashboard for Jaipur polling the Central Pollution Control Board (CPCB) public API across 8 monitoring stations, with a Python ML microservice predicting PM2.5 trends one hour ahead.

## Architecture

- **Node.js Express Backend** — Polls CPCB API every 15 minutes with exponential backoff retry logic, stores readings in SQLite
- **Python FastAPI Microservice** — Serves linear regression predictions on a 45-day rolling window for each station
- **Vanilla JavaScript Dashboard** — Real-time Chart.js visualizations with WebSocket updates and threshold-based alerts

## Data Sources

- **CPCB AQI API** (`api.cpcb.gov.in`) — Real-time station readings for PM2.5, PM10, NO2, SO2, CO, O3
- **OpenWeatherMap API** — Weather correlation data (temperature, humidity, wind speed) for prediction features

## Tech Stack

- Node.js + Express (scheduler & API gateway)
- Python + FastAPI (ML microservice)
- SQLite (local storage)
- Chart.js (frontend charts)
- Vanilla JS + WebSocket (real-time updates)

## Prerequisites

- Node.js 18+
- Python 3.10+
- OpenWeatherMap API key (free tier at openweathermap.org)

## Setup

```bash
# 1. Clone and install Node dependencies
npm install

# 2. Set up Python virtual environment and dependencies
cd python
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your OpenWeatherMap API key

# 4. Initialize database
npm run db:init

# 5. Start all services (uses concurrently)
npm run dev
```

The dashboard will be available at `http://localhost:3000`.
The FastAPI microservice runs at `http://localhost:8000` (docs at `/docs`).

## Project Structure

```
jaipur-aqi-monitor/
├── server.js              # Express backend + scheduler
├── package.json           # Node dependencies
├── .env.example           # Environment template
├── database/
│   └── schema.sql         # SQLite schema
├── python/
│   ├── main.py            # FastAPI app
│   ├── ml_model.py        # Linear regression model
│   └── requirements.txt   # Python dependencies
└── public/
    ├── index.html         # Dashboard HTML
    ├── app.js             # Frontend logic + WebSocket
    └── styles.css         # Styling
```

## API Endpoints

### Express (port 3000)
- `GET /api/stations` — List all 8 Jaipur stations
- `GET /api/readings/:stationId` — Latest readings for a station
- `GET /api/history/:stationId` — Historical readings (query: `hours=24`)
- `GET /api/predictions/:stationId` — Latest PM2.5 prediction from ML service
- `WS /ws` — WebSocket for real-time updates

### FastAPI (port 8000)
- `GET /predict/:station_id` — Next-hour PM2.5 prediction
- `POST /train/:station_id` — Retrain model on latest 45-day window
- `GET /health` — Health check

## Scheduler & Retry Logic

The Express backend runs a cron-like scheduler using `node-cron` polling CPCB every 15 minutes. On failure, it retries with exponential backoff (1min, 2min, 4min, 8min, max 15min) up to 5 attempts before logging and waiting for the next cycle.

## ML Model Details

- **Algorithm**: Scikit-learn LinearRegression
- **Features**: PM2.5 (lag 1-24h), PM10, NO2, temperature, humidity, wind speed, hour of day, day of week
- **Window**: 45 days rolling training data
- **Target**: PM2.5 at t+1 hour
- **Performance**: ~12 µg/m³ MAE on 60-day backtest

## Alerts

Configure thresholds in `.env`:
- `PM25_WARNING=60` — Warning threshold (µg/m³)
- `PM25_DANGEROUS=120` — Dangerous threshold (µg/m³)

Alerts trigger via WebSocket to connected clients. SMS/email integration points are stubbed in `server.js` (Twilio/SendGrid).

## License

MIT
