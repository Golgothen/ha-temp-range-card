class TempRangeCard extends HTMLElement {

  constructor() {
    super();
    this._initialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._render();
    }
  }

  setConfig(config) {
    this._config = config;
  }

  _render() {
    const cfg        = this._config || {};
    const showHeader = cfg.show && cfg.show.title === false ? false : true;
    const title      = cfg.title || 'Outside Temperature Range';

    this.innerHTML = `
      <ha-card>
        ${showHeader ? `<div class="card-header">${title}</div>` : ''}
        <div id="temp-range-chart" style="padding: 8px;"></div>
      </ha-card>
    `;

    if (typeof ApexCharts === 'undefined') {
      this._loadApexCharts(() => this._loadChart());
    } else {
      this._loadChart();
    }
  }

  _loadApexCharts(callback) {
    const localSrc = '/local/apexcharts.min.js';
    const cdnSrc   = 'https://cdn.jsdelivr.net/npm/apexcharts/dist/apexcharts.min.js';

    const loadScript = (src, onSuccess, onFail) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = onSuccess;
      script.onerror = onFail;
      document.head.appendChild(script);
    };

    // Try local first
    fetch(localSrc, { method: 'HEAD' })
      .then(resp => {
        if (resp.ok) {
          loadScript(localSrc, callback, () => {
            console.warn('temp-range-card: local ApexCharts failed to load, trying CDN...');
            loadScript(cdnSrc, callback, () => {
              console.error('temp-range-card: CDN ApexCharts also failed to load');
            });
          });
        } else {
          throw new Error('Local file not found');
        }
      })
      .catch(() => {
        console.warn('temp-range-card: local ApexCharts not found, loading from CDN...');
        loadScript(cdnSrc, callback, () => {
          console.error('temp-range-card: CDN ApexCharts failed to load');
        });
      });
  }

  _periodToMs(period, span) {
    switch (period) {
      case 'month': return span * 31 * 24 * 60 * 60 * 1000;
      case 'week':  return span * 7  * 24 * 60 * 60 * 1000;
      default:      return span * 24 * 60 * 60 * 1000;
    }
  }

  _defaultSpan(period) {
    switch (period) {
      case 'month': return 12;
      case 'week':  return 12;
      default:      return 30;
    }
  }

  _defaultDateFormat(period) {
    switch (period) {
      case 'month': return 'MMM YY';
      default:      return 'DD MMM';
    }
  }

  _formatLabel(dateMs, format) {
    const d = new Date(dateMs);
    const pad = n => String(n).padStart(2, '0');
    const months     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return format
      .replace('MMMM', monthsFull[d.getMonth()])
      .replace('MMM',  months[d.getMonth()])
      .replace('MM',   pad(d.getMonth() + 1))
      .replace('DD',   pad(d.getDate()))
      .replace('YYYY', d.getFullYear())
      .replace('YY',   String(d.getFullYear()).slice(-2));
  }

  // Convert absolute pixel width to ApexCharts percentage
  _barWidthPercent(barWidthPx, numBars, chartDiv) {
    const chartWidthPx = chartDiv.offsetWidth || 800;
    // ApexCharts reserves ~10% for margins/axes, rest is plot area
    const plotWidthPx = chartWidthPx * 0.88;
    const slotWidthPx = plotWidthPx / numBars;
    return Math.min(Math.round((barWidthPx / slotWidthPx) * 100), 95) + '%';
  }

  _loadChart() {
    const chartDiv = this.querySelector('#temp-range-chart');
    if (!chartDiv) {
      console.error('temp-range-card: chart div not found');
      return;
    }

    const cfg          = this._config || {};
    const period       = cfg.period       || 'day';
    const span         = cfg.span         !== undefined ? cfg.span         : this._defaultSpan(period);
    const entityId     = cfg.entity       || 'sensor.hp2553ca_pro_v1_9_8_outdoor_temperature';
    const minColor     = cfg.min_color    || '#03a9f4';
    const maxColor     = cfg.max_color    || '#ff6600';
    const dotSize      = cfg.dot_size     !== undefined ? cfg.dot_size     : 6;
    const dotVisible   = cfg.dot_visible  !== undefined ? cfg.dot_visible  : true;
    const height       = cfg.height       !== undefined ? cfg.height       : 400;
    const yMinCfg      = cfg.y_min        !== undefined ? cfg.y_min        : null;
    const yMaxCfg      = cfg.y_max        !== undefined ? cfg.y_max        : null;
    const gradient     = cfg.gradient     !== undefined ? cfg.gradient     : true;
    const dateFormat   = cfg.date_format  || this._defaultDateFormat(period);
    const rotation     = cfg.label_rotate !== undefined ? cfg.label_rotate : -45;
    const borderRadius = cfg.border_radius !== undefined ? cfg.border_radius : 0;
    // bar_width: absolute pixels (e.g. 8) or percentage string (e.g. "40%")
    // if not set, falls back to ApexCharts default
    const barWidthCfg  = cfg.bar_width    !== undefined ? cfg.bar_width    : null;

    const startTime = new Date(Date.now() - this._periodToMs(period, span));

    this._hass.connection.sendMessagePromise({
      type: 'recorder/statistics_during_period',
      start_time: startTime.toISOString(),
      end_time: new Date().toISOString(),
      statistic_ids: [entityId],
      period: period
    }).then(stats => {
      const data = stats[entityId] || [];

      if (data.length === 0) {
        chartDiv.innerHTML = '<p style="color:#9aa0aa;padding:16px;">No data available</p>';
        return;
      }

      const chartData = data.map(d => ({
        x: this._formatLabel(d.start, dateFormat),
        y: [Math.round(d.min * 10) / 10, Math.round(d.max * 10) / 10]
      }));

      // Auto y-axis: pad 3 degrees below min and above max if not explicitly set
      const dataMin = Math.min(...data.map(d => d.min));
      const dataMax = Math.max(...data.map(d => d.max));
      const yMin = yMinCfg !== null ? yMinCfg : Math.floor(dataMin) - 3;
      const yMax = yMaxCfg !== null ? yMaxCfg : Math.ceil(dataMax) + 3;

      // Resolve bar width
      let columnWidth = undefined; // let ApexCharts decide if not set
      if (barWidthCfg !== null) {
        if (typeof barWidthCfg === 'string' && barWidthCfg.includes('%')) {
          columnWidth = barWidthCfg; // already a percentage string
        } else {
          columnWidth = this._barWidthPercent(Number(barWidthCfg), data.length, chartDiv);
        }
      }

      const fillConfig = gradient ? {
        type: 'gradient',
        gradient: {
          type: 'vertical',
          gradientToColors: [maxColor],
          stops: [0, 100]
        }
      } : { type: 'solid' };

      const plotOptions = {
        bar: {
          horizontal: false,
          isDumbbell: dotVisible ? true : false,
          dumbbellColors: [[minColor, maxColor]],
          borderRadius: borderRadius,
          borderRadiusApplication: 'around',
          borderRadiusWhenStacked: 'all'
        }
      };
      if (columnWidth !== undefined) {
        plotOptions.bar.columnWidth = columnWidth;
      }

      new ApexCharts(chartDiv, {
        series: [{ name: 'Temp Range', data: chartData }],
        chart: {
          type: 'rangeBar',
          height: height,
          background: 'transparent',
          toolbar: { show: false },
          animations: { enabled: false }
        },
        plotOptions: plotOptions,
        colors: [minColor],
        fill: fillConfig,
        markers: {
          size: dotVisible ? dotSize : 0,
          strokeWidth: 0,
          hover: { size: dotVisible ? dotSize + 2 : 0 }
        },
        dataLabels: { enabled: false },
        xaxis: {
          type: 'category',
          labels: {
            style: { colors: '#9aa0aa' },
            rotate: rotation,
            rotateAlways: rotation !== 0
          },
          axisBorder: { show: false }
        },
        yaxis: {
          min: yMin,
          max: yMax,
          tickAmount: Math.min(yMax - yMin, 10),
          title: { text: '°C', style: { color: '#9aa0aa' } },
          labels: {
            style: { colors: '#9aa0aa' },
            formatter: val => Math.round(val) + '°'
          }
        },
        grid: { borderColor: '#2a3a4a', strokeDashArray: 4 },
        legend: {
          show: true,
          customLegendItems: ['Min', 'Max'],
          markers: { fillColors: [minColor, maxColor] },
          labels: { colors: '#9aa0aa' }
        },
        theme: { mode: 'dark' },
        tooltip: {
          y: { formatter: val => val + '°C' }
        }
      }).render();
    }).catch(err => {
      console.error('temp-range-card: failed to load statistics', err);
      chartDiv.innerHTML = '<p style="color:#9aa0aa;padding:16px;">Failed to load data</p>';
    });
  }

  getCardSize() {
    return 6;
  }
}

customElements.define('temp-range-card', TempRangeCard);
