/* ============================================
   ParkEase Dashboard — JavaScript Engine
   Connects to Flask backend via SSE for real-time data,
   with fallback to simulation mode for standalone use.
   ============================================ */

// ── Parking Zone Data (from polygons.json) ──
const POLYGONS = [
    [[173,185],[208,185],[199,243],[165,241]],
    [[209,184],[246,186],[237,243],[198,240]],
    [[278,187],[275,243],[237,243],[248,188]],
    [[279,188],[316,189],[309,244],[274,242]],
    [[316,189],[352,188],[346,247],[308,242]],
    [[345,246],[381,248],[388,193],[353,188]],
    [[387,193],[422,190],[417,247],[380,248]],
    [[423,191],[459,192],[453,248],[416,245]],
    [[457,193],[495,194],[490,247],[453,247]],
    [[495,196],[532,195],[526,248],[488,245]],
    [[531,195],[566,197],[564,254],[526,247]],
    [[567,197],[600,198],[600,251],[565,249]],
    [[602,200],[637,201],[637,252],[603,250]],
    [[638,202],[673,200],[673,256],[638,254]],
    [[674,203],[706,202],[709,257],[673,256]],
    [[708,203],[743,205],[745,258],[711,260]],
    [[743,204],[780,207],[780,259],[746,258]],
    [[816,207],[851,209],[853,260],[816,262]],
    [[815,205],[848,206],[846,153],[812,152]],
    [[813,202],[781,201],[778,153],[811,151]],
    [[779,200],[745,198],[744,150],[777,148]],
    [[744,198],[707,199],[708,148],[743,147]],
    [[706,195],[672,196],[674,151],[708,148]],
    [[672,196],[638,196],[638,145],[672,144]],
    [[637,196],[601,197],[602,142],[637,141]],
    [[601,195],[566,193],[569,142],[600,142]],
    [[566,191],[531,190],[534,142],[568,142]],
    [[530,188],[498,190],[500,141],[533,141]],
    [[497,189],[459,187],[462,141],[498,140]],
    [[459,185],[425,185],[428,141],[463,139]],
    [[424,181],[388,185],[392,140],[427,139]],
    [[388,188],[353,185],[355,139],[393,138]],
    [[353,182],[317,187],[321,135],[353,138]],
    [[316,187],[279,185],[287,134],[320,132]],
    [[277,183],[246,183],[253,135],[287,132]],
    [[244,180],[214,181],[216,133],[250,133]],
    [[210,176],[173,180],[180,136],[216,135]]
];

const TOTAL_SPOTS = POLYGONS.length; // 37
const VIDEO_W = 1020;
const VIDEO_H = 500;

// ── State ──
let zoneStates = [];
let occupiedCount = 0;
let availableCount = 0;
let historyData = [];
let activityLog = [];
let currentFilter = 'all';
let showOverlay = true;
let videoPlaying = false;
let backendConnected = false;
let sseSource = null;

// ── DOM References ──
let video, overlayCanvas, overlayCtx;

// ── Initialize ──
function init() {
    video = document.getElementById('parkingVideo');
    overlayCanvas = document.getElementById('overlayCanvas');
    overlayCtx = overlayCanvas.getContext('2d');

    initZoneStates();
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(updateHudTimestamp, 1000);

    setupFilterButtons();
    setupMobileMenu();
    setupNavigation();

    updateStatCards();
    drawDonutChart();
    drawTrendChart();
    renderZoneTable();
    renderActivityFeed();
    renderPeakHours();

    // Try connecting to backend via SSE
    connectToBackend();
}

// ── Backend Connection via SSE ──
function connectToBackend() {
    // Check if we're running from a server (not file://)
    if (window.location.protocol === 'file:') {
        console.log('📁 Running from file — using simulation mode');
        startFallbackMode();
        return;
    }

    try {
        sseSource = new EventSource('/api/stream');

        sseSource.onopen = function () {
            console.log('🟢 Connected to ParkEase backend (SSE)');
            backendConnected = true;
            switchToBackendMode();
        };

        sseSource.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);
                handleBackendUpdate(data);
            } catch (e) {
                console.warn('SSE parse error:', e);
            }
        };

        sseSource.onerror = function () {
            console.warn('⚠ SSE connection failed — falling back to simulation');
            sseSource.close();
            backendConnected = false;
            startFallbackMode();
        };
    } catch (e) {
        console.warn('⚠ EventSource not supported — using simulation');
        startFallbackMode();
    }
}

function switchToBackendMode() {
    const mjpeg = document.getElementById('mjpegStream');
    const videoEl = document.getElementById('parkingVideo');
    const canvas = document.getElementById('overlayCanvas');
    const hudGroup = document.getElementById('hudOverlayGroup');
    const videoControls = document.getElementById('videoControls');

    // Show MJPEG stream, hide local video + overlay
    if (mjpeg) {
        mjpeg.style.display = 'block';
        mjpeg.onerror = function () {
            // MJPEG stream not available (simulation mode on backend)
            mjpeg.style.display = 'none';
            videoEl.style.display = 'block';
            canvas.style.display = 'block';
            if (hudGroup) hudGroup.style.display = 'block';
            if (videoControls) videoControls.style.display = '';
            setupVideo();
        };
    }
    if (videoEl) videoEl.style.display = 'none';
    if (canvas) canvas.style.display = 'none';
    if (hudGroup) hudGroup.style.display = 'none';
    if (videoControls) videoControls.style.display = 'none';

    // Update system status
    const statusDot = document.querySelector('.status-dot');
    if (statusDot) statusDot.classList.add('online');

    // Update live badge
    const liveBadge = document.querySelector('.live-badge');
    if (liveBadge) liveBadge.innerHTML = '<div class="live-dot"></div>LIVE — DETECTION';
}

function startFallbackMode() {
    const mjpeg = document.getElementById('mjpegStream');
    if (mjpeg) mjpeg.style.display = 'none';

    setupVideo();
    // Simulate live updates every 5 seconds
    setInterval(simulateLiveUpdate, 5000);
}

function handleBackendUpdate(data) {
    // Update zone states from backend
    if (data.zones) {
        data.zones.forEach(z => {
            const idx = z.id - 1;
            if (idx >= 0 && idx < zoneStates.length) {
                zoneStates[idx].occupied = z.occupied;
            }
        });
    }

    // Update counts
    if (typeof data.occupied === 'number') {
        occupiedCount = data.occupied;
        availableCount = data.available;
    } else {
        recalcCounts();
    }

    // Update activity log from backend
    if (data.activity && data.activity.length > 0) {
        activityLog = data.activity;
    }

    // Update trend last point
    if (historyData.length > 0) {
        historyData[historyData.length - 1].occupied = occupiedCount;
    }

    // Re-render UI
    updateStatCards();
    drawDonutChart();
    drawTrendChart();
    renderZoneTable();
    renderActivityFeed();
    renderPeakHours();
}

// ── Zone State Initialization ──
function initZoneStates() {
    zoneStates = POLYGONS.map((poly, i) => {
        const row = i < 18 ? 'Row A (Bottom)' : 'Row B (Top)';
        const occupied = Math.random() < 0.38;
        const minutes = occupied ? Math.floor(Math.random() * 180) + 5 : 0;
        return {
            id: i + 1,
            occupied,
            row,
            duration: minutes,
            polygon: poly
        };
    });
    recalcCounts();
    generateInitialHistory();
    generateInitialActivity();
}

function recalcCounts() {
    occupiedCount = zoneStates.filter(z => z.occupied).length;
    availableCount = TOTAL_SPOTS - occupiedCount;
}

function generateInitialHistory() {
    historyData = [];
    const hours = ['6AM','7AM','8AM','9AM','10AM','11AM','12PM','1PM','2PM'];
    const pattern = [5, 12, 22, 28, 32, 30, 25, 18, occupiedCount];
    hours.forEach((h, i) => {
        historyData.push({ hour: h, occupied: pattern[i] });
    });
}

function generateInitialActivity() {
    activityLog = [
        { type: 'enter', text: 'Vehicle entered Zone A-5', time: '2 min ago' },
        { type: 'exit',  text: 'Vehicle left Zone B-12', time: '5 min ago' },
        { type: 'enter', text: 'Vehicle entered Zone A-14', time: '8 min ago' },
        { type: 'exit',  text: 'Vehicle left Zone A-3', time: '11 min ago' },
        { type: 'enter', text: 'Vehicle entered Zone B-7', time: '14 min ago' },
        { type: 'exit',  text: 'Vehicle left Zone B-19', time: '18 min ago' },
        { type: 'enter', text: 'Vehicle entered Zone A-9', time: '22 min ago' },
        { type: 'exit',  text: 'Vehicle left Zone A-1', time: '27 min ago' },
        { type: 'enter', text: 'Vehicle entered Zone B-16', time: '31 min ago' },
        { type: 'exit',  text: 'Vehicle left Zone A-11', time: '35 min ago' },
    ];
}

// ══════════════════════════════════════════
//  Video Feed + Overlay (Fallback Mode)
// ══════════════════════════════════════════
function setupVideo() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const progressBar = document.getElementById('vidProgressBar');
    const progressFill = document.getElementById('vidProgressFill');
    const overlayToggle = document.getElementById('overlayToggle');

    if (!playPauseBtn || !video) return;

    // Auto-play on load
    video.addEventListener('loadeddata', () => {
        video.play().then(() => {
            videoPlaying = true;
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            requestAnimationFrame(renderOverlayLoop);
        }).catch(() => {
            // Autoplay blocked — user needs to click play
            videoPlaying = false;
        });
    });

    // Play / Pause
    playPauseBtn.addEventListener('click', () => {
        if (video.paused) {
            video.play();
            videoPlaying = true;
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            requestAnimationFrame(renderOverlayLoop);
        } else {
            video.pause();
            videoPlaying = false;
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    });

    // Progress bar update
    video.addEventListener('timeupdate', () => {
        if (video.duration) {
            const pct = (video.currentTime / video.duration) * 100;
            progressFill.style.width = pct + '%';
        }
    });

    // Click progress bar to seek
    progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        video.currentTime = pct * video.duration;
    });

    // Overlay toggle
    overlayToggle.addEventListener('click', () => {
        showOverlay = !showOverlay;
        overlayToggle.style.opacity = showOverlay ? '1' : '0.4';
        if (!showOverlay) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
    });

    // Handle resize
    window.addEventListener('resize', handleResize);
}

function handleResize() {
    drawTrendChart();
}

// ── Overlay rendering loop (synced with video frames) ──
function renderOverlayLoop() {
    if (!videoPlaying) return;
    drawOverlay();
    requestAnimationFrame(renderOverlayLoop);
}

function drawOverlay() {
    if (!showOverlay) return;

    const displayW = video.clientWidth;
    const displayH = video.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    // Size the canvas to match the displayed video
    if (overlayCanvas.width !== displayW * dpr || overlayCanvas.height !== displayH * dpr) {
        overlayCanvas.width = displayW * dpr;
        overlayCanvas.height = displayH * dpr;
        overlayCanvas.style.width = displayW + 'px';
        overlayCanvas.style.height = displayH + 'px';
    }

    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Scale factor from original video coords (1020x500) to display size
    const sx = displayW * dpr / VIDEO_W;
    const sy = displayH * dpr / VIDEO_H;
    overlayCtx.scale(sx, sy);

    zoneStates.forEach((zone) => {
        const poly = zone.polygon;
        overlayCtx.beginPath();
        overlayCtx.moveTo(poly[0][0], poly[0][1]);
        for (let j = 1; j < poly.length; j++) {
            overlayCtx.lineTo(poly[j][0], poly[j][1]);
        }
        overlayCtx.closePath();

        if (zone.occupied) {
            overlayCtx.fillStyle = 'rgba(239, 68, 68, 0.28)';
            overlayCtx.fill();
            overlayCtx.strokeStyle = '#ef4444';
            overlayCtx.lineWidth = 2 / sx; // Compensate for scale
            overlayCtx.stroke();
        } else {
            overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.15)';
            overlayCtx.fill();
            overlayCtx.strokeStyle = '#22c55e';
            overlayCtx.lineWidth = 1.5 / sx;
            overlayCtx.stroke();
        }

        // Zone label
        const cx = poly.reduce((s, p) => s + p[0], 0) / 4;
        const cy = poly.reduce((s, p) => s + p[1], 0) / 4;
        const fontSize = 9 / sx;
        overlayCtx.font = `bold ${fontSize}px Inter, sans-serif`;
        overlayCtx.textAlign = 'center';
        overlayCtx.textBaseline = 'middle';
        overlayCtx.fillStyle = zone.occupied
            ? 'rgba(239, 68, 68, 0.9)'
            : 'rgba(34, 197, 94, 0.85)';
        overlayCtx.fillText(zone.id, cx, cy);
    });

    // Reset transform
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
}

// ══════════════════════════════════════════
//  Clock + HUD Timestamp
// ══════════════════════════════════════════
function updateClock() {
    const now = new Date();
    document.getElementById('headerTime').textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

function updateHudTimestamp() {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const tsEl = document.getElementById('hudTimestamp');
    const spotsEl = document.getElementById('hudSpots');
    if (tsEl) tsEl.textContent = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    if (spotsEl) spotsEl.textContent = `Available: ${availableCount} / ${TOTAL_SPOTS}`;
}

// ══════════════════════════════════════════
//  Stat Cards
// ══════════════════════════════════════════
function updateStatCards() {
    const rate = Math.round((occupiedCount / TOTAL_SPOTS) * 100);
    document.getElementById('totalSpotsValue').textContent = TOTAL_SPOTS;
    document.getElementById('availableValue').textContent = availableCount;
    document.getElementById('occupiedValue').textContent = occupiedCount;
    document.getElementById('occupancyRateValue').textContent = rate + '%';
    document.getElementById('donutPercent').textContent = rate + '%';
    document.getElementById('donutAvail').textContent = availableCount;
    document.getElementById('donutOccupied').textContent = occupiedCount;
}

// ══════════════════════════════════════════
//  Donut Chart
// ══════════════════════════════════════════
function drawDonutChart() {
    const canvas = document.getElementById('donutChart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 200;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2;
    const outerR = 85, innerR = 60;

    ctx.clearRect(0, 0, size, size);

    const availAngle = (availableCount / TOTAL_SPOTS) * Math.PI * 2;
    const startAngle = -Math.PI / 2;
    const gap = 0.04;

    // Available arc
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle, startAngle + availAngle - gap);
    ctx.arc(cx, cy, innerR, startAngle + availAngle - gap, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = '#22c55e';
    ctx.fill();

    // Occupied arc
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle + availAngle + gap, startAngle + Math.PI * 2);
    ctx.arc(cx, cy, innerR, startAngle + Math.PI * 2, startAngle + availAngle + gap, true);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
}

// ══════════════════════════════════════════
//  Trend Chart
// ══════════════════════════════════════════
function drawTrendChart() {
    const canvas = document.getElementById('trendChart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth - 32;
    const h = 160;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padL = 35, padR = 10, padT = 10, padB = 30;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const data = historyData;
    const maxVal = TOTAL_SPOTS;
    const n = data.length;

    // Grid lines
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = padT + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padL - 6, y + 3);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Inter, sans-serif';
    data.forEach((d, i) => {
        const x = padL + (chartW / (n - 1)) * i;
        ctx.fillText(d.hour, x, h - 8);
    });

    // Area fill
    const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.02)');

    ctx.beginPath();
    data.forEach((d, i) => {
        const x = padL + (chartW / (n - 1)) * i;
        const y = padT + chartH - (d.occupied / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.lineTo(padL + chartW, padT + chartH);
    ctx.lineTo(padL, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((d, i) => {
        const x = padL + (chartW / (n - 1)) * i;
        const y = padT + chartH - (d.occupied / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots
    data.forEach((d, i) => {
        const x = padL + (chartW / (n - 1)) * i;
        const y = padT + chartH - (d.occupied / maxVal) * chartH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#1e2130';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

// ══════════════════════════════════════════
//  Zone Table
// ══════════════════════════════════════════
function renderZoneTable() {
    const tbody = document.getElementById('zoneTableBody');
    const filtered = zoneStates.filter(z => {
        if (currentFilter === 'available') return !z.occupied;
        if (currentFilter === 'occupied') return z.occupied;
        return true;
    });

    tbody.innerHTML = filtered.map(z => {
        const status = z.occupied
            ? '<span class="status-badge occupied">Occupied</span>'
            : '<span class="status-badge available">Available</span>';
        const dur = z.occupied ? formatDuration(z.duration) : '—';
        const rowLabel = z.id <= 18 ? 'A' : 'B';
        return `<tr>
            <td style="color:var(--text-primary);font-weight:500;">Zone ${rowLabel}-${z.id}</td>
            <td>${z.row}</td>
            <td>${status}</td>
            <td>${dur}</td>
        </tr>`;
    }).join('');
}

function formatDuration(min) {
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h + 'h ' + m + 'm';
}

// ══════════════════════════════════════════
//  Activity Feed
// ══════════════════════════════════════════
function renderActivityFeed() {
    const feed = document.getElementById('activityFeed');
    feed.innerHTML = activityLog.map(a => {
        const iconClass = a.type === 'enter' ? 'enter' : 'exit';
        const icon = a.type === 'enter' ? '↓' : '↑';
        return `<div class="activity-item">
            <div class="activity-icon ${iconClass}">${icon}</div>
            <div class="activity-info">
                <div class="activity-text">${a.text}</div>
                <div class="activity-time">${a.time}</div>
            </div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════
//  Peak Hours
// ══════════════════════════════════════════
function renderPeakHours() {
    const container = document.getElementById('peakBars');
    const peakData = [
        { hour: '6 AM',  value: 14 },
        { hour: '7 AM',  value: 32 },
        { hour: '8 AM',  value: 59 },
        { hour: '9 AM',  value: 76 },
        { hour: '10 AM', value: 86 },
        { hour: '11 AM', value: 81 },
        { hour: '12 PM', value: 68 },
        { hour: '1 PM',  value: 49 },
        { hour: '2 PM',  value: Math.round((occupiedCount / TOTAL_SPOTS) * 100) },
        { hour: '3 PM',  value: 42 },
        { hour: '4 PM',  value: 55 },
        { hour: '5 PM',  value: 72 },
        { hour: '6 PM',  value: 65 },
        { hour: '7 PM',  value: 38 },
    ];

    container.innerHTML = peakData.map(d => {
        const level = d.value < 40 ? 'low' : d.value < 70 ? 'medium' : 'high';
        return `<div class="peak-bar-item">
            <span class="peak-label">${d.hour}</span>
            <div class="peak-bar-track">
                <div class="peak-bar-fill ${level}" style="width:${d.value}%"></div>
            </div>
            <span class="peak-bar-value">${d.value}%</span>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════
//  Live Simulation (Fallback only)
// ══════════════════════════════════════════
function simulateLiveUpdate() {
    if (backendConnected) return; // Don't simulate if backend is active

    // Toggle a random zone
    const idx = Math.floor(Math.random() * TOTAL_SPOTS);
    const zone = zoneStates[idx];
    zone.occupied = !zone.occupied;
    zone.duration = zone.occupied ? Math.floor(Math.random() * 15) + 1 : 0;

    // Increment durations for occupied zones
    zoneStates.forEach(z => {
        if (z.occupied && z !== zone) z.duration += Math.floor(Math.random() * 3) + 1;
    });

    recalcCounts();

    // Add activity event
    const rowLabel = zone.id <= 18 ? 'A' : 'B';
    const action = zone.occupied
        ? { type: 'enter', text: `Vehicle entered Zone ${rowLabel}-${zone.id}`, time: 'Just now' }
        : { type: 'exit',  text: `Vehicle left Zone ${rowLabel}-${zone.id}`, time: 'Just now' };

    // Age existing activities
    activityLog.forEach(a => {
        if (a.time === 'Just now') a.time = '5 sec ago';
        else {
            const match = a.time.match(/(\d+)/);
            if (match) {
                let num = parseInt(match[1]);
                if (a.time.includes('sec')) {
                    num += 5;
                    if (num >= 60) a.time = '1 min ago';
                    else a.time = num + ' sec ago';
                } else if (a.time.includes('min')) {
                    num += 1;
                    a.time = num + ' min ago';
                }
            }
        }
    });

    activityLog.unshift(action);
    if (activityLog.length > 15) activityLog.pop();

    // Update trend last point
    if (historyData.length > 0) {
        historyData[historyData.length - 1].occupied = occupiedCount;
    }

    // Re-render everything except the video overlay (it runs in its own RAF loop)
    updateStatCards();
    drawDonutChart();
    drawTrendChart();
    renderZoneTable();
    renderActivityFeed();
    renderPeakHours();
}

// ══════════════════════════════════════════
//  Filter Buttons
// ══════════════════════════════════════════
function setupFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderZoneTable();
        });
    });
}

// ══════════════════════════════════════════
//  Mobile Menu
// ══════════════════════════════════════════
function setupMobileMenu() {
    const toggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 900) sidebar.classList.remove('open');
        });
    });
}

// ══════════════════════════════════════════
//  Navigation (visual only)
// ══════════════════════════════════════════
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

// ── Start ──
document.addEventListener('DOMContentLoaded', init);
