// === 配置 ===
const DATA_URL = 'data.json';

// === DOM ===
const img = document.getElementById('campus-map');
const map = document.getElementById('campusmap');
const pinsLayer = document.getElementById('pins');
const dlg = document.getElementById('landmark-dialog');
const dlgTitle = document.getElementById('dlg-title');
const dlgShort = document.getElementById('dlg-short');
const dlgFull = document.getElementById('dlg-full');
const dlgImg = document.getElementById('dlg-img');
const btnCheckin = document.getElementById('btnCheckin');
const btnClear = document.getElementById('clearVisited');

// 新增：路线相关 DOM
const routeSelect = document.getElementById('routeSelect');
const routeStatus = document.getElementById('routeStatus');
const btnNext = document.getElementById('btnNext');

// === 数据 ===
let DATA = { landmarks: [], routes: {} };
let ROUTES = {};
let currentRouteId = '';
let currentRouteSeq = [];   // 当前路线的 id 列表
let currentRouteIndex = -1; // 当前所在序号（0-based）

// 加载 data.json
async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    ROUTES = DATA.routes || {};
  } catch (err) {
    console.error('[data] 加载失败：', err);
    banner('数据未加载：请确认 data.json 路径/语法正确，并通过本地服务器访问。');
  }
}

const VISITED_KEY = 'visited_landmarks_v1';
const getVisited = () => new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || '[]'));
const setVisited = (set) => localStorage.setItem(VISITED_KEY, JSON.stringify(Array.from(set)));

function findLandmark(id) {
  return Array.isArray(DATA.landmarks) ? DATA.landmarks.find(x => x.id === id) : null;
}

// 计算 <area> 中心（用于 ✓ 徽章）
function centerOf(area) {
  const origW = Number(img.dataset.origW);
  const origH = Number(img.dataset.origH);
  const shape = (area.getAttribute('shape') || '').toLowerCase();
  const coords = (area.dataset.origCoords || area.coords).split(',').map(Number);
  let cx = 0, cy = 0;
  if (shape === 'rect') {
    const [x1, y1, x2, y2] = coords; cx = (x1 + x2) / 2; cy = (y1 + y2) / 2;
  } else if (shape === 'circle') {
    const [x, y] = coords; cx = x; cy = y;
  } else {
    for (let i = 0; i < coords.length; i += 2) { cx += coords[i]; cy += coords[i + 1]; }
    const n = coords.length / 2; cx /= n; cy /= n;
  }
  return { pctX: (cx / origW) * 100, pctY: (cy / origH) * 100 };
}

// 坐标缩放
function scaleAreas() {
  if (!img.dataset.origW || !img.dataset.origH) {
    const natW = img.naturalWidth || Number(img.getAttribute('width')) || img.clientWidth;
    const natH = img.naturalHeight || Number(img.getAttribute('height')) || img.clientHeight;
    img.dataset.origW = String(natW);
    img.dataset.origH = String(natH);
    map.querySelectorAll('area').forEach(a => {
      if (!a.dataset.origCoords) a.dataset.origCoords = a.coords;
      if (!a.dataset.id) { const t = a.getAttribute('title'); if (t) a.dataset.id = t.trim(); }
    });
  }
  const ratioX = img.clientWidth / Number(img.dataset.origW);
  const ratioY = img.clientHeight / Number(img.dataset.origH);

  map.querySelectorAll('area').forEach(a => {
    const shape = (a.getAttribute('shape') || '').toLowerCase();
    const src = (a.dataset.origCoords || a.coords).split(',').map(Number);
    let out = [];
    if (shape === 'circle') {
      const [x, y, r] = src;
      const rr = Math.round(r * (ratioX + ratioY) / 2);
      out = [Math.round(x * ratioX), Math.round(y * ratioY), rr];
    } else {
      for (let i = 0; i < src.length; i += 2) {
        out.push(Math.round(src[i] * ratioX), Math.round(src[i + 1] * ratioY));
      }
    }
    a.coords = out.join(',');
  });
}

function renderPins() {
  pinsLayer.innerHTML = '';
  const visited = getVisited();
  if (!visited.size) return;
  const byId = {};
  map.querySelectorAll('area').forEach(a => {
    const id = a.dataset.id || a.getAttribute('title') || '';
    if (id) byId[id] = a;
  });
  visited.forEach(id => {
    const a = byId[id]; if (!a) return;
    const { pctX, pctY } = centerOf(a);
    const pin = document.createElement('div');
    pin.className = 'pin';
    pin.style.left = pctX + '%';
    pin.style.top = pctY + '%';
    pin.innerHTML = '<div class="dot"></div>';
    pinsLayer.appendChild(pin);
  });
}

// === 路线相关 ===

// 当前选中路线的显示名称
function currentRouteLabel() {
  if (!currentRouteId || !routeSelect) return currentRouteId;
  const opt = routeSelect.options[routeSelect.selectedIndex];
  return opt ? opt.textContent : currentRouteId;
}

function updateNextButton() {
  if (!btnNext) return;
  if (!currentRouteId || currentRouteSeq.length === 0 || currentRouteIndex < 0 || currentRouteIndex >= currentRouteSeq.length - 1) {
    btnNext.disabled = true;
    btnNext.textContent = '下一站';
    return;
  }
  const nextId = currentRouteSeq[currentRouteIndex + 1];
  const lm = findLandmark(nextId);
  btnNext.disabled = false;
  btnNext.textContent = '下一站：' + (lm ? lm.name : ('#' + nextId));
}

function initRouteUI() {
  if (!routeSelect) return;

  // select 的内容我们已经在 HTML 里写好，这里只需要绑定事件
  routeSelect.addEventListener('change', () => {
    currentRouteId = routeSelect.value || '';
    if (!currentRouteId || !ROUTES[currentRouteId]) {
      currentRouteSeq = [];
      currentRouteIndex = -1;
      if (routeStatus) routeStatus.textContent = '';
      updateNextButton();
      return;
    }
    currentRouteSeq = ROUTES[currentRouteId].slice(); // 拷贝一份
    currentRouteIndex = 0;

    if (routeStatus) {
      routeStatus.textContent = `当前路线：${currentRouteLabel()}（共 ${currentRouteSeq.length} 站）`;
    }
    updateNextButton();

    // 自动从第一站开始导览
    if (currentRouteSeq.length > 0) {
      openLandmark(currentRouteSeq[0]);
    }
  });

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (!currentRouteId || currentRouteSeq.length === 0) return;
      if (currentRouteIndex < 0) currentRouteIndex = 0;
      if (currentRouteIndex >= currentRouteSeq.length - 1) return;
      const nextId = currentRouteSeq[currentRouteIndex + 1];
      openLandmark(nextId);
    });
  }
}

// 打开弹窗
function openLandmark(id) {
  console.log('[map] click id =', id);
  const lm = findLandmark(id);
  if (!lm) {
    banner('未在数据中找到 id = ' + id + ' 的地标，请检查 <area title> 与 data.json 的 id 是否一致。');
    return;
  }
  if (dlgTitle) dlgTitle.textContent = lm.name || id;
  if (dlgShort) dlgShort.textContent = lm.shortDesc || '';
  if (dlgFull)  dlgFull.textContent  = lm.fullDesc  || '';
  const imgSrc = (lm.images && lm.images[0]) || '';
  if (dlgImg) dlgImg.src = imgSrc;

  dlg.dataset.currentId = id;
  const visited = getVisited();
  if (btnCheckin) btnCheckin.textContent = visited.has(id) ? '已打卡 ✓' : '打卡';

  // 若当前有选中的路线，更新当前序号与状态文字
  if (currentRouteId && currentRouteSeq.length > 0) {
    const idx = currentRouteSeq.indexOf(id);
    if (idx !== -1) currentRouteIndex = idx;
    if (routeStatus) {
      const label = currentRouteLabel();
      if (idx !== -1) {
        routeStatus.textContent = `当前路线：${label}（第 ${idx + 1} / ${currentRouteSeq.length} 站）`;
      } else {
        routeStatus.textContent = `当前路线：${label}`;
      }
    }
  }

  updateNextButton();

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open','');
}

function bindAreas() {
  map.querySelectorAll('area').forEach(a => {
    const handler = (ev) => {
      // 多指触摸（双指缩放）直接放行
      if (ev.touches && ev.touches.length > 1) return;

      ev.preventDefault(); // 仅单指点按时拦截默认跳转
      const id = a.dataset.id || a.getAttribute('title');
      openLandmark(id);
    };
    a.addEventListener('click', handler);
    a.addEventListener('touchstart', handler, { passive: false });
  });
}

function setupMobileTouch() {
  const mapImage = document.getElementById('campus-map');
  const mapAreas = document.getElementById('campusmap').getElementsByTagName('area');

  mapImage.addEventListener('touchstart', function(ev) {
    // 双指缩放：直接放行（不阻止默认）
    if (ev.touches && ev.touches.length > 1) return;

    // 单指点击地标：阻止默认，做命中检测
    ev.preventDefault();
    const touch = ev.touches[0];
    const rect = mapImage.getBoundingClientRect();

    // 使用像素坐标，与 area.coords（已随图片缩放）单位一致
    const xPx = (touch.clientX - rect.left);
    const yPx = (touch.clientY - rect.top);

    const touchedArea = findTouchedAreaPx(xPx, yPx, mapAreas);
    if (touchedArea) {
      const id = touchedArea.dataset.id || touchedArea.getAttribute('title');
      openLandmark(id);
    }
  }, { passive: false });
}

// 用像素坐标做命中检测
function findTouchedAreaPx(x, y, areas) {
  for (let area of areas) {
    if (isPointInAreaPx(x, y, area)) return area;
  }
  return null;
}

// 与 area.coords 同单位（像素）的点内测试
function isPointInAreaPx(x, y, area) {
  const shape = (area.getAttribute('shape') || '').toLowerCase();
  const coords = area.coords.split(',').map(Number);

  if (shape === 'rect') {
    const [x1, y1, x2, y2] = coords;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  } else if (shape === 'circle') {
    const [cx, cy, r] = coords;
    const dx = x - cx, dy = y - cy;
    return (dx*dx + dy*dy) <= r*r;
  } else { // poly：射线法
    let inside = false;
    for (let i = 0, j = coords.length - 2; i < coords.length; i += 2) {
      const xi = coords[i],   yi = coords[i + 1];
      const xj = coords[j],   yj = coords[j + 1];
      const intersect = ((yi > y) !== (yj > y)) &&
                        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
      j = i;
    }
    return inside;
  }
}

// 打卡
if (btnCheckin) {
  btnCheckin.addEventListener('click', () => {
    const id = dlg.dataset.currentId; if (!id) return;
    const visited = getVisited();
    if (visited.has(id)) visited.delete(id); else visited.add(id);
    setVisited(visited);
    if (btnCheckin) btnCheckin.textContent = visited.has(id) ? '已打卡 ✓' : '打卡';
    renderPins();
  });
}

// 清空打卡
if (btnClear) {
  btnClear.addEventListener('click', () => {
    localStorage.removeItem(VISITED_KEY);
    renderPins();
  });
}

// 小工具
function debounce(fn, t = 100){ let h; return (...args)=>{ clearTimeout(h); h = setTimeout(()=>fn(...args), t); }; }
function waitImage(el){ return el.complete ? Promise.resolve() : new Promise(r => el.addEventListener('load', r, { once: true })); }
function banner(msg){
  const bar = document.createElement('div');
  bar.textContent = msg;
  bar.style.cssText='position:sticky;top:0;z-index:99;background:#fde68a;color:#7c2d12;padding:8px 12px;font-size:12px;box-shadow:0 2px 10px rgba(0,0,0,.08)';
  document.body.prepend(bar);
}

async function init() {
  await Promise.all([loadData(), waitImage(img)]);
  if (!Array.isArray(DATA.landmarks) || DATA.landmarks.length === 0) {
    banner('未加载到任何地标数据，请检查 data.json。');
    return;
  }
  scaleAreas();
  bindAreas();
  renderPins();
  initRouteUI();          // 新增：初始化路线 UI
  setupMobileTouch();     // 移动端支持

  window.addEventListener('resize', debounce(()=>{ scaleAreas(); renderPins(); }, 80));
}

if (img) { if (img.complete) init(); else img.addEventListener('load', init); }

// 下方 computeBaseScale 是之前保留的备用函数，没有地方调用，可以忽略或删除
function computeBaseScale() {
  natW = img.naturalWidth || Number(img.getAttribute('width')) || 1;
  natH = img.naturalHeight || Number(img.getAttribute('height')) || 1;
}
