/**
 * Earthquake Warning App - Core Logic (Phase 6b: Towns + CWA 2020 + Robust Click)
 */

// State
const state = {
    isAlerting: false,
    location: { lat: 25.03, lng: 121.56, name: 'Taipei' },
    config: {
        cwaKey: localStorage.getItem('cwa_key') || '',
        manualLoc: localStorage.getItem('manual_loc') || '',
    },
    mapState: {
        scale: 1, panning: false,
        pointX: 0, pointY: 0,
        startX: 0, startY: 0,
        // Projection state
        minX: 0, maxX: 0, minY: 0, maxY: 0,
        pixelsPerKm: 0,
        // Proj Helper
        projX: null, projY: null,
        invertX: null, invertY: null
    },
    simulation: {
        epicenter: null // { name, lat, lng }
    }
};

// Map Coordinates (Populated from Map Data)
const REGIONS = {};

// Fallback coordinates for user location (English names)
const FALLBACK_COORDS = {
    'Taipei': { lat: 25.03, lng: 121.56 },
    'NewTaipei': { lat: 24.91, lng: 121.67 },
    'Taoyuan': { lat: 24.99, lng: 121.30 },
    'Hsinchu': { lat: 24.81, lng: 120.96 },
    'Miaoli': { lat: 24.56, lng: 120.81 },
    'Taichung': { lat: 24.14, lng: 120.67 },
    'Changhua': { lat: 24.05, lng: 120.51 },
    'Nantou': { lat: 23.96, lng: 120.97 },
    'Yunlin': { lat: 23.70, lng: 120.43 },
    'Chiayi': { lat: 23.48, lng: 120.44 },
    'Tainan': { lat: 22.99, lng: 120.21 },
    'Kaohsiung': { lat: 22.62, lng: 120.30 },
    'Pingtung': { lat: 22.55, lng: 120.54 },
    'Yilan': { lat: 24.76, lng: 121.75 },
    'Hualien': { lat: 23.98, lng: 121.60 },
    'Taitung': { lat: 22.76, lng: 121.14 },
    'Penghu': { lat: 23.57, lng: 119.60 },
    'Kinmen': { lat: 24.45, lng: 118.37 },
    'Lienchiang': { lat: 26.15, lng: 119.93 }
};

// Offshore Coordinates
const OFFSHORE_ZONES = [
    { name: '基隆外海', lat: 25.50, lng: 122.00 },
    { name: '宜蘭外海', lat: 24.50, lng: 122.20 },
    { name: '花蓮外海', lat: 23.80, lng: 122.00 },
    { name: '台東外海', lat: 22.50, lng: 121.50 },
    { name: '台灣海峽北部', lat: 25.00, lng: 120.00 },
    { name: '台灣海峽南部', lat: 23.00, lng: 119.50 },
    { name: '巴士海峽', lat: 21.50, lng: 120.80 }
];

// --- Physics Engine (CWA 2020) ---
const Physics = {
    coeffs: { c1: -3.232, c2: 1.047, c3: -1.662, c4: 1.16, c5: 0.5 },
    siteFactors: { 'Taipei': 1.4, 'NewTaipei': 1.2, 'Yilan': 1.3, 'Hualien': 0.9 },

    calculatePGA: function (M, R_km, depth_km, regionName) {
        const R = Math.sqrt(R_km * R_km + depth_km * depth_km);
        const { c1, c2, c3 } = this.coeffs;
        const saturation = 0.12 * Math.exp(0.6 * M);
        const ln_pga_g = c1 + c2 * M + c3 * Math.log(R + saturation);
        let pga_gal = Math.exp(ln_pga_g) * 980;

        // Safety for site factors (check partial match)
        const siteKey = Object.keys(this.siteFactors).find(k => regionName && regionName.includes(k));
        if (siteKey) pga_gal *= this.siteFactors[siteKey];
        return pga_gal;
    },

    // CWA 2020 Scale (PGA in Gal)
    pgaToIntensity: function (pga) {
        if (pga < 0.8) return '0';
        if (pga < 2.5) return '1';
        if (pga < 8.0) return '2';
        if (pga < 25) return '3';
        if (pga < 80) return '4';
        if (pga < 140) return '5-minus'; // 5-
        if (pga < 250) return '5-plus';  // 5+
        if (pga < 440) return '6-minus'; // 6-
        if (pga < 800) return '6-plus';  // 6+
        return '7'; // 7
    },

    // Helper to get numeric value for comparison/sorting if needed
    intensityToNum: function (str) {
        const map = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5-minus': 5, '5-plus': 5.5, '6-minus': 6, '6-plus': 6.5, '7': 7 };
        return map[str] || 0;
    },

    getDistance: function (lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
};

// --- Audio ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let sirenOsc = null, sirenGain = null;

function playBeep() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.start(); osc.stop(audioCtx.currentTime + 0.5);
}

// Japan EEW-style warning chime (two-tone repeating pattern)
let eewInterval = null;
let eewOsc = null;
let eewGain = null;

function playEEWChime() {
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    const now = audioCtx.currentTime;

    // Japan EEW two-tone pattern: high-low-high-low
    osc.frequency.setValueAtTime(932, now);        // B5
    osc.frequency.setValueAtTime(622, now + 0.15); // Eb5
    osc.frequency.setValueAtTime(932, now + 0.3);  // B5
    osc.frequency.setValueAtTime(622, now + 0.45); // Eb5

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.setValueAtTime(0.8, now + 0.55);
    gain.gain.linearRampToValueAtTime(0, now + 0.6);

    osc.start(now);
    osc.stop(now + 0.6);
}

function startSiren() {
    if (eewInterval) return;
    playEEWChime(); // Play immediately
    eewInterval = setInterval(playEEWChime, 1000); // Repeat every 1s
}

function stopSiren() {
    if (eewInterval) {
        clearInterval(eewInterval);
        eewInterval = null;
    }
}

// --- DOM ---
const ui = {
    app: document.getElementById('app'),
    alertBanner: document.getElementById('alert-banner'),
    alertTitle: document.getElementById('alert-title'),
    alertMsg: document.getElementById('alert-message'),
    countdown: document.getElementById('countdown-timer'),
    intensity: document.getElementById('start-intensity'),
    userLocation: document.getElementById('user-location'),
    systemStatus: document.getElementById('system-status'),
    keyInput: document.getElementById('cwa-key'),
    locSelect: document.getElementById('loc-select'),
    mapContainer: document.getElementById('taiwan-map-container'),
    // New UI elements
    countySelect: document.getElementById('county-select'),
    townSelect: document.getElementById('town-select'),
    testSelect: document.getElementById('test-select'),
};

// --- Init ---
function init() {
    if (window.lucide) lucide.createIcons();
    if (ui.keyInput) ui.keyInput.value = state.config.cwaKey;

    document.addEventListener('click', () => { if (audioCtx.state === 'suspended') audioCtx.resume(); }, { once: true });

    // Test Dropdown
    if (ui.testSelect) {
        ui.testSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;
            e.target.value = ''; // Reset to placeholder

            if (val === 'reset') resetAlert();
            else if (val === 'random') simulateRandomEarthquake();
            else simulateAlertFixed(parseInt(val));
        });
    }

    // County Select - Populate after map loads
    if (ui.countySelect) {
        ui.countySelect.addEventListener('change', (e) => {
            const countyName = e.target.value;
            populateTownSelect(countyName);
        });
    }

    // Town Select
    if (ui.townSelect) {
        ui.townSelect.addEventListener('change', (e) => {
            const townName = e.target.value;
            if (townName && REGIONS[townName]) {
                state.config.manualLoc = townName;
                localStorage.setItem('manual_loc', townName);
                state.location = { ...REGIONS[townName], name: townName };
                updateLocationDisplay();
            }
        });
    }

    updateLocationDisplay();
    initMap();
    console.log('App Initialized (CWA 2020 Update)');
}

// Populate county dropdown from REGIONS
function populateCountySelect() {
    if (!ui.countySelect) return;
    const counties = new Set();
    Object.values(REGIONS).forEach(r => { if (r.county) counties.add(r.county); });

    ui.countySelect.innerHTML = '<option value="">縣市</option>';
    [...counties].sort((a, b) => a.localeCompare(b, 'zh-TW')).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        ui.countySelect.appendChild(opt);
    });
}

// Populate town dropdown based on selected county
function populateTownSelect(countyName) {
    if (!ui.townSelect) return;
    ui.townSelect.innerHTML = '<option value="">鄉鎮市區</option>';

    if (!countyName) return;

    const towns = Object.entries(REGIONS)
        .filter(([name, r]) => r.county === countyName)
        .sort((a, b) => a[0].localeCompare(b[0], 'zh-TW'));

    towns.forEach(([name, r]) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        ui.townSelect.appendChild(opt);
    });
}

function toggle(el, show) { if (show) el.classList.remove('hidden'); else el.classList.add('hidden'); }

function updateLocationDisplay() {
    // 1. Update text badge
    if (state.config.manualLoc) {
        ui.userLocation.textContent = `${state.config.manualLoc} (手動)`;
        if (REGIONS[state.config.manualLoc]) state.location = { ...REGIONS[state.config.manualLoc], name: state.config.manualLoc };
    } else {
        ui.userLocation.textContent = "尚未定位";
    }

    // 2. Update Map Marker
    const userLayer = document.getElementById('user-layer');
    if (!userLayer) return;

    userLayer.innerHTML = ''; // Clear previous marker

    if (state.location && state.location.lat && state.location.lng) {
        const { x, y } = project(state.location.lat, state.location.lng);

        // Draw Pin (Icon + Pulse)
        // Pulse ring
        const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pulse.setAttribute("cx", x);
        pulse.setAttribute("cy", y);
        pulse.setAttribute("r", "8");
        pulse.setAttribute("fill", "rgba(16, 185, 129, 0.4)");

        // Pin center
        const pin = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pin.setAttribute("cx", x);
        pin.setAttribute("cy", y);
        pin.setAttribute("r", "4");
        pin.setAttribute("fill", "#10b981"); // Emerald-500
        pin.setAttribute("stroke", "#ffffff");
        pin.setAttribute("stroke-width", "1.5");

        // Add animation to pulse manually or via CSS class if preferred
        // Simple pulsing via SMIL or CSS
        const anim = document.createElementNS("http://www.w3.org/2000/svg", "animate");
        anim.setAttribute("attributeName", "r");
        anim.setAttribute("from", "4");
        anim.setAttribute("to", "15");
        anim.setAttribute("dur", "1.5s");
        anim.setAttribute("repeatCount", "indefinite");

        const fade = document.createElementNS("http://www.w3.org/2000/svg", "animate");
        fade.setAttribute("attributeName", "opacity");
        fade.setAttribute("from", "0.8");
        fade.setAttribute("to", "0");
        fade.setAttribute("dur", "1.5s");
        fade.setAttribute("repeatCount", "indefinite");

        pulse.appendChild(anim);
        pulse.appendChild(fade);

        // Apply non-scaling stroke
        pulse.setAttribute("vector-effect", "non-scaling-stroke");
        pin.setAttribute("vector-effect", "non-scaling-stroke");

        userLayer.appendChild(pulse);
        userLayer.appendChild(pin);
    }
}

// --- Map Logic ---
let svgElement = null, mapGroup = null, animFrame = null;

async function initMap() {
    try {
        const [townRes, countyRes] = await Promise.all([
            fetch('assets/taiwan-towns.json'),
            fetch('assets/taiwan.json')
        ]);

        const townsData = await townRes.json();
        const countyData = await countyRes.json();

        renderGeoJSON(townsData, countyData);
        startGeolocation();
    } catch (e) {
        console.error('Failed to load map data:', e);
        ui.mapContainer.innerHTML = `<div class="map-placeholder" style="color:red; text-align:center;">地圖載入失敗<br><small>${e.message}</small></div>`;
    }
}


// Projection Helper
function project(lat, lng) {
    if (!state.mapState.projX) return { x: 0, y: 0 };
    return {
        x: state.mapState.projX(lng),
        y: state.mapState.projY(lat)
    };
}
// Inverse Projection Helper
function unproject(x, y) {
    if (!state.mapState.invertX) return { lat: 24, lng: 121 };
    return {
        lat: state.mapState.invertY(y),
        lng: state.mapState.invertX(x)
    };
}

function renderGeoJSON(data, countyData) {
    // 1. Calculate Bounds (Raw Lat/Lng)
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

    // Assuming taiwan-towns.json features are in Lat/Lng
    // Check first coordinate of first feature to be sure? 
    // If > 1000, likely projected. If < 180, likely Lat/Lng.
    // Standard GeoJSON is Lat/Lng (Lng, Lat).

    const processRing = (ring) => {
        ring.forEach(([x, y]) => {
            if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
            if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
        });
    };

    data.features.forEach(f => {
        const type = f.geometry.type;
        const coords = f.geometry.coordinates;
        if (type === 'Polygon') coords.forEach(processRing);
        else if (type === 'MultiPolygon') coords.forEach(poly => poly.forEach(processRing));
    });

    // 2. Setup Projection with UNIFORM scale (preserves aspect ratio)
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;

    // Latitude correction: at Taiwan's latitude (~24°), 1° longitude ≈ 0.91 × 1° latitude in actual distance
    const avgLat = (minLat + maxLat) / 2;
    const latCorrection = Math.cos(avgLat * Math.PI / 180);

    // Use uniform scale based on height
    const PADDING = 50;
    const SVG_HEIGHT = 800; // Base height in SVG units

    // Calculate scale: how many SVG units per degree latitude
    const scaleY = (SVG_HEIGHT - 2 * PADDING) / latSpan;
    // Apply latitude correction for longitude (make Taiwan narrower to reflect real proportions)
    const scaleX = scaleY * latCorrection;

    // Calculate width based on corrected scale
    const SVG_WIDTH = lngSpan * scaleX + 2 * PADDING;

    // Store for viewBox
    const finalW = SVG_WIDTH;
    const finalH = SVG_HEIGHT;

    // Projection Functions
    // Lng -> X: [minLng, maxLng] -> [PADDING, SVG_WIDTH - PADDING]
    // Lat -> Y: [minLat, maxLat] -> [SVG_HEIGHT - PADDING, PADDING] (Y flip: higher lat = lower Y)

    state.mapState.projX = (lng) => PADDING + (lng - minLng) * scaleX;
    state.mapState.projY = (lat) => (SVG_HEIGHT - PADDING) - (lat - minLat) * scaleY;

    // Inverse
    state.mapState.invertX = (x) => minLng + (x - PADDING) / scaleX;
    state.mapState.invertY = (y) => minLat + ((SVG_HEIGHT - PADDING) - y) / scaleY;

    state.mapState.pixelsPerKm = scaleY / 111; // Approx 1deg lat ~ 111km
    state.mapState.viewBox = { w: finalW, h: finalH };

    // 3. Render Paths
    ui.locSelect.innerHTML = '<option value="">-- 自動定位 --</option>';

    // Sort features
    const sortedFeatures = data.features.sort((a, b) => {
        const n1 = a.properties.town || a.properties.TOWNNAME || a.properties.name || '';
        const n2 = b.properties.town || b.properties.TOWNNAME || b.properties.name || '';
        return n1.localeCompare(n2, 'zh-TW');
    });

    console.log('Total features:', sortedFeatures.length);
    if (sortedFeatures.length > 0) {
        console.log('First feature props:', sortedFeatures[0].properties);
    }

    let paths = '';

    sortedFeatures.forEach(f => {
        const name = f.properties.town || f.properties.TOWNNAME || f.properties.name || 'Unknown';
        const county = f.properties.county || f.properties.COUNTYNAME || '';
        const uniqueId = `${county}${name}`; // Unique ID to handle duplicate town names

        // Centroid
        let cx = 0, cy = 0, ptCount = 0;
        const addRing = (ring) => { ring.forEach(([x, y]) => { cx += x; cy += y; ptCount++; }); };
        const type = f.geometry.type;
        const coords = f.geometry.coordinates;
        if (type === 'Polygon') coords.forEach(addRing);
        else if (type === 'MultiPolygon') coords.forEach(poly => poly.forEach(addRing));

        if (ptCount > 0) {
            cx /= ptCount; cy /= ptCount;
            // Use unique ID as key in REGIONS
            REGIONS[uniqueId] = { lat: cy, lng: cx, name: name, county: county, id: uniqueId };

            const option = document.createElement('option');
            option.value = uniqueId; // Value is now unique ID
            option.textContent = `${county} ${name}`;
            ui.locSelect.appendChild(option);
        }

        let d = '';
        const drawRing = (ring) => {
            let s = 'M';
            ring.forEach(([x, y], i) => {
                const sx = state.mapState.projX(x);
                const sy = state.mapState.projY(y);
                s += `${sx.toFixed(1)} ${sy.toFixed(1)} `;
                if (i === 0) s += 'L ';
            });
            s += 'Z '; return s;
        };
        if (type === 'Polygon') coords.forEach(r => d += drawRing(r));
        else if (type === 'MultiPolygon') coords.forEach(p => p.forEach(r => d += drawRing(r)));

        // Use uniqueId for data-id attribute to ensure we target correct element
        paths += `<path id="path-${uniqueId}" d="${d}" class="region" data-name="${name}" data-county="${county}" data-id="${uniqueId}" />`;
    });

    // 4. Draw County Borders (Overlay)
    let countyPaths = '';
    if (countyData && countyData.features) {
        countyData.features.forEach(f => {
            const type = f.geometry.type;
            const coords = f.geometry.coordinates;
            let d = '';
            const drawRing = (ring) => {
                let s = 'M';
                ring.forEach(([x, y], i) => {
                    const sx = state.mapState.projX(x);
                    const sy = state.mapState.projY(y);
                    s += `${sx.toFixed(1)} ${sy.toFixed(1)} `;
                    if (i === 0) s += 'L ';
                });
                s += 'Z '; return s;
            };
            if (type === 'Polygon') coords.forEach(r => d += drawRing(r));
            else if (type === 'MultiPolygon') coords.forEach(p => p.forEach(r => d += drawRing(r)));

            // County border path
            countyPaths += `<path d="${d}" class="county-border" />`;
        });
    }

    const viewBox = `0 0 ${finalW.toFixed(1)} ${finalH.toFixed(1)}`;
    ui.mapContainer.innerHTML = `
        <svg id="map-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="cursor: crosshair; width:100%; height:100%; vector-effect:non-scaling-stroke; shape-rendering: geometricPrecision;">
            <g id="viewport">
                <g id="map-group">${paths}</g>
                <g id="county-layer" style="pointer-events: none;">${countyPaths}</g>
                <g id="user-layer" style="pointer-events: none;"></g>
                <g id="anim-layer" style="pointer-events: none;"></g>
            </g>
        </svg>`;

    svgElement = document.getElementById('map-svg');
    // MapGroup is now the viewport for transformation purposes
    mapGroup = document.getElementById('viewport');
    // Individual layers can still be accessed if needed, but we transform the parent
    state.mapState.animLayer = document.getElementById('anim-layer'); // Keeping this reference if needed for other logic

    state.mapState.scale = 1;
    state.mapState.pointX = 0; state.mapState.pointY = 0;

    initMapInteraction();
    initClickToTrigger();

    // Populate county dropdown after map data is loaded
    populateCountySelect();

    if (state.config.manualLoc && REGIONS[state.config.manualLoc]) {
        ui.locSelect.value = state.config.manualLoc;
        updateLocationDisplay();
    }
}

function initMapInteraction() {
    let isDragging = false;
    let startPt = null;
    let translateX = 0, translateY = 0;
    let zoomScale = 1;
    let hasMoved = false;

    // Convert screen coords to SVG coords
    function screenToSvg(x, y) {
        const pt = svgElement.createSVGPoint();
        pt.x = x;
        pt.y = y;
        const ctm = svgElement.getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        return pt.matrixTransform(ctm.inverse());
    }

    svgElement.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        hasMoved = false;
        startPt = screenToSvg(e.clientX, e.clientY);
        svgElement.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        if (svgElement) svgElement.style.cursor = 'crosshair';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging || !startPt) return;
        e.preventDefault();
        const currentPt = screenToSvg(e.clientX, e.clientY);
        const dx = (currentPt.x - startPt.x) * zoomScale;
        const dy = (currentPt.y - startPt.y) * zoomScale;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved = true;
        translateX += (currentPt.x - startPt.x);
        translateY += (currentPt.y - startPt.y);
        setTransform();
    });

    svgElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        const pt = screenToSvg(e.clientX, e.clientY);
        const oldScale = zoomScale;
        const delta = -Math.sign(e.deltaY);
        if (delta > 0) zoomScale *= 1.15; else zoomScale /= 1.15;
        zoomScale = Math.min(Math.max(0.5, zoomScale), 10);

        // Zoom towards mouse position
        const scaleChange = zoomScale / oldScale;
        translateX = pt.x - (pt.x - translateX) * scaleChange;
        translateY = pt.y - (pt.y - translateY) * scaleChange;
        setTransform();
    }, { passive: false });

    function setTransform() {
        const t = `translate(${translateX}, ${translateY}) scale(${zoomScale})`;
        mapGroup.setAttribute('transform', t);
        // Set zoom variable for CSS if needed
        svgElement.style.setProperty('--map-zoom', zoomScale);
    }

    svgElement._hasMoved = () => hasMoved;
    svgElement._getTransform = () => ({ translateX, translateY, scale: zoomScale });
}

function initClickToTrigger() {
    svgElement.addEventListener('click', (e) => {
        if (svgElement._hasMoved && svgElement._hasMoved()) return;

        // Create SVG point and transform using mapGroup's CTM (includes all transforms)
        const pt = svgElement.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;

        // Get CTM from mapGroup which has the CSS transform applied
        const ctm = mapGroup.getScreenCTM();
        if (!ctm) return;

        // Inverse transform: screen coords to SVG coords
        const svgPt = pt.matrixTransform(ctm.inverse());
        const svgX = svgPt.x;
        const svgY = svgPt.y;

        // Unproject SVG coords to Lat/Lng
        const coords = unproject(svgX, svgY);

        state.simulation.epicenter = {
            lat: coords.lat,
            lng: coords.lng,
            name: `自訂震央`
        };

        ui.systemStatus.textContent = `震央已選: ${state.simulation.epicenter.name}`;

        // Random sim settings
        const M = (Math.random() * 2 + 4).toFixed(1);
        const depth = Math.floor(Math.random() * 30 + 5);
        runSimulation(M, depth, state.simulation.epicenter);
    });
}

function updateMapIntensity(mapData) {
    let found = 0, notFound = 0;
    for (const [key, intStr] of Object.entries(mapData)) {
        // Use data-id attribute (uniqueId) for reliable lookup
        const el = document.querySelector(`path[data-id="${key}"]`);
        if (el) {
            found++;
            el.className.baseVal = 'region';
            el.classList.add(`int-${intStr}`);
        } else {
            notFound++;
            if (notFound <= 3) console.log('Element not found for:', key);
        }
    }
    console.log(`updateMapIntensity: found=${found}, notFound=${notFound}`);
}

// --- Animation ---
function startWaveAnimation(lat, lng) {
    if (animFrame) cancelAnimationFrame(animFrame);
    const layer = state.mapState.animLayer;
    layer.innerHTML = '';

    const { x, y } = project(lat, lng);

    // P-Wave: Yellow Hollow
    const pWave = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pWave.setAttribute("cx", x); pWave.setAttribute("cy", y);
    pWave.setAttribute("r", 0);
    pWave.setAttribute("fill", "none");
    pWave.setAttribute("stroke", "#fde047");
    pWave.setAttribute("stroke-width", "2");
    pWave.setAttribute("opacity", "0.9");
    pWave.setAttribute("vector-effect", "non-scaling-stroke");

    // S-Wave: Transparent Red Hollow
    const sWave = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    sWave.setAttribute("cx", x); sWave.setAttribute("cy", y);
    sWave.setAttribute("r", 0);
    sWave.setAttribute("fill", "none");
    sWave.setAttribute("stroke", "rgba(239, 68, 68, 0.6)");
    sWave.setAttribute("stroke-width", "4");
    sWave.setAttribute("vector-effect", "non-scaling-stroke");

    layer.appendChild(pWave);
    layer.appendChild(sWave);

    const startTime = performance.now();
    const Vp = 6.5;
    const Vs = 3.5;
    const scale = state.mapState.pixelsPerKm || 10;

    function loop(now) {
        const dt = (now - startTime) / 1000;
        if (dt > 30) {
            cancelAnimationFrame(animFrame);
            layer.innerHTML = '';
            return;
        }

        const rP = Math.max(0, Vp * dt * scale);
        const rS = Math.max(0, Vs * dt * scale);

        pWave.setAttribute("r", rP);
        sWave.setAttribute("r", rS);

        animFrame = requestAnimationFrame(loop);
    }

    animFrame = requestAnimationFrame(loop);
}


function simulateAlertFixed(level) {
    const selected = state.simulation.epicenter;
    const epicenter = (selected && selected.name) ? selected.name : 'Hualien';
    const epData = (selected && selected.lat) ? selected : REGIONS['Hualien'];

    if (!epData) { console.error("Epicenter data not found"); return; }

    const defaultData = level >= 5 ? { M: 7.2, depth: 10 } : { M: 4.5, depth: 20 };
    runSimulation(defaultData.M, defaultData.depth, epData);
}

function simulateRandomEarthquake() {
    const M = (Math.random() * 4.5 + 3.5).toFixed(1);
    const depth = Math.floor(Math.random() * 95 + 5);
    let epicenterInfo = state.simulation.epicenter;

    if (!epicenterInfo) {
        if (Math.random() < 0.3) {
            const zone = OFFSHORE_ZONES[Math.floor(Math.random() * OFFSHORE_ZONES.length)];
            epicenterInfo = { ...zone };
        } else {
            const keys = Object.keys(REGIONS);
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            epicenterInfo = { ...REGIONS[randomKey], name: randomKey };
        }
    }
    runSimulation(M, depth, epicenterInfo);
}

function runSimulation(M, depth, epicenterInfo) {
    resetAlert();

    const epicenterName = epicenterInfo.name || epicenterInfo;
    const epicenterData = (typeof epicenterInfo === 'string') ? REGIONS[epicenterInfo] : epicenterInfo;

    if (!epicenterData) return;
    state.isAlerting = true;

    startWaveAnimation(epicenterData.lat, epicenterData.lng);

    const layer = state.mapState.animLayer;
    const { x, y } = project(epicenterData.lat, epicenterData.lng);

    // Draw X marker for epicenter
    const crossSize = 12;
    const cross = document.createElementNS("http://www.w3.org/2000/svg", "g");
    cross.innerHTML = `
        <line x1="${x - crossSize}" y1="${y - crossSize}" x2="${x + crossSize}" y2="${y + crossSize}" stroke="red" stroke-width="3" vector-effect="non-scaling-stroke" />
        <line x1="${x + crossSize}" y1="${y - crossSize}" x2="${x - crossSize}" y2="${y + crossSize}" stroke="red" stroke-width="3" vector-effect="non-scaling-stroke" />
    `;
    layer.appendChild(cross);

    // Calc Intensity
    const mapData = {};
    let maxIntNum = 0;

    Object.keys(REGIONS).forEach(region => {
        const target = REGIONS[region];
        const distKm = Physics.getDistance(epicenterData.lat, epicenterData.lng, target.lat, target.lng);
        const pga = Physics.calculatePGA(M, distKm, depth, region);
        const intensityStr = Physics.pgaToIntensity(pga); // e.g., '5-minus'
        const intNum = Physics.intensityToNum(intensityStr);

        mapData[region] = intensityStr;
        if (intNum > maxIntNum) maxIntNum = intNum;
    });

    console.log('mapData:', mapData);
    console.log('REGIONS count:', Object.keys(REGIONS).length);
    updateMapIntensity(mapData);
    console.log('updateMapIntensity done');

    const userDist = Physics.getDistance(epicenterData.lat, epicenterData.lng, state.location.lat, state.location.lng);
    const userPga = Physics.calculatePGA(M, userDist, depth, state.location.name);
    const userIntStr = Physics.pgaToIntensity(userPga);
    const userIntNum = Physics.intensityToNum(userIntStr);

    const isEmergency = userIntNum >= 4;
    const typeClass = isEmergency ? 'type-danger' : 'type-warn';

    ui.alertBanner.classList.remove('hidden', 'type-warn', 'type-danger');
    ui.alertBanner.classList.add(typeClass);
    ui.alertTitle.textContent = isEmergency ? "緊急地震速報" : "地震速報";
    ui.alertMsg.textContent = `${epicenterName} 規模 ${M} (深 ${depth}km)`;
    ui.intensity.textContent = userIntStr.replace('-minus', '-').replace('-plus', '+');

    isEmergency ? startSiren() : playBeep();

    const sArrival = userDist / 3.5;
    const leadTime = Math.max(0, sArrival);
    let timeLeft = Math.floor(leadTime);
    ui.countdown.textContent = timeLeft > 0 ? timeLeft : "抵達";

    if (timeLeft > 0) {
        alertInterval = setInterval(() => {
            timeLeft--;
            ui.countdown.textContent = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(alertInterval);
                ui.countdown.textContent = "抵達";
            }
        }, 1000);
    }
}

function resetAlert() {
    state.isAlerting = false;
    ui.alertBanner.classList.add('hidden');
    stopSiren();
    document.querySelectorAll('path').forEach(p => p.className.baseVal = 'region');
    if (animFrame) cancelAnimationFrame(animFrame);
    if (state.mapState.animLayer) state.mapState.animLayer.innerHTML = '';
    if (typeof alertInterval !== 'undefined' && alertInterval) clearInterval(alertInterval);
    ui.systemStatus.textContent = "監測中";
}

// --- Real-time Geolocation ---
function startGeolocation() {
    if (!navigator.geolocation) {
        ui.userLocation.textContent = "不支援定位";
        return;
    }

    ui.userLocation.textContent = "定位中...";

    // Real-time watch
    navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            // Find nearest town
            const nearest = findNearestTown(lat, lng);
            if (nearest) {
                // Determine if we should update:
                // If user enters 'Manual Mode' toggle, maybe skip?
                // For now, "Real-time" implies we follow the user. 
                // We'll update state.location directly.

                state.location = { ...nearest };
                state.config.manualLoc = null; // Clear manual override if any

                // Update UI Dropdowns (visual only, avoid triggering events loop if possible)
                if (ui.countySelect) ui.countySelect.value = nearest.county;
                // We need to populate town select if county changed
                populateTownSelect(nearest.county);
                if (ui.townSelect) ui.townSelect.value = nearest.id;

                // Update Display (Marker + Text)
                ui.userLocation.textContent = `${nearest.county}${nearest.name}`;
                updateLocationDisplay();
            }
        },
        (error) => {
            console.error('Geolocation error:', error);
            // Don't show error continuously in UI if it's transient, but maybe once?
            if (error.code === 1) ui.userLocation.textContent = "定位未授權";
            else ui.userLocation.textContent = "定位失效";
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
}

function findNearestTown(lat, lng) {
    let minDist = Infinity;
    let closest = null;

    Object.values(REGIONS).forEach(region => {
        const d = Physics.getDistance(lat, lng, region.lat, region.lng);
        if (d < minDist) {
            minDist = d;
            closest = region;
        }
    });

    return closest;
}

init();
