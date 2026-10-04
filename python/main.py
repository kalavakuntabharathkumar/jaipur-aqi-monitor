from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sqlite3
import pandas as pd
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

from ml_model import AQIPredictor

load_dotenv()

app = FastAPI(title="Jaipur AQI Prediction Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.getenv('DB_PATH', '../aqi.db')
WINDOW_DAYS = 45
RETRAIN_INTERVAL_HOURS = 6

predictors = {}
last_trained = {}

JAIPUR_STATIONS = [
    'RJ001', 'RJ002', 'RJ003', 'RJ004',
    'RJ005', 'RJ006', 'RJ007', 'RJ008'
]

class PredictionResponse(BaseModel):
    station_id: str
    timestamp: str
    predicted_pm25: float
    mae: Optional[float] = None

class TrainResponse(BaseModel):
    station_id: str
    status: str
    mae: float
    samples: int


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_training_data(station_id: str, days: int = WINDOW_DAYS) -> pd.DataFrame:
    """Fetch last N days of readings for training."""
    conn = get_db_connection()
    since = (datetime.now() - timedelta(days=days)).isoformat()
    query = """
        SELECT timestamp, pm25, pm10, no2, so2, co, o3, aqi
        FROM readings
        WHERE station_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
    """
    df = pd.read_sql_query(query, conn, params=(station_id, since))
    conn.close()
    
    if df.empty:
        return df
    
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.set_index('timestamp').resample('1H').mean().interpolate()
    return df


def get_or_create_predictor(station_id: str) -> AQIPredictor:
    """Get or create predictor for a station."""
    if station_id not in predictors:
        predictors[station_id] = AQIPredictor()
    return predictors[station_id]


def should_retrain(station_id: str) -> bool:
    """Check if model needs retraining."""
    if station_id not in last_trained:
        return True
    elapsed = datetime.now() - last_trained[station_id]
    return elapsed > timedelta(hours=RETRAIN_INTERVAL_HOURS)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "aqi-prediction", "timestamp": datetime.now().isoformat()}


@app.get("/predict/{station_id}", response_model=PredictionResponse)
async def predict(station_id: str):
    """Get next-hour PM2.5 prediction for a station."""
    if station_id not in JAIPUR_STATIONS:
        raise HTTPException(status_code=404, detail="Station not found")
    
    predictor = get_or_create_predictor(station_id)
    
    # Retrain if needed
    if should_retrain(station_id) or not predictor.is_trained:
        df = fetch_training_data(station_id)
        if len(df) < 100:  # Minimum samples for training
            raise HTTPException(status_code=503, detail="Insufficient training data")
        mae = predictor.train(df)
        last_trained[station_id] = datetime.now()
    
    # Get latest data for prediction
    df = fetch_training_data(station_id, days=2)
    if df.empty:
        raise HTTPException(status_code=503, detail="No recent data for prediction")
    
    predicted_pm25 = predictor.predict_next_hour(df)
    
    response = PredictionResponse(
        station_id=station_id,
        timestamp=(datetime.now() + timedelta(hours=1)).isoformat(),
        predicted_pm25=round(predicted_pm25, 2),
        mae=predictor.mae
    )
    
    # Store prediction in SQLite
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO predictions (station_id, timestamp, predicted_pm25, model_mae) VALUES (?, ?, ?, ?)",
        (station_id, response.timestamp, response.predicted_pm25, response.mae)
    )
    conn.commit()
    conn.close()
    
    return response


@app.post("/train/{station_id}", response_model=TrainResponse)
async def train_model(station_id: str, background_tasks: BackgroundTasks):
    """Manually trigger model retraining."""
    if station_id not in JAIPUR_STATIONS:
        raise HTTPException(status_code=404, detail="Station not found")
    
    df = fetch_training_data(station_id)
    if len(df) < 100:
        raise HTTPException(status_code=400, detail=f"Insufficient data: {len(df)} samples (need 100+)")
    
    predictor = get_or_create_predictor(station_id)
    mae = predictor.train(df)
    last_trained[station_id] = datetime.now()
    
    return TrainResponse(
        station_id=station_id,
        status="trained",
        mae=round(mae, 2),
        samples=len(df)
    )


@app.get("/stations")
async def list_stations():
    return {"stations": JAIPUR_STATIONS}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
