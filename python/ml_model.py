"""Linear regression model for PM2.5 prediction."""

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit
import joblib
import os

class AQIPredictor:
    """PM2.5 predictor using linear regression with time-series features."""
    
    def __init__(self):
        self.model = LinearRegression()
        self.is_trained = False
        self.mae = None
        self.feature_names = []
    
    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create lag features and time features for training."""
        df = df.copy()
        
        # Lag features for PM2.5 (1-24 hours)
        for lag in [1, 2, 3, 4, 6, 12, 24]:
            df[f'pm25_lag_{lag}'] = df['pm25'].shift(lag)
        
        # Lag features for other pollutants
        for pollutant in ['pm10', 'no2', 'so2', 'co', 'o3']:
            if pollutant in df.columns:
                df[f'{pollutant}_lag_1'] = df[pollutant].shift(1)
                df[f'{pollutant}_lag_3'] = df[pollutant].shift(3)
        
        # Time features
        df['hour'] = df.index.hour
        df['day_of_week'] = df.index.dayofweek
        df['is_weekend'] = (df.index.dayofweek >= 5).astype(int)
        df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
        df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
        
        # Rolling statistics
        df['pm25_rolling_3h_mean'] = df['pm25'].rolling(3).mean().shift(1)
        df['pm25_rolling_6h_mean'] = df['pm25'].rolling(6).mean().shift(1)
        df['pm25_rolling_24h_mean'] = df['pm25'].rolling(24).mean().shift(1)
        df['pm25_rolling_3h_std'] = df['pm25'].rolling(3).std().shift(1)
        
        # Target: PM2.5 at next hour
        df['target_pm25'] = df['pm25'].shift(-1)
        
        return df
    
    def prepare_training_data(self, df: pd.DataFrame):
        """Prepare X, y for training."""
        df_feat = self.create_features(df)
        
        # Drop rows with NaN (from lagging/rolling)
        df_feat = df_feat.dropna()
        
        if len(df_feat) < 50:
            raise ValueError(f"Not enough samples after feature creation: {len(df_feat)}")
        
        # Select features (exclude target and raw pollutants to avoid leakage)
        exclude_cols = ['target_pm25', 'pm25', 'pm10', 'no2', 'so2', 'co', 'o3', 'aqi']
        feature_cols = [c for c in df_feat.columns if c not in exclude_cols]
        
        X = df_feat[feature_cols]
        y = df_feat['target_pm25']
        
        self.feature_names = feature_cols
        return X, y
    
    def train(self, df: pd.DataFrame) -> float:
        """Train the model on historical data."""
        X, y = self.prepare_training_data(df)
        
        # Time series cross-validation for robust MAE estimate
        tscv = TimeSeriesSplit(n_splits=5)
        maes = []
        
        for train_idx, val_idx in tscv.split(X):
            X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
            
            model = LinearRegression()
            model.fit(X_train, y_train)
            preds = model.predict(X_val)
            maes.append(mean_absolute_error(y_val, preds))
        
        # Train final model on all data
        self.model.fit(X, y)
        self.is_trained = True
        self.mae = np.mean(maes)
        
        return self.mae
    
    def predict_next_hour(self, df: pd.DataFrame) -> float:
        """Predict PM2.5 for the next hour."""
        if not self.is_trained:
            raise RuntimeError("Model not trained")
        
        df_feat = self.create_features(df)
        latest = df_feat.iloc[[-1]][self.feature_names]
        
        if latest.isna().any().any():
            # Fallback: use simple persistence if features have NaN
            return df['pm25'].iloc[-1]
        
        prediction = self.model.predict(latest)[0]
        return max(0, prediction)  # PM2.5 cannot be negative
    
    def save(self, path: str):
        """Save model to disk."""
        joblib.dump({
            'model': self.model,
            'feature_names': self.feature_names,
            'mae': self.mae,
            'is_trained': self.is_trained
        }, path)
    
    def load(self, path: str):
        """Load model from disk."""
        if not os.path.exists(path):
            return False
        data = joblib.load(path)
        self.model = data['model']
        self.feature_names = data['feature_names']
        self.mae = data['mae']
        self.is_trained = data['is_trained']
        return True
