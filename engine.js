import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // 1. 设置与状态 (根层级)
    let SPEED = config.speed || 0.4;
    let targetFishCount = config.fishCount || 1350;
    const settings = { gain: config.gain || 1.0 };
    audio.setGain(settings.gain);

    let W = window.innerWidth, H = window.innerHeight;
    const pointer = { x: W * 0.5, y: H * 0.5, vx: 0, vy: 0, lastT: performance.now() };
    const fish = [];
    const bubbles = [];
    let bubbleAcc = 0;
    const snow = [];
    const godRays = [];
    const currentLines = [];
    let densityGlow = 0;
    const cellSize = 100;
    let gridW, gridH, grid;

    // 2. 工具函数
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const hash2 = (x, y) => {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    };
    const valueNoise = (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
        const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
        return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
    };
    const fbm = (x, y) => {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) { f += amp * valueNoise(x * freq, y * freq); amp *= 0.5; freq *= 2; }
        return f;
    };

    // 3. 渲染组件
    function drawFish(f, t) {
        const dx = f.x - pointer.x, dy = f.y - pointer.y, dist = Math.max(1, Math.hypot(dx, dy));
        const near = 1 - Math.min(1, dist / (Math.min(W, H) * 0.65)), nearP = Math.pow(near, 0.6);
        const spd = Math.hypot(f.vx, f.vy);
        const hue = f.h + f.tone + Math.sin(t * 0.0008 + f.ph) * 3;
        const sat = lerp(f.sMin, f.sMax + (f.isCol ? 25 : 10), nearP) + spd * 2.2;
        const flash = migration.flashIntensity * 22 * (0.5 + Math.random() * 0.5);
        const lit = lerp(36, 64, nearP) + flash + f.tone * 0.5 + (f.isCol ? 6 : 0);
        const alpha = lerp(0.25, 0.96, Math.pow(near, 0.5)) * f.lA;
        let targetA = Math.atan2(f.vy, f.vx), aDiff = targetA - f.ang;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2; while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.ang += aDiff * 0.05;
        f.bodyPh += 0.012 * (1 + spd * 0.45);
        const bW = Math.sin(f.bodyPh) * 0.09 * (1 + spd * 0.25), tS = Math.sin(f.bodyPh - 0.75) * (0.2 + spd * 0.15), s = f.sz * f.lS;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, `hsla(${hue + 4},${sat + 4}%,${lit - 22}%,${alpha})`); grad.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 4}%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue - 2},${sat}%,${lit + 12}%,${alpha})`); grad.addColorStop(1, `hsla(${hue - 6},${sat - 6}%,${lit + 6}%,${alpha * 0.9})`);
        ctx.fillStyle = grad; const w1 = bW * s * 0.5, w2 = bW * s * 0.82;
        ctx.beginPath(); ctx.moveTo(s * 2.3, 0); ctx.quadraticCurveTo(s * 1.25, -s * 0.78 + w1, -s * 0.85, -s * 0.62 + w2);
        ctx.quadraticCurveTo(-s * 2.1, -s * 0.12 + w2 * 0.4, -s * 2.35, w2 * 0.25); ctx.quadraticCurveTo(-s * 2.1, s * 0.12 + w2 * 0.4, -s * 0.85, s * 0.62 + w2);
        ctx.quadraticCurveTo(s * 1.25, s * 0.78 + w1, s * 2.3, 0); ctx.fill();
        ctx.fillStyle = `hsla(${hue},${sat}%,${lit - 10}%,${alpha * 0.85})`; ctx.beginPath(); const tBase = w2 * 0.3;
        ctx.moveTo(-s * 2.2, tBase); ctx.quadraticCurveTo(-s * 2.6, -s * 0.35 + tS * s + tBase, -s * 3.1, -s * 0.75 + tS * s + tBase);
        ctx.quadraticCurveTo(-s * 2.7, tS * s * 0.2 + tBase, -s * 3.1, s * 0.75 + tS * s + tBase); ctx.quadraticCurveTo(-s * 2.6, s * 0.35 + tS * s + tBase, -s * 2.2, tB); ctx.fill();
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = alpha * (0.15 + nearP * 0.4) * f.shm;
        const shmG = ctx.createLinearGradient(-s * 1.6, 0, s * 1.9, 0); shmG.addColorStop(0, 'rgba(255,255,255,0)'); shmG.addColorStop(0.5, 'rgba(255,255,255,0.8)'); shmG.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = shmG; ctx.lineWidth = s * 0.15; ctx.beginPath(); ctx.moveTo(s * 1.85, -s * 0.05 + w1 * 0.25); ctx.quadraticCurveTo(s * 0.5, -s * 0.2 + w1 * 0.3, -s * 1.6, -s * 0.08 + w2 * 0.3); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        if (s > 3.0) { ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.08, s * 0.12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(s * 1.64, -s * 0.08, s * 0.06, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }

    // 4. 初始化逻辑
    function spawn(count) {
        const silvers = [{ h: 204, s: [6, 18] }, { h: 212, s: [8, 22] }];
        for (let i = 0; i < count; i++) {
            const roll = Math.random(), isCol = roll < 0.04, isLarge = roll >= 0.04 && roll < 0.11;
            const t = isCol ? { h: 35, s: [40, 60] } : silvers[Math.floor(Math.random() * silvers.length)];
            const f = {
                x: Math.random() * W, y: Math.random() * H, vx: Math.random() * 2 - 1, vy: Math.random() * 2 - 1,
                sz: isLarge ? 6.5 : 4.2, isLarge, isCol, h: t.h, sMin: t.s[0], sMax: t.s[1],
                ph: Math.random() * 1000, tone: Math.random() * 10 - 5, ang: 0, bodyPh: Math.random() * 10,
                shm: 0.9 + Math.random() * 0.2, breakout: 0, wander: 1, hSeed: Math.random()
            };
            const r = Math.random();
            if (r < 0.15) { f.ly = 'fg'; f.lS = 1.25; f.lA = 1.0; } else if (r < 0.85) { f.ly = 'mg'; f.lS = 1.0; f.lA = 0.9; } else { f.ly = 'bg'; f.lS = 0.75; f.lA = 0.5; }
            fish.push(f);
        }
    }

    // 5. 模拟与循环
    const migration = { angle: 0, targetAngle: 0, strength: 0.16, flashIntensity: 0, centerX: W * 0.5, centerY: H * 0.5 };
    function initSystems() {
        gridW = Math.ceil(W / 100); gridH = Math.ceil(H / 100); grid = new Array(gridW * gridH).fill(0).map(() => []);
        snow.length = 0; for (let i = 0; i < 100; i++) snow.push({ x: rand(0, W), y: rand(0, H), z: rand(0.4, 1), vx: rand(-0.1, 0.1), vy: rand(0.2, 0.4), a: rand(0.1, 0.2), r: rand(1, 2) });
        godRays.length = 0; for (let i = 0; i < 4; i++) godRays.push({ x: rand(0, W), w: rand(100, 200), a: rand(0.02, 0.04) });
    }

    function step(dt, t) {
        if (Math.random() < 0.001) migration.targetAngle = Math.random() * Math.PI * 2;
        let d = migration.targetAngle - migration.angle; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        migration.angle += d * 0.05; migration.flashIntensity = Math.abs(d) > 0.3 ? 1 : migration.flashIntensity * 0.95;
        for (let i = 0; i < grid.length; i++) grid[i].length = 0;
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; const gx = clamp(Math.floor(f.x / 100), 0, gridW - 1), gy = clamp(Math.floor(f.y / 100), 0, gridH - 1);
            grid[gy * gridW + gx].push(i);
        }
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; let ax = 0, ay = 0, count = 0;
            const gx = clamp(Math.floor(f.x / 100), 0, gridW - 1), gy = clamp(Math.floor(f.y / 100), 0, gridH - 1);
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                const yy = gy + oy, xx = gx + ox; if (yy >= 0 && yy < gridH && xx >= 0 && xx < gridW) {
                    for (const idx of grid[yy * gridW + xx]) {
                        if (idx === i) continue;
                        const o = fish[idx], dx = o.x - f.x, dy = o.y - f.y, dist2 = dx * dx + dy * dy;
                        if (dist2 < 2500) { ax += (o.vx - f.vx) * 0.4; ay += (o.vy - f.vy) * 0.4; count++; }
                    }
                }
            }
            const dxP = pointer.x - f.x, dyP = pointer.y - f.y, distP = Math.max(1, Math.hypot(dxP, dyP));
            const heat = Math.exp(-distP / 500); ax += (dxP / distP) * heat * 5; ay += (dyP / distP) * heat * 5;
            ax += Math.cos(migration.angle) * 0.2; ay += Math.sin(migration.angle) * 0.2;
            f.vx = (f.vx + ax * 0.1 * SPEED) * 0.94; f.vy = (f.vy + ay * 0.1 * SPEED) * 0.94;
            f.x += f.vx; f.y += f.vy;
            if (f.x < -100) f.x = W + 100; if (f.x > W + 100) f.x = -100; if (f.y < -100) f.y = H + 100; if (f.y > H + 100) f.y = -100;
        }
        if (fish.length < targetFishCount) spawn(Math.min(20, targetFishCount - fish.length));
    }

    // 6. HUD绑定
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('spdMinus', () => SPEED = clamp(SPEED / 1.2, 0.1, 4)); bind('spdPlus', () => SPEED = clamp(SPEED * 1.2, 0.1, 4));
    bind('cntMinus', () => targetFishCount = clamp(targetFishCount - 200, 200, 2000)); bind('cntPlus', () => targetFishCount = clamp(targetFishCount + 200, 200, 2000));
    bind('snd', () => { audio.enabled = !audio.enabled; const b = document.getElementById('snd'); if (b) b.textContent = audio.enabled ? '🔊' : '🔇'; });

    // 7. 启动
    const pointerMove = (e) => {
        const now = performance.now(), dt = Math.max(1, now - pointer.lastT);
        pointer.vx = (e.clientX - pointer.x) / dt; pointer.vy = (e.clientY - pointer.y) / dt;
        pointer.x = e.clientX; pointer.y = e.clientY; pointer.lastT = now;
        const h = document.getElementById('hint'); if (h) h.classList.add('off');
    };
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('resize', resize);

    resize(); initSystems(); spawn(targetFishCount);

    function frame() {
        const t = performance.now();
        ctx.fillStyle = '#061a28'; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) { ctx.globalAlpha = r.a; ctx.fillStyle = 'white'; ctx.fillRect(r.x, 0, r.w, H); } ctx.restore();
        step(16, t);
        for (const s of snow) { s.y += s.vy; if (s.y > H) s.y = 0; ctx.globalAlpha = s.a; ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2); ctx.fill(); }
        const lys = ['bg', 'mg', 'fg']; for (const ly of lys) for (const f of fish) if (f.ly === ly) drawFish(f, t);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
