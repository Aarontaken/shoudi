'use strict';
/* 手递 · 前端 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const el = {
    conn: $('#conn'), connText: $('#connText'),
    serial: $('#serial'), addr: $('#addr'), addrBtn: $('#addrBtn'), today: $('#today'),
    drop: $('#drop'), dropTitle: $('#dropTitle'), dropSub: $('#dropSub'),
    count: $('#count'), totalSize: $('#totalSize'), files: $('#files'), uploads: $('#uploads'), empty: $('#empty'),
    clipForm: $('#clipForm'), clipInput: $('#clipInput'), clips: $('#clips'),
    qr: $('#qr'), dirPath: $('#dirPath'), reveal: $('#reveal'), hostName: $('#hostName'),
    toast: $('#toast'), stamp: $('#stamp'),
    gate: $('#gate'), gateTitle: $('#gateTitle'), gateMsg: $('#gateMsg'),
    gateDots: $('#gateDots'), gateRetry: $('#gateRetry'),
    ask: $('#ask'), askName: $('#askName'), askIp: $('#askIp'), askAllow: $('#askAllow'), askDeny: $('#askDeny'),
    devicesCard: $('#devicesCard'), devices: $('#devices'),
  };

  const state = { files: [], clips: [], info: null, host: false };
  let session = { host: false, trusted: false };
  let started = false;
  let pairId = null;
  let pairTimer = 0;
  const seen = new Set();
  let firstPaint = true;
  let lastQR = '';
  let es = null;

  /* ------------------------------------------------------------ 小工具 */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const size = (n) => {
    if (!Number.isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
  };

  const ago = (ts) => {
    const d = Math.max(0, Date.now() - ts);
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + ' 天前';
    const t = new Date(ts);
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  };

  const clock = (ts) => {
    const t = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(t.getMonth() + 1)}.${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  };

  const extOf = (name) => {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toUpperCase() : 'FILE';
  };

  const kindOf = (name) => {
    const e = extOf(name);
    if (/^(PNG|JPE?G|GIF|WEBP|HEIC|AVIF|BMP|TIFF?|SVG)$/.test(e)) return 'img';
    if (/^(MP4|MOV|WEBM|MKV|AVI|M4V)$/.test(e)) return 'video';
    if (/^(MP3|M4A|WAV|FLAC|AAC|OGG)$/.test(e)) return 'audio';
    if (/^(TXT|MD|CSV|JSON|XML|LOG|PDF|DOC|DOCX)$/.test(e)) return 'text';
    return 'file';
  };

  const VIEWABLE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|mp4|webm|mov|mp3|m4a|wav|pdf|txt|md|json|log)$/i;

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  function flashStamp(text = '已投妥') {
    el.stamp.textContent = text;
    el.stamp.classList.remove('show');
    void el.stamp.offsetWidth;
    el.stamp.classList.add('show');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  const enc = encodeURIComponent;
  const fileUrl = (name, view) => `/f/${enc(name)}${view ? '?view=1' : ''}`;

  /* ------------------------------------------------------------ 接口 */

  async function api(path, opts = {}) {
    const r = await fetch(path, { cache: 'no-store', ...opts });
    if (r.status === 401) {
      const data = await r.json().catch(() => ({}));
      if (data.needPair) { startPairing(); throw new Error('needPair'); }
      throw new Error('unauthorized');
    }
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  const postJSON = (path, body) => api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  /* ------------------------------------------------------------ 配对 */

  function showGate(title, msg, retry) {
    el.gate.hidden = false;
    el.gateTitle.textContent = title || '等待电脑确认';
    el.gateMsg.textContent = msg || '电脑上会弹出一条请求，点「允许」就能连上。';
    el.gateRetry.hidden = !retry;
    el.gateDots.hidden = !!retry;
    document.body.classList.add('gated');
  }

  function hideGate() {
    el.gate.hidden = true;
    document.body.classList.remove('gated');
  }

  async function startPairing() {
    clearInterval(pairTimer);
    pairId = null;
    showGate('等待电脑确认', '电脑上会弹出一条请求，点「允许」就能连上。', false);
    let r;
    try {
      r = await postJSON('/api/pair', {});
    } catch {
      showGate('连不上电脑', '检查一下是否还在同一个 Wi-Fi，然后重试。', true);
      return;
    }
    if (r.trusted) { hideGate(); boot(); return; }
    pairId = r.id;
    pairTimer = setInterval(checkPair, 1500);
  }

  async function checkPair() {
    if (!pairId) return;
    let r;
    try {
      r = await fetch(`/api/pair/${pairId}`, { cache: 'no-store' }).then((x) => x.json());
    } catch { return; }

    if (r.trusted) {
      clearInterval(pairTimer);
      pairId = null;
      hideGate();
      toast('已连上这台电脑');
      boot();
      return;
    }
    if (r.state === 'denied') {
      clearInterval(pairTimer);
      showGate('电脑拒绝了这次连接', '如果是你自己的设备，重新请求一次；也可以直接关掉页面。', true);
    } else if (r.state === 'expired') {
      clearInterval(pairTimer);
      showGate('请求过期了', '电脑那边没有响应，重新请求一次吧。', true);
    }
  }

  el.gateRetry.addEventListener('click', () => startPairing());

  /* ------------------------------------------------------------ 主机确认 */

  function renderAsk(item) {
    if (!item) {
      el.ask.hidden = true;
      el.ask.dataset.id = '';
      document.body.classList.remove('has-ask');
      return;
    }
    el.askName.textContent = item.name;
    el.askIp.textContent = item.ip;
    el.ask.dataset.id = item.id;
    el.ask.hidden = false;
    document.body.classList.add('has-ask');
  }

  async function refreshPending() {
    if (!session.host) return;
    try {
      const r = await api('/api/pending');
      renderAsk((r.pending || [])[0]);
    } catch { /* ignore */ }
  }

  async function decide(allow) {
    const id = el.ask.dataset.id;
    if (!id) return;
    el.ask.hidden = true;
    try {
      await postJSON(`/api/pending/${id}`, { allow });
      toast(allow ? '已允许，手机那边马上就能用' : '已拒绝');
    } catch {
      toast('操作失败');
    }
    refreshPending();
  }

  el.askAllow.addEventListener('click', () => decide(true));
  el.askDeny.addEventListener('click', () => decide(false));

  function renderDevices(list) {
    el.devicesCard.hidden = !list.length;
    el.devices.innerHTML = list.map((d) => `
      <li class="device">
        <span class="device-main">
          <b>${esc(d.name)}</b>
          <em>${esc(d.ip)} · ${ago(d.at)}</em>
        </span>
        <button class="icon-btn" data-revoke="${esc(d.id)}">撤销</button>
      </li>`).join('');
  }

  async function refreshDevices() {
    if (!session.host) return;
    try {
      const r = await api('/api/devices');
      renderDevices(r.devices || []);
    } catch { /* ignore */ }
  }

  el.devices.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-revoke]');
    if (!btn) return;
    if (!confirm('撤销后，这台设备需要重新确认才能连接。继续？')) return;
    await api(`/api/devices/${enc(btn.dataset.revoke)}`, { method: 'DELETE' }).catch(() => {});
    refreshDevices();
  });

  /* ------------------------------------------------------------ 渲染 */

  function renderFiles() {
    el.count.textContent = state.files.length;
    const total = state.files.reduce((a, f) => a + f.size, 0);
    el.totalSize.textContent = state.files.length ? `${state.files.length} 件 · ${size(total)}` : '';
    el.empty.hidden = state.files.length > 0;

    el.files.innerHTML = state.files.map((f, i) => {
      const isNew = !firstPaint && !seen.has(f.name);
      const lab = extOf(f.name).slice(0, 4);
      const view = VIEWABLE.test(f.name);
      const action = session.host
        ? `<button class="dl" data-reveal="${esc(f.name)}" title="在文件夹里显示">↗</button>`
        : `<a class="dl" href="${fileUrl(f.name, false)}" download title="下载到手机">↓</a>`;
      const remove = session.host
        ? `<button class="x" data-del="${esc(f.name)}" title="删除" aria-label="删除 ${esc(f.name)}">×</button>`
        : '';
      return `<li class="row${isNew ? ' is-new' : ''}" data-name="${esc(f.name)}">
        <span class="no">${String(i + 1).padStart(2, '0')}</span>
        <span class="badge" data-kind="${kindOf(f.name)}">${esc(lab)}</span>
        <span class="meta">
          <a class="fname" href="${fileUrl(f.name, view)}" ${view ? 'target="_blank" rel="noopener"' : 'download'} title="${esc(f.name)}">${esc(f.name)}</a>
          <span class="fmeta" data-ts="${f.mtime}">${size(f.size)} · ${ago(f.mtime)}</span>
        </span>
        ${action}
        ${remove}
      </li>`;
    }).join('');

    seen.clear();
    state.files.forEach((f) => seen.add(f.name));
    firstPaint = false;
  }

  function renderClips() {
    el.clips.innerHTML = state.clips.map((c) => {
      const txt = esc(c.text);
      const linked = txt.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return `<li class="clip">
        <div class="clip-body">
          <div class="clip-text">${linked}</div>
          <span class="clip-time" data-ts="${c.at}">${clock(c.at)}</span>
        </div>
        <button class="icon-btn" data-copy="${c.id}">复制</button>
        <button class="icon-btn" data-drop="${c.id}" title="删除">×</button>
      </li>`;
    }).join('');
  }

  function renderInfo(info) {
    const url = `http://${info.ip}:${info.port}`;
    el.addr.textContent = `${info.ip}:${info.port}`;
    el.addrBtn.dataset.url = url;
    el.dirPath.textContent = info.dir;
    el.hostName.textContent = info.host;
    el.reveal.hidden = !session.host;
    el.reveal.textContent = info.platform === 'darwin' ? '在访达中打开'
      : info.platform === 'win32' ? '在资源管理器打开' : '打开文件夹';

    const t = new Date();
    el.today.textContent = `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`;
    el.serial.textContent = `${String(t.getFullYear()).slice(2)}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;

    if (lastQR !== url) {
      lastQR = url;
      drawQR(url);
    }
  }

  function drawQR(text) {
    if (typeof qrcode !== 'function') { el.qr.textContent = '二维码不可用'; return; }
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      const pad = 2;
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
        }
      }
      el.qr.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + pad * 2} ${n + pad * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#17130e"/></svg>`;
    } catch {
      el.qr.textContent = '二维码生成失败';
    }
  }

  function tickTimes() {
    $$('#files .fmeta').forEach((n) => {
      const ts = Number(n.dataset.ts);
      const row = n.closest('.row');
      const f = state.files.find((x) => x.name === row?.dataset.name);
      if (f) n.textContent = `${size(f.size)} · ${ago(ts)}`;
    });
  }

  /* ------------------------------------------------------------ 状态同步 */

  function setConn(ok) {
    el.conn.classList.toggle('off', !ok);
    el.connText.textContent = ok ? '已连接' : '重连中';
  }

  async function refresh() {
    try {
      const data = await api('/api/state');
      state.files = data.files || [];
      state.clips = data.clips || [];
      state.host = !!data.host;
      if (!state.info || JSON.stringify(state.info) !== JSON.stringify(data.info)) {
        state.info = data.info;
        renderInfo(data.info);
      }
      renderFiles();
      renderClips();
      setConn(true);
    } catch (e) {
      if (e.message === 'needPair') return;
      setConn(false);
    }
  }

  let pendingRefresh = 0;
  function scheduleRefresh() {
    clearTimeout(pendingRefresh);
    pendingRefresh = setTimeout(refresh, 90);
  }

  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    es.onopen = () => setConn(true);
    es.onerror = () => setConn(false);
    es.onmessage = (e) => {
      let type = '';
      try { type = JSON.parse(e.data).type; } catch { /* ignore */ }
      if (type === 'pending') { refreshPending(); return; }
      if (type === 'devices') { refreshDevices(); return; }
      scheduleRefresh();
    };
  }

  /* ------------------------------------------------------------ 上传 */

  const queue = [];
  let active = 0;
  const MAX_PARALLEL = 2;
  let seq = 0;

  function enqueueFiles(list) {
    const arr = Array.from(list || []);
    if (!arr.length) return;
    for (const file of arr) {
      const job = { id: ++seq, file, name: file.name || `剪贴板-${seq}.png` };
      const li = document.createElement('li');
      li.className = 'up';
      li.dataset.id = job.id;
      li.innerHTML = `<div class="up-line"><span class="up-name">${esc(job.name)}</span><span class="up-pct">排队</span></div><div class="up-bar"><i></i></div>`;
      el.uploads.prepend(li);
      job.el = li;
      queue.push(job);
    }
    pump();
  }

  function pump() {
    while (active < MAX_PARALLEL && queue.length) {
      const job = queue.shift();
      active++;
      send(job).finally(() => { active--; pump(); });
    }
  }

  function send(job) {
    return new Promise((resolve) => {
      const bar = job.el.querySelector('.up-bar i');
      const pct = job.el.querySelector('.up-pct');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);
      xhr.setRequestHeader('X-Filename', encodeURIComponent(job.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.min(100, Math.round((e.loaded / e.total) * 100));
        bar.style.width = p + '%';
        pct.textContent = p + '%';
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          bar.style.width = '100%';
          pct.textContent = '已投';
          job.el.classList.add('done');
          setTimeout(() => job.el.remove(), 800);
          flashStamp();
          refresh();
        } else if (xhr.status === 401) {
          job.el.remove();
          startPairing();
        } else {
          let msg = '失败';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
          pct.textContent = '失败';
          job.el.classList.add('fail');
          toast('没传上去：' + msg);
        }
        resolve();
      };

      xhr.onerror = () => {
        pct.textContent = '断了';
        job.el.classList.add('fail');
        toast('网络断了，这个文件没传完');
        resolve();
      };

      xhr.send(job.file);
    });
  }

  /* ------------------------------------------------------------ 交互 */

  let picker = null;
  function openPicker() {
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;
      picker.style.display = 'none';
      picker.addEventListener('change', () => {
        enqueueFiles(picker.files);
        picker.value = '';
      });
      document.body.appendChild(picker);
    }
    picker.click();
  }

  el.drop.addEventListener('click', openPicker);

  let dragDepth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
    el.dropTitle.textContent = '松手投递';
    el.dropSub.textContent = '文件会直接落到这台电脑上';
  });

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) resetDrag();
  });

  function resetDrag() {
    dragDepth = 0;
    document.body.classList.remove('dragging');
    el.dropTitle.textContent = '把文件丢进来';
    el.dropSub.textContent = '点击选择 · 拖拽也行 · 不限大小';
  }

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    resetDrag();
    if (e.dataTransfer?.files?.length) enqueueFiles(e.dataTransfer.files);
  });

  ['dragover', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    if (hasFiles(e)) e.preventDefault();
  }));

  document.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      enqueueFiles(files);
      toast('已从剪贴板投递');
    }
  });

  el.clipForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el.clipInput.value.trim();
    if (!text) return;
    el.clipInput.value = '';
    try {
      await postJSON('/api/clips', { text });
      toast('已送出');
      refresh();
    } catch (err) {
      if (err.message !== 'needPair') toast('送不出去，检查一下连接');
    }
  });

  el.clipInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      el.clipForm.requestSubmit();
    }
  });

  el.files.addEventListener('click', async (e) => {
    const rev = e.target.closest('[data-reveal]');
    if (rev) {
      fetch('/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rev.dataset.reveal }),
      }).catch(() => toast('打不开，可能是权限问题'));
      toast('已经在文件夹里标出来了');
      return;
    }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const name = del.dataset.del;
    if (!confirm(`删除「${name}」？\n文件会从电脑上删掉。`)) return;
    await fetch(`/api/files/${enc(name)}`, { method: 'DELETE' }).catch(() => {});
    refresh();
  });

  el.clips.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const c = state.clips.find((x) => x.id === copy.dataset.copy);
      if (!c) return;
      const ok = await copyText(c.text);
      copy.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { copy.textContent = '复制'; }, 1400);
      return;
    }
    const del = e.target.closest('[data-drop]');
    if (del) {
      await fetch(`/api/clips/${enc(del.dataset.drop)}`, { method: 'DELETE' }).catch(() => {});
      refresh();
    }
  });

  el.addrBtn.addEventListener('click', async () => {
    const ok = await copyText(el.addrBtn.dataset.url || '');
    toast(ok ? '地址已复制' : '复制失败，手动抄一下吧');
  });

  el.reveal.addEventListener('click', () => {
    fetch('/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => toast('打不开，可能是权限问题'));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session.trusted) refresh();
  });

  /* ------------------------------------------------------------ 启动 */

  async function start() {
    await refresh();
    connect();
    if (session.host) {
      refreshPending();
      refreshDevices();
    }
    started = true;
  }

  async function boot() {
    try {
      session = await fetch('/api/session', { cache: 'no-store' }).then((r) => r.json());
    } catch {
      session = { host: false, trusted: false };
    }
    if (!session.trusted) {
      startPairing();
      return;
    }
    hideGate();
    if (!started) await start();
    else refresh();
  }

  setInterval(tickTimes, 30000);
  boot();
})();
