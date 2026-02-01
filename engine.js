import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // ---------- Settings & State ----------
    let SPEED = config.speed || 0.4;
    let targetFishCount = config.fishCount || 1350;
    const settings = { gain: config.gain || 1.0 };

    audio.setGain(settings.gain);

    let W = innerWidth, H = innerHeight, DPR = 1;
    const pointer = { x: W * 0.5, y: H * 0.5, vx: 0, vy: 0, lastT: performance.now(), idle: 0 };
    const fish = [];
    const bubbles = [];
    let bubbleAcc = 0;
    const flowParticles = [];
    const godRays = [];
    const snow = [];
    const currentLines = [];
    let densityGlow = 0;

    // ---------- Utilities ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const clamp01 = v => clamp(v, 0, 1);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const easeOut = t => 1 - Math.pow(1 - t, 3);

    function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    function valueNoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const u = smoothstep(x - xi), v = smoothstep(y - yi);
        return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
    }
    function fbm(x, y) {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) { f += amp * valueNoise(x * freq, y * freq); amp *= 0.5; freq *= 2; }
        return f;
    }

    // ---------- HUD Controls ----------
    const spdVal = document.getElementById('spdVal');
    const cntVal = document.getElementById('cntVal');
    const spdMinus = document.getElementById('spdMinus');
    const spdPlus = document.getElementById('spdPlus');
    const cntMinus = document.getElementById('cntMinus');
    const cntPlus = document.getElementById('cntPlus');
    const sndBtn = document.getElementById('snd');

    function updateHud() {
        if (spdVal) spdVal.textContent = SPEED.toFixed(2) + '×';
        if (cntVal) cntVal.textContent = String(targetFishCount);
    }

    if (spdMinus) spdMinus.onclick = () => { SPEED = clamp(SPEED / 1.12, 0.25, 4.0); updateHud(); };
    if (spdPlus) spdPlus.onclick = () => { SPEED = clamp(SPEED * 1.12, 0.25, 4.0); updateHud(); };
    if (cntMinus) cntMinus.onclick = () => { targetFishCount = clamp(targetFishCount - 150, 200, 2000); updateHud(); };
    if (cntPlus) cntPlus.onclick = () => { targetFishCount = clamp(targetFishCount + 150, 200, 2000); updateHud(); };
    if (sndBtn) {
        sndBtn.onclick = () => {
            audio.enabled = !audio.enabled;
            sndBtn.textContent = audio.enabled ? '🔊' : '🔇';
            audio.playClick();
        };
        sndBtn.textContent = audio.enabled ? '🔊' : '🔇';
    }
    updateHud();

    // ---------- Resize & Spatial ----------
    const cellSize = 100;
    let gridW, gridH, grid;
    function initSpatial() {
        gridW = Math.ceil(W / cellSize); gridH = Math.ceil(H / cellSize);
        grid = new Array(gridW * gridH).fill(0).map(() => []);
    }
    function resize() {
        DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = innerWidth; H = innerHeight;
        canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        initSpatial(); initSnow(); initGodRays(); initSubSchools(); initCurrentLines();
    }
    window.addEventListener('resize', resize, { passive: true });

    // ---------- Interaction ----------
    const hint = document.getElementById('hint');
    window.addEventListener('pointermove', (e) => {
        const now = performance.now(), dt = Math.max(1, now - pointer.lastT);
        pointer.vx = (e.clientX - pointer.x) / dt; pointer.vy = (e.clientY - pointer.y) / dt;
        pointer.x = e.clientX; pointer.y = e.clientY; pointer.lastT = now; pointer.idle = 0;
        if (hint) hint.classList.add('off');
    }, { passive: true });

    // ---------- Fish System ----------
    function spawnFish(count) {
        const silverTypes = [{ baseHue: 204, satRange: [6, 18] }, { baseHue: 212, satRange: [8, 22] }, { baseHue: 196, satRange: [4, 16] }];
        for (let i = 0; i < count; i++) {
            const roll = Math.random(), isColorful = roll < 0.04, isLarge = roll >= 0.04 && roll < 0.11;
            const colorType = isColorful ? { baseHue: 35, satRange: [40, 60] } : silverTypes[randInt(0, 2)];
            const f = {
                x: Math.random() * W, y: Math.random() * H, vx: rand(-1, 1), vy: rand(-1, 1),
                size: isLarge ? rand(5.0, 8.0) : rand(3.4, 5.2), isLarge, isColorful,
                baseHue: colorType.baseHue + rand(-6, 6), baseSatMin: colorType.satRange[0], baseSatMax: colorType.satRange[1],
                phase: rand(0, 1000), bodyTone: rand(-6, 6), currentAngle: 0, angleSmoothing: rand(0.04, 0.07),
                bodyPhase: Math.random() * Math.PI * 2, bodyWaveSpeed: rand(0.009, 0.014), scaleShimmer: rand(0.85, 1.15),
                breakout: 0, wander: rand(0.8, 1.2), hueSeed: Math.random()
            };
            assignDepthLayer(f); fish.push(f);
        }
    }

    function assignDepthLayer(f) {
        const r = Math.random();
        if (r < 0.15) { f.depthLayer = 'foreground'; f.depthScale = rand(1.18, 1.35); f.depthAlpha = 1.0; }
        else if (r < 0.85) { f.depthLayer = 'midground'; f.depthScale = rand(0.92, 1.08); f.depthAlpha = rand(0.8, 1.0); }
        else { f.depthLayer = 'background'; f.depthScale = rand(0.65, 0.82); f.depthAlpha = rand(0.4, 0.62); }
    }

    function drawFish(f, t) {
        const dx = f.x - pointer.x, dy = f.y - pointer.y, d = Math.max(1, Math.hypot(dx, dy));
        const near = 1 - Math.min(1, d / (Math.min(W, H) * 0.65)), nearP = Math.pow(near, 0.6), spd = Math.hypot(f.vx, f.vy);
        const hue = f.baseHue + f.bodyTone + Math.sin(t * 0.0008 + f.phase) * 3;
        const sat = lerp(f.baseSatMin, f.baseSatMax + (f.isColorful ? 25 : 10), nearP) + spd * 2.2;
        const flash = migration.flashIntensity * 22 * (0.5 + Math.random() * 0.5);
        const lit = lerp(36, 64, nearP) + flash + f.bodyTone * 0.5 + (f.isColorful ? 6 : 0);
        const alpha = lerp(0.25, 0.96, Math.pow(near, 0.5)) * f.depthAlpha;
        const targetA = Math.atan2(f.vy, f.vx); let aDiff = targetA - f.currentAngle;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2; while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.currentAngle += aDiff * f.angleSmoothing; const ang = f.currentAngle, s = f.size * f.depthScale;
        f.bodyPhase += f.bodyWaveSpeed * (1 + spd * 0.45); const bW = Math.sin(f.bodyPhase) * 0.09 * (1 + spd * 0.25), tailS = Math.sin(f.bodyPhase - 0.75) * (0.2 + spd * 0.15);

        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(ang);
        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, `hsla(${hue + 4},${sat + 4}%,${lit - 22}%,${alpha})`); grad.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 4}%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue - 2},${sat}%,${lit + 12}%,${alpha})`); grad.addColorStop(1, `hsla(${hue - 6},${sat - 6}%,${lit + 6}%,${alpha * 0.9})`);
        ctx.fillStyle = grad; const w1 = bW * s * 0.5, w2 = bW * s * 0.82;
        ctx.beginPath(); ctx.moveTo(s * 2.3, 0); ctx.quadraticCurveTo(s * 1.25, -s * 0.78 + w1, -s * 0.85, -s * 0.62 + w2);
        ctx.quadraticCurveTo(-s * 2.1, -s * 0.12 + w2 * 0.4, -s * 2.35, w2 * 0.25); ctx.quadraticCurveTo(-s * 2.1, s * 0.12 + w2 * 0.4, -s * 0.85, s * 0.62 + w2);
        ctx.quadraticCurveTo(s * 1.25, s * 0.78 + w1, s * 2.3, 0); ctx.fill();

        ctx.fillStyle = `hsla(${hue},${sat}%,${lit - 10}%,${alpha * 0.85})`; ctx.beginPath(); const tBase = w2 * 0.3;
        ctx.moveTo(-s * 2.2, tBase); ctx.quadraticCurveTo(-s * 2.6, -s * 0.35 + tailS * s + tBase, -s * 3.1, -s * 0.75 + tailS * s + tBase);
        ctx.quadraticCurveTo(-s * 2.7, tailS * s * 0.2 + tBase, -s * 3.1, s * 0.75 + tailS * s + tBase); ctx.quadraticCurveTo(-s * 2.6, s * 0.35 + tailS * s + tBase, -s * 2.2, tBase); ctx.fill();

        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = alpha * (0.15 + nearP * 0.4) * f.scaleShimmer;
        const shm = ctx.createLinearGradient(-s * 1.6, 0, s * 1.9, 0); shm.addColorStop(0, 'rgba(255,255,255,0)'); shm.addColorStop(0.5, 'rgba(255,255,255,0.8)'); shm.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = shm; ctx.lineWidth = s * 0.15; ctx.beginPath(); ctx.moveTo(s * 1.85, -s * 0.05 + w1 * 0.25); ctx.quadraticCurveTo(s * 0.5, -s * 0.2 + w1 * 0.3, -s * 1.6, -s * 0.08 + w2 * 0.3); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';

        if (s > 3.0) {
            ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = 'rgba(235,245,255,0.85)'; const eS = s * 0.12;
            ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.08, eS, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(10,20,30,0.95)'; ctx.beginPath(); ctx.arc(s * 1.64, -s * 0.08, eS * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // ---------- Migration ----------
    const migration = {
        angle: Math.random() * Math.PI * 2, targetAngle: Math.random() * Math.PI * 2, strength: 0.16, breathPhase: 0, breathSpeed: 0.0008,
        waveOrigin: { x: W * 0.5, y: H * 0.5 }, waveTime: 0, speedPhase: 0, speedMod: 1.0, centerX: W * 0.5, centerY: H * 0.5, flashIntensity: 0
    };
    const subSchools = [];
    function initSubSchools() {
        subSchools.length = 0; for (let i = 0; i < 4; i++) subSchools.push({ x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.8), vx: rand(-0.25, 0.25), vy: rand(-0.25, 0.25), radius: rand(180, 320), strength: rand(0.35, 0.65), phase: rand(0, Math.PI * 2) });
    }
    function updateMigration(dt, t) {
        if (Math.random() < 0.0012) migration.targetAngle = Math.random() * Math.PI * 2;
        let diff = migration.targetAngle - migration.angle; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        migration.angle += diff * 0.0025 * dt * 0.06; migration.flashIntensity = Math.abs(diff) > 0.32 ? Math.min(1, migration.flashIntensity + dt * 0.0022) : migration.flashIntensity * 0.985;
        migration.breathPhase += migration.breathSpeed * dt; migration.speedPhase += dt * 0.00035; migration.speedMod = 0.72 + 0.32 * Math.sin(migration.speedPhase); migration.waveTime += dt * 0.0022;
        if (fish.length > 0) {
            let cx = 0, cy = 0; for (const f of fish) { cx += f.x; cy += f.y; }
            migration.centerX = lerp(migration.centerX, cx / fish.length, 0.025); migration.centerY = lerp(migration.centerY, cy / fish.length, 0.025);
        }
    }

    // ---------- Rendering Extras ----------
    function initSnow() {
        snow.length = 0; for (let i = 0; i < 180; i++) snow.push({ x: Math.random() * W, y: Math.random() * H, z: rand(0.35, 1.0), vx: rand(-0.15, 0.15), vy: rand(0.15, 0.45), r: rand(0.6, 2.2), a: rand(0.08, 0.18) });
    }
    function initGodRays() {
        godRays.length = 0; for (let i = 0; i < 5; i++) godRays.push({ x: rand(W * 0.1, W * 0.9), width: rand(120, 240), speed: rand(0.008, 0.015), phase: rand(0, Math.PI * 2), alpha: rand(0.03, 0.06), drift: rand(-0.02, 0.02) });
    }
    function initCurrentLines() {
        currentLines.length = 0; for (let i = 0; i < 12; i++) currentLines.push({ y: rand(H * 0.1, H * 0.9), phase: rand(0, Math.PI * 2), speed: rand(0.0001, 0.0003), width: rand(1, 2) });
    }

    function drawBackground(t) {
        ctx.fillStyle = '#061a28'; ctx.fillRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#061a28'); g.addColorStop(0.48, '#04121d'); g.addColorStop(1, '#02070e'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    function drawGodRays(t) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) {
            r.x += r.drift; if (r.x < -r.width) r.x = W + r.width; if (r.x > W + r.width) r.x = -r.width;
            const pulse = 0.75 + 0.25 * Math.sin(t * r.speed + r.phase); ctx.globalAlpha = r.alpha * pulse;
            const g = ctx.createLinearGradient(r.x, 0, r.x, H); g.addColorStop(0, 'rgba(215,240,255,0.4)'); g.addColorStop(1, 'rgba(160,200,240,0)'); ctx.fillStyle = g;
            const tw = r.width * 0.65, bw = r.width * 1.9; ctx.beginPath(); ctx.moveTo(r.x - tw * 0.5, 0); ctx.lineTo(r.x + tw * 0.5, 0); ctx.lineTo(r.x + bw * 0.5, H); ctx.lineTo(r.x - bw * 0.5, H); ctx.fill();
        }
        ctx.restore();
    }
    function drawCurrentLines(t) {
        ctx.save(); ctx.globalAlpha = 0.04; ctx.strokeStyle = '#fff'; for (const l of currentLines) {
            const shift = t * l.speed; ctx.lineWidth = l.width; ctx.beginPath(); for (let x = -50; x < W + 50; x += 100) { const y = l.y + Math.sin(x * 0.003 + l.phase + shift) * 20; if (x === -50) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
            ctx.stroke();
        } ctx.restore();
    }
    function drawThermalCore(t) {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 280); g.addColorStop(0, 'rgba(100,200,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 280, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    function drawDensityGlow() {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; const g = ctx.createRadialGradient(migration.centerX, migration.centerY, 0, migration.centerX, migration.centerY, 450); g.addColorStop(0, `rgba(140,220,255,${0.08 * densityGlow})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(migration.centerX, migration.centerY, 450, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // ---------- Simulation Core ----------
    function step(dt, t) {
        updateMigration(dt, t); rebuildGrid(fish);
        const speedFactor = SPEED, accel = 0.145, dragBase = 0.945;
        let avgNeighbors = 0;

        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; if (f.breakout > 0) f.breakout -= dt; else if (Math.random() < 0.0006) f.breakout = rand(300, 900);
            let ax = 0, ay = 0, avx = 0, avy = 0, cox = 0, coy = 0, sepX = 0, sepY = 0, count = 0;
            const cx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), cy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            for (let oy = -1; oy <= 1; oy++) {
                const yy = cy + oy; if (yy < 0 || yy >= gridH) continue;
                for (let ox = -1; ox <= 1; ox++) {
                    const xx = cx + ox; if (xx < 0 || xx >= gridW) continue;
                    const cell = grid[yy * gridW + xx]; for (let k = 0; k < cell.length; k++) {
                        const j = cell[k]; if (j === i) continue; const o = fish[j], dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
                        if (d2 > 65 * 65) continue; const d = Math.sqrt(d2) + 0.001; avx += o.vx; avy += o.vy; cox += o.x; coy += o.y;
                        const sR = f.isLarge ? 48 : 28; if (d < sR) { const p = (sR - d) / sR; sepX -= (dx / d) * p; sepY -= (dy / d) * p; }
                        count++; if (count >= 18) break;
                    } if (count >= 18) break;
                } if (count >= 18) break;
            }
            if (count > 0) { const inv = 1 / count; ax += (avx * inv - f.vx) * 0.38 + (cox * inv - f.x) * 0.00015 + sepX * 0.98; ay += (avy * inv - f.vy) * 0.38 + (coy * inv - f.y) * 0.00015 + sepY * 0.98; }
            const pdx = pointer.x - f.x, pdy = pointer.y - f.y, dist = Math.max(1, Math.hypot(pdx, pdy));
            const heat = Math.exp(-dist / 620) * 0.75 + 0.38 * Math.max(0, 1 - dist / Math.max(W, H));
            const pB = dist < 260 ? (1 + (260 - dist) / 85) : 1; ax += (pdx / dist) * heat * 4.6 * pB; ay += (pdy / dist) * heat * 4.6 * pB;
            ax += Math.cos(migration.angle) * migration.strength * 0.35; ay += Math.sin(migration.angle) * migration.strength * 0.35;
            const n = fbm(f.x * 0.004 + t * 0.00008, f.y * 0.004 + t * 0.00006); f.phase += dt * 0.0022; const wig = (Math.sin(f.phase + f.hueSeed * 6.28) + (n - 0.5)) * 0.2 * f.wander;
            ax += wig; ay -= wig * 0.65;
            const drag = dragBase + (f.isLarge ? -0.006 : 0.012); f.vx = (f.vx + ax * dt * accel * speedFactor * migration.speedMod) * drag; f.vy = (f.vy + ay * dt * accel * speedFactor * migration.speedMod) * drag;
            const v = Math.hypot(f.vx, f.vy), vLim = (f.isLarge ? 17 : 19) * speedFactor * (dist < 380 ? 2 : 1);
            if (v > vLim) { f.vx = (f.vx / v) * vLim; f.vy = (f.vy / v) * vLim; }
            f.x += f.vx * dt * 0.105; f.y += f.vy * dt * 0.105;
            if (f.x < -70) f.x = W + 70; else if (f.x > W + 70) f.x = -70; if (f.y < -70) f.y = H + 70; else if (f.y > H + 70) f.y = -70;
            avgNeighbors += count;
        }
        densityGlow = lerp(densityGlow, (avgNeighbors / fish.length) > 6 ? 1 : 0, 0.05);
        if (fish.length !== targetFishCount) reconcileFishCount();
    }

    function reconcileFishCount() {
        const d = targetFishCount - fish.length;
        if (d > 0) spawnFish(Math.min(d, 50)); else if (d < 0) fish.splice(0, Math.min(-d, 50));
    }

    // ---------- Main Boot ----------
    resize(); spawnFish(targetFishCount);
    let lastT = performance.now();
    function frame() {
        const t = performance.now(); const dt = Math.min(60, t - lastT); lastT = t;
        drawBackground(t); drawGodRays(t); drawCurrentLines(t); drawThermalCore(t); drawDensityGlow();
        for (const s of snow) {
            s.x += s.vx * s.z + Math.sin(t * 0.001 + s.y) * 0.1; s.y += s.vy * s.z;
            if (s.x < -20) s.x = W + 20; if (s.x > W + 20) s.x = -20; if (s.y > H + 20) s.y = -20;
            ctx.globalAlpha = s.a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2); ctx.fill();
        }
        step(dt, t);
        const depthOrder = ['background', 'midground', 'foreground'];
        for (const layer of depthOrder) {
            for (let pass = 0; pass < 2; pass++) {
                for (const f of fish) if (f.depthLayer === layer && f.isLarge === (pass === 1)) drawFish(f, t);
            }
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
