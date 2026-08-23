/* ============================================================
   CAFE FO+REST — 共用 3D 地球元件
   純前端 SVG 正交投影，不需要任何地圖圖資或外部套件。

   用法：
     const globe = createGlobe(容器元素, 產區陣列, {
       onSelect: (產區) => {...},
       onZoom:   (倍率) => {...},
       onDragStart: () => {...}
     });
     globe.flyTo(產區id);
     globe.setZoom(1.4);
   ============================================================ */

function createGlobe(container, origins, opts = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const uid = Math.random().toString(36).slice(2);
  const TILT = -0.34;          // 固定俯視角
  const R_BASE = 150;
  const CX = 200, CY = 200;

  const state = { rotY: -0.4, zoom: 1, selected: null };
  const pointers = new Map();
  let pinchStartDist = null, pinchStartZoom = 1;

  container.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 400');
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.touchAction = 'none';
  svg.style.cursor = 'grab';
  svg.style.userSelect = 'none';
  container.appendChild(svg);

  // 淺色系球體：白 → 米白 → 淡灰的柔和漸層
  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = `
    <radialGradient id="sphere-${uid}" cx="36%" cy="30%" r="78%">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="45%"  stop-color="#F8F6F1"/>
      <stop offset="78%"  stop-color="#EDEAE2"/>
      <stop offset="100%" stop-color="#DCD8CE"/>
    </radialGradient>
    <radialGradient id="glow-${uid}" cx="50%" cy="50%" r="50%">
      <stop offset="62%"  stop-color="#C9A56B" stop-opacity="0"/>
      <stop offset="100%" stop-color="#C9A56B" stop-opacity="0.15"/>
    </radialGradient>`;
  svg.appendChild(defs);

  const halo = document.createElementNS(NS, 'circle');
  halo.setAttribute('cx', CX); halo.setAttribute('cy', CY);
  halo.setAttribute('fill', `url(#glow-${uid})`);
  svg.appendChild(halo);

  const sphere = document.createElementNS(NS, 'circle');
  sphere.setAttribute('cx', CX);
  sphere.setAttribute('cy', CY);
  sphere.setAttribute('fill', `url(#sphere-${uid})`);
  sphere.setAttribute('stroke', '#CFC9BB');
  sphere.setAttribute('stroke-width', '0.7');
  svg.appendChild(sphere);

  const gridGroup = document.createElementNS(NS, 'g');
  gridGroup.setAttribute('fill', 'none');
  gridGroup.setAttribute('stroke', '#B79A6A');
  svg.appendChild(gridGroup);

  const pinGroup = document.createElementNS(NS, 'g');
  svg.appendChild(pinGroup);

  function project(lat, lon) {
    const latR = lat * Math.PI / 180;
    const lonR = lon * Math.PI / 180 - state.rotY;
    const x0 = Math.cos(latR) * Math.sin(lonR);
    const z0 = Math.cos(latR) * Math.cos(lonR);
    const y0 = Math.sin(latR);
    const y1 = y0 * Math.cos(TILT) - z0 * Math.sin(TILT);
    const z1 = y0 * Math.sin(TILT) + z0 * Math.cos(TILT);
    const R = R_BASE * state.zoom;
    return { x: CX + x0 * R, y: CY - y1 * R, z: z1, visible: z1 > -0.06 };
  }

  function renderGrid() {
    gridGroup.innerHTML = '';
    const R = R_BASE * state.zoom;
    sphere.setAttribute('r', R);
    halo.setAttribute('r', R * 1.1);

    for (let lon = 0; lon < 360; lon += 30) {
      const rel = (((lon * Math.PI / 180 - state.rotY) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const rx = Math.abs(Math.sin(rel)) * R;
      const front = Math.cos(rel) > 0;
      if (rx < 1.2) continue;
      const el = document.createElementNS(NS, 'ellipse');
      el.setAttribute('cx', CX); el.setAttribute('cy', CY);
      el.setAttribute('rx', rx); el.setAttribute('ry', R);
      el.setAttribute('stroke-width', '0.5');
      el.setAttribute('opacity', front ? 0.38 : 0.13);
      gridGroup.appendChild(el);
    }
    [-60, -30, 0, 30, 60].forEach(lat => {
      const latR = lat * Math.PI / 180;
      const ry = Math.abs(Math.cos(latR)) * R;
      const cy2 = CY - Math.sin(latR) * Math.cos(TILT) * R;
      const el = document.createElementNS(NS, 'ellipse');
      el.setAttribute('cx', CX); el.setAttribute('cy', cy2);
      el.setAttribute('rx', R); el.setAttribute('ry', ry * 0.34);
      el.setAttribute('stroke-width', '0.4');
      el.setAttribute('opacity', '0.2');
      gridGroup.appendChild(el);
    });
  }

  function renderPins() {
    pinGroup.innerHTML = '';
    origins.forEach(o => {
      if (o.lat === null || o.lon === null || o.lat === undefined || o.lon === undefined) return;
      const p = project(Number(o.lat), Number(o.lon));
      if (!p.visible) return;
      const scale = 0.5 + 0.5 * Math.max(0, p.z);
      const isSel = state.selected === o.id;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${p.x},${p.y}) scale(${scale})`);
      g.style.cursor = 'pointer';
      g.innerHTML = (isSel ? `
        <circle r="7" fill="none" stroke="#A9803F" stroke-width="1.4" opacity="0.6">
          <animate attributeName="r" values="6;16;6" dur="1.9s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.55;0;0.55" dur="1.9s" repeatCount="indefinite"/>
        </circle>` : '') +
        `<circle r="5" fill="${isSel ? '#A9803F' : '#7C5A3A'}" stroke="#FFFFFF" stroke-width="1.6"/>`;
      g.addEventListener('click', e => { e.stopPropagation(); flyTo(o.id); });
      pinGroup.appendChild(g);
    });
  }

  function renderAll() { renderGrid(); renderPins(); }

  function flyTo(id) {
    const o = origins.find(x => x.id === id);
    if (!o) return;
    state.selected = id;
    const target = Number(o.lon) * Math.PI / 180;
    const start = state.rotY;
    let diff = target - start;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const t0 = performance.now(), dur = 620;
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      state.rotY = start + diff * ease;
      renderAll();
      if (p < 1) requestAnimationFrame(step);
    })(t0);
    if (opts.onSelect) opts.onSelect(o);
  }

  function setZoom(z) {
    state.zoom = Math.min(2.4, Math.max(0.7, z));
    renderAll();
    if (opts.onZoom) opts.onZoom(state.zoom);
  }

  /* ---- 拖曳旋轉與縮放 ---- */
  let dragging = false, lastX = 0;

  svg.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, e);
    if (pointers.size === 1) { dragging = true; lastX = e.clientX; svg.style.cursor = 'grabbing'; }
    if (pointers.size === 2) {
      dragging = false;
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      pinchStartZoom = state.zoom;
    }
    svg.setPointerCapture(e.pointerId);
    if (opts.onDragStart) opts.onDragStart();
  });

  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      if (pinchStartDist) setZoom(pinchStartZoom * (dist / pinchStartDist));
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX; lastX = e.clientX;
    // 放大後轉慢一點，比較好對準小產區
    state.rotY -= dx * 0.008 / Math.max(0.8, state.zoom);
    renderAll();
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt =>
    svg.addEventListener(evt, e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStartDist = null;
      if (pointers.size === 0) { dragging = false; svg.style.cursor = 'grab'; }
    })
  );

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(state.zoom - e.deltaY * 0.0012);
  }, { passive: false });

  renderAll();

  return { flyTo, setZoom, getZoom: () => state.zoom, refresh: renderAll };
}
