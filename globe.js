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

/* 各大洲簡化輪廓，格式為 [經度, 緯度]。
   刻意精簡到只保留可辨識的形狀，讓線稿風格保持乾淨。 */
const LAND = [
  // 歐亞大陸
  [[-9,39],[-9,43],[-1,46],[0,49],[4,53],[8,56],[5,59],[11,64],[16,69],[28,71],
   [40,67],[55,68],[70,73],[80,74],[105,78],[113,74],[130,72],[145,72],[160,70],
   [170,69],[180,66],[170,60],[160,60],[155,52],[140,55],[135,48],[130,43],
   [127,38],[122,31],[110,21],[105,10],[100,8],[95,16],[88,21],[80,10],[72,20],
   [65,25],[57,25],[50,30],[57,22],[52,16],[43,13],[39,21],[34,28],[35,36],
   [30,37],[27,40],[23,40],[19,42],[13,45],[12,44],[5,43],[3,42],[-2,43],[-9,43]],
  // 非洲
  [[-6,36],[10,37],[20,32],[32,31],[37,22],[43,12],[51,12],[42,-1],[40,-10],
   [35,-20],[33,-26],[28,-33],[18,-34],[12,-23],[12,-9],[9,0],[6,4],[0,5],
   [-8,5],[-11,7],[-17,15],[-16,21],[-13,27],[-10,30],[-6,36]],
  // 北美洲
  [[-165,66],[-155,71],[-130,70],[-115,69],[-95,68],[-85,70],[-80,63],[-78,57],
   [-65,60],[-56,52],[-66,45],[-70,42],[-75,38],[-81,31],[-80,25],[-84,30],
   [-94,29],[-97,26],[-97,20],[-92,18],[-88,17],[-83,9],[-95,16],[-105,20],
   [-110,24],[-117,32],[-124,40],[-124,48],[-135,57],[-150,60],[-165,66]],
  // 南美洲
  [[-77,8],[-72,11],[-62,10],[-52,5],[-50,0],[-44,-2],[-38,-5],[-35,-8],
   [-39,-13],[-48,-25],[-53,-34],[-58,-38],[-62,-40],[-65,-45],[-68,-52],
   [-74,-52],[-73,-45],[-73,-37],[-71,-30],[-70,-20],[-77,-12],[-81,-6],
   [-80,0],[-77,4],[-77,8]],
  // 澳洲
  [[115,-22],[114,-26],[118,-34],[129,-32],[137,-35],[140,-38],[146,-39],
   [150,-37],[153,-28],[153,-25],[146,-19],[142,-11],[135,-12],[130,-11],
   [125,-14],[120,-20],[115,-22]],
  // 格陵蘭
  [[-45,60],[-52,64],[-55,68],[-60,76],[-45,83],[-25,82],[-20,76],[-22,70],
   [-38,66],[-45,60]],
  // 日本
  [[130,31],[135,34],[140,36],[142,42],[145,44],[140,40],[136,36],[132,33],[130,31]],
  // 馬達加斯加
  [[44,-16],[50,-15],[50,-25],[45,-25],[43,-21],[44,-16]],
  // 英國
  [[-5,50],[-3,54],[-3,58],[0,54],[1,51],[-5,50]],
  // 紐西蘭
  [[173,-35],[178,-38],[174,-41],[170,-44],[167,-46],[172,-41],[173,-35]],
  // 蘇門答臘與爪哇
  [[95,6],[100,2],[104,-2],[106,-6],[114,-8],[105,-7],[100,0],[95,6]],
  // 婆羅洲
  [[109,2],[117,7],[119,1],[116,-4],[110,-3],[109,2]],
];

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

  const landGroup = document.createElementNS(NS, 'g');
  landGroup.setAttribute('fill', 'none');
  landGroup.setAttribute('stroke', '#8A7355');
  landGroup.setAttribute('stroke-linejoin', 'round');
  landGroup.setAttribute('stroke-linecap', 'round');
  svg.appendChild(landGroup);

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

    // 先算出每個點的位置，依遠近排序：近的先放標籤，遠的碰到就讓位
    const placed = [];
    const items = origins
      .filter(o => o.lat != null && o.lon != null)
      .map(o => ({ o, p: project(Number(o.lat), Number(o.lon)) }))
      .filter(it => it.p.visible)
      .sort((a, b) => b.p.z - a.p.z);

    items.forEach(({ o, p }) => {
      const scale = 0.5 + 0.5 * Math.max(0, p.z);
      const isSel = state.selected === o.id;
      const g = document.createElementNS(NS, 'g');
      g.style.cursor = 'pointer';

      // 標記點本身
      const pin = document.createElementNS(NS, 'g');
      pin.setAttribute('transform', `translate(${p.x},${p.y}) scale(${scale})`);
      pin.innerHTML =
        // 看不見的加大熱區：實際圓點只有 5px 半徑，手指或滑鼠很難精準點到，
        // 所以疊一個透明的大圓負責接收點擊，視覺上完全看不出來。
        `<circle r="14" fill="transparent"/>` +
        (isSel ? `
        <circle r="7" fill="none" stroke="#A9803F" stroke-width="1.4" opacity="0.6">
          <animate attributeName="r" values="6;16;6" dur="1.9s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.55;0;0.55" dur="1.9s" repeatCount="indefinite"/>
        </circle>` : '') +
        `<circle r="5" fill="${isSel ? '#A9803F' : '#7C5A3A'}" stroke="#FFFFFF" stroke-width="1.6"/>`;
      g.appendChild(pin);

      // 名稱標籤：太靠近球體邊緣就不放，避免糊成一團
      const label = o.label || o.short || o.name || '';
      if (label && (p.z > 0.28 || isSel)) {
        const w = label.length * 10 + 6;      // 粗估寬度，用來擋重疊
        const lx = p.x + 9 * scale;
        const ly = p.y + 3.5;
        const clash = placed.some(b =>
          Math.abs(b.x - lx) < (b.w + w) / 2 && Math.abs(b.y - ly) < 15);

        if (!clash || isSel) {
          placed.push({ x: lx, y: ly, w });
          const t = document.createElementNS(NS, 'text');
          t.setAttribute('x', lx.toFixed(1));
          t.setAttribute('y', ly.toFixed(1));
          t.setAttribute('font-size', isSel ? '11' : '10');
          t.setAttribute('font-family', "'JetBrains Mono','Inter',sans-serif");
          t.setAttribute('font-weight', isSel ? '600' : '500');
          t.setAttribute('fill', isSel ? '#A9803F' : '#5F5B54');
          t.setAttribute('stroke', '#FFFFFF');       // 白色描邊，壓過底下的經緯線
          t.setAttribute('stroke-width', '3.2');
          t.setAttribute('paint-order', 'stroke');
          t.setAttribute('stroke-linejoin', 'round');
          t.setAttribute('opacity', isSel ? 1 : (0.45 + 0.55 * p.z).toFixed(2));
          t.textContent = label;
          g.appendChild(t);
        }
      }

      // 標記點自己要先攔截 pointerdown，不然事件會冒泡到 svg 被當成
      // 「開始拖曳地球」處理，svg 還會 setPointerCapture() 把後續的
      // pointerup／click 都劫走，導致點了標記點卻完全沒反應。
      g.addEventListener('pointerdown', e => e.stopPropagation());
      g.addEventListener('click', e => { e.stopPropagation(); flyTo(o.id); });
      pinGroup.appendChild(g);
    });
  }

  /* 只畫朝向觀看者的那半邊：把輪廓拆成一段段可見的線 */
  function renderLand() {
    landGroup.innerHTML = '';
    const w = (0.85 + 0.25 * state.zoom).toFixed(2);
    LAND.forEach(poly => {
      let d = '';
      let drawing = false;
      poly.forEach(([lon, lat]) => {
        const p = project(lat, lon);
        if (p.z > 0.02) {
          d += (drawing ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
          drawing = true;
        } else {
          drawing = false;   // 轉到背面就斷開，下一個可見點重新起筆
        }
      });
      if (!d) return;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke-width', w);
      path.setAttribute('opacity', '0.62');
      landGroup.appendChild(path);
    });
  }

  function renderAll() { renderGrid(); renderLand(); renderPins(); }

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
