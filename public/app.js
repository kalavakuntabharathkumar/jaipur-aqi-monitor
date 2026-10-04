// JaipurAir Dashboard - Vanilla JS with WebSocket

class JaipurAirDashboard {
  constructor() {
    this.ws = null;
    this.currentStation = null;
    this.stations = [];
    this.pm25Chart = null;
    this.multiChart = null;
    this.historyData = [];
    this.maxHistoryPoints = 24; // 24 hours
    
    this.init();
  }

  async init() {
    try {
      await this.fetchStations();
      this.setupWebSocket();
      this.setupEventListeners();
      
      // Load first station by default
      if (this.stations.length > 0) {
        this.selectStation(this.stations[0].id);
      }
    } catch (error) {
      console.error('Dashboard init failed:', error);
      this.showError('Failed to initialize dashboard');
    }
  }

  async fetchStations() {
    const response = await fetch('/api/stations');
    if (!response.ok) throw new Error('Failed to fetch stations');
    this.stations = await response.json();
    this.populateStationSelect();
  }

  populateStationSelect() {
    const select = document.getElementById('station-select');
    select.innerHTML = this.stations.map(s => 
      `<option value="${s.id}">${s.name} (${s.id})</option>`
    ).join('');
  }

  setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.updateWSStatus(true);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 5s...');
      this.updateWSStatus(false);
      setTimeout(() => this.setupWebSocket(), 5000);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleWSMessage(message);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };
  }

  updateWSStatus(connected) {
    const el = document.getElementById('ws-status');
    el.textContent = connected ? '● Live' : '● Disconnected';
    el.className = 'status ' + (connected ? 'online' : 'offline');
  }

  handleWSMessage(message) {
    switch (message.type) {
      case 'reading':
        if (message.stationId === this.currentStation) {
          this.updateCurrentReadings(message.data);
          this.addToHistory(message.data);
          this.updateCharts();
        }
        break;
      case 'alert':
        this.showAlert(message);
        break;
    }
    this.updateLastUpdateTime();
  }

  setupEventListeners() {
    document.getElementById('station-select').addEventListener('change', (e) => {
      this.selectStation(e.target.value);
    });
  }

  async selectStation(stationId) {
    this.currentStation = stationId;
    document.getElementById('station-select').value = stationId;
    
    try {
      const [reading, history, prediction] = await Promise.all([
        fetch(`/api/readings/${stationId}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/history/${stationId}?hours=24`).then(r => r.ok ? r.json() : []),
        fetch(`/api/predictions/${stationId}`).then(r => r.ok ? r.json() : null)
      ]);
      
      if (reading) this.updateCurrentReadings(reading);
      if (history) {
        this.historyData = history;
        this.updateCharts();
      }
      if (prediction) this.updatePrediction(prediction);
      
    } catch (error) {
      console.error('Failed to load station data:', error);
    }
  }

  updateCurrentReadings(data) {
    // AQI
    document.getElementById('aqi-value').textContent = data.aqi || '—';
    const aqiCategory = document.getElementById('aqi-category');
    aqiCategory.textContent = this.getAQICategory(data.aqi);
    aqiCategory.className = 'aqi-category ' + this.getAQIClass(data.aqi);
    
    // Pollutants
    const pollutants = {
      pm25: data.pm25,
      pm10: data.pm10,
      no2: data.no2,
      so2: data.so2,
      co: data.co,
      o3: data.o3
    };
    
    Object.entries(pollutants).forEach(([key, value]) => {
      const el = document.getElementById(`${key}-value`);
      if (el) el.textContent = value !== null ? value.toFixed(1) : '—';
    });
  }

  updatePrediction(prediction) {
    const el = document.getElementById('pm25-prediction');
    if (!prediction || !prediction.predicted_pm25) {
      el.textContent = 'Prediction unavailable';
      el.className = 'prediction';
      return;
    }
    
    const predicted = prediction.predicted_pm25;
    el.textContent = `Next hour: ${predicted.toFixed(1)} µg/m³`;
    el.className = 'prediction';
    
    if (predicted >= 120) el.classList.add('danger');
    else if (predicted >= 60) el.classList.add('warning');
  }

  addToHistory(reading) {
    const point = {
      time: new Date(reading.timestamp),
      pm25: reading.pm25,
      pm10: reading.pm10,
      no2: reading.no2,
      so2: reading.so2,
      co: reading.co,
      o3: reading.o3
    };
    
    this.historyData.push(point);
    
    // Keep only last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.historyData = this.historyData.filter(p => p.time > cutoff);
  }

  updateCharts() {
    if (this.historyData.length === 0) return;
    
    const labels = this.historyData.map(d => d.time.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}));
    
    // PM2.5 Chart
    const pm25Data = this.historyData.map(d => d.pm25);
    this.updateChart('pm25-chart', labels, pm25Data, 'PM2.5 (µg/m³)', '#e74c3c');
    
    // Multi-pollutant Chart
    const datasets = [
      { label: 'PM2.5', data: this.historyData.map(d => d.pm25), borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', yAxisID: 'y' },
      { label: 'PM10', data: this.historyData.map(d => d.pm10), borderColor: '#f39c12', backgroundColor: 'rgba(243,156,18,0.1)', yAxisID: 'y' },
      { label: 'NO₂', data: this.historyData.map(d => d.no2), borderColor: '#3498db', backgroundColor: 'rgba(52,152,219,0.1)', yAxisID: 'y1' },
      { label: 'SO₂', data: this.historyData.map(d => d.so2), borderColor: '#9b59b6', backgroundColor: 'rgba(155,89,182,0.1)', yAxisID: 'y1' },
      { label: 'O₃', data: this.historyData.map(d => d.o3), borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,0.1)', yAxisID: 'y1' }
    ].filter(d => d.data.some(v => v !== null && v !== undefined));
    
    this.updateMultiChart('multi-chart', labels, datasets);
  }

  updateChart(canvasId, labels, data, label, color) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (this.pm25Chart && canvasId === 'pm25-chart') {
      this.pm25Chart.data.labels = labels;
      this.pm25Chart.data.datasets[0].data = data;
      this.pm25Chart.update('none');
      return;
    }
    
    this.pm25Chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: color + '20',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: this.getChartOptions('PM2.5 Concentration')
    });
  }

  updateMultiChart(canvasId, labels, datasets) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (this.multiChart) {
      this.multiChart.data.labels = labels;
      this.multiChart.data.datasets.forEach((ds, i) => {
        ds.data = datasets[i]?.data || [];
      });
      this.multiChart.update('none');
      return;
    }
    
    this.multiChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...this.getChartOptions('Pollutant Concentrations'),
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { display: true, grid: { display: false } },
          y: { type: 'linear', position: 'left', title: { display: true, text: 'PM (µg/m³)' } },
          y1: { type: 'linear', position: 'right', title: { display: true, text: 'Gas (µg/m³)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  getChartOptions(title) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: false },
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.8)',
          padding: 12,
          titleFont: { size: 13 },
          bodyFont: { size: 12 }
        }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { maxTicksLimit: 12, font: { size: 10 } }
        },
        y: {
          display: true,
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          title: { display: true, text: 'µg/m³', font: { size: 11 } },
          ticks: { font: { size: 10 } }
        }
      },
      animation: { duration: 300 }
    };
  }

  showAlert(alert) {
    const container = document.getElementById('alerts-list');
    const alertEl = document.createElement('div');
    alertEl.className = `alert-item ${alert.level}`;
    
    const icons = { warning: '⚠️', dangerous: '🚨' };
    const titles = { warning: 'Air Quality Warning', dangerous: 'Dangerous Air Quality' };
    
    alertEl.innerHTML = `
      <span class="alert-icon">${icons[alert.level]}</span>
      <div class="alert-content">
        <div class="alert-title">${titles[alert.level]}</div>
        <div class="alert-message">PM2.5 at ${alert.pm25} µg/m³ — ${alert.level === 'dangerous' ? 'Avoid outdoor activity' : 'Sensitive groups should limit outdoor exertion'}</div>
      </div>
      <span class="alert-time">${new Date().toLocaleTimeString()}</span>
    `;
    
    container.prepend(alertEl);
    
    // Auto-remove after 30 seconds
    setTimeout(() => alertEl.remove(), 30000);
  }

  updateLastUpdateTime() {
    document.getElementById('last-update').textContent = 
      `Last update: ${new Date().toLocaleTimeString()}`;
  }

  getAQICategory(aqi) {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Satisfactory';
    if (aqi <= 200) return 'Moderate';
    if (aqi <= 300) return 'Poor';
    if (aqi <= 400) return 'Very Poor';
    return 'Severe';
  }

  getAQIClass(aqi) {
    if (aqi <= 50) return 'aqi-good';
    if (aqi <= 100) return 'aqi-satisfactory';
    if (aqi <= 200) return 'aqi-moderate';
    if (aqi <= 300) return 'aqi-poor';
    if (aqi <= 400) return 'aqi-very-poor';
    return 'aqi-severe';
  }

  showError(message) {
    document.body.innerHTML = `
      <div class="loading">
        <h2>Error</h2>
        <p>${message}</p>
        <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:var(--secondary);color:white;border:none;border-radius:4px;cursor:pointer;">Retry</button>
      </div>
    `;
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new JaipurAirDashboard();
});
