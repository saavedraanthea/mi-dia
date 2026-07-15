/* ============ Mi Día — planificador visual ============ */
"use strict";

const STORAGE_KEY = "midia-data-v1";

const EMOJIS = ["📝","💻","📚","🍳","🍽️","☕","🚿","🧘","🏃","🚶","🛒","🧹","🧺","💊","😴","🎨","🎧","📞","👥","🚗","🐶","🌱","🎮","❤️"];
const COLORS = ["#cdb4f6","#a8d8f0","#b7e4c7","#ffe08a","#ffb4a2","#f4acb7","#d8e2dc","#b5c7f7"];

let data = { tasksByDate: {}, routines: [] };
let currentDate = new Date();
let editingTaskId = null;     // id de tarea en edición (null = nueva)
let editingRoutineId = null;  // id de rutina en edición
let detailTaskId = null;      // tarea abierta en el sheet de detalle
let applyRoutineId = null;    // rutina pendiente de aplicar
let timer = null;             // { taskId, title, emoji, totalSec, remainingSec, running, intervalId }

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { data = JSON.parse(raw); return; }
  } catch (e) { /* datos corruptos: empezar de cero */ }
  // primera vez: una rutina de ejemplo
  data.routines = [{
    id: uid(), name: "Mañana tranquila", emoji: "☀️",
    items: [
      { title: "Ducharme", emoji: "🚿", color: COLORS[1], duration: 15, checklist: [] },
      { title: "Desayunar", emoji: "☕", color: COLORS[3], duration: 20, checklist: [] },
      { title: "Revisar el plan del día", emoji: "📝", color: COLORS[0], duration: 10, checklist: [] },
    ],
  }];
  save();
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

function tasksFor(dkey) {
  if (!data.tasksByDate[dkey]) data.tasksByDate[dkey] = [];
  return data.tasksByDate[dkey];
}
function findTask(id) {
  for (const k in data.tasksByDate) {
    const t = data.tasksByDate[k].find((t) => t.id === id);
    if (t) return { task: t, dkey: k };
  }
  return null;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------- header del día ---------- */
const DAY_NAMES = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"]; // lunes primero

function renderWeekStrip() {
  const strip = $("week-strip");
  strip.innerHTML = "";
  // lunes de la semana de currentDate
  const monday = new Date(currentDate);
  const dow = (monday.getDay() + 6) % 7; // 0 = lunes
  monday.setDate(monday.getDate() - dow);
  const todayKey = dateKey(new Date());
  const selKey = dateKey(currentDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const k = dateKey(d);
    const hasTasks = (data.tasksByDate[k] || []).length > 0;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "week-day"
      + (k === selKey ? " selected" : "")
      + (k === todayKey ? " today" : "")
      + (hasTasks ? " has-tasks" : "");
    b.innerHTML = `<span class="wd-name">${DAY_LETTERS[i]}</span><span class="wd-num">${d.getDate()}</span><span class="wd-dot"></span>`;
    b.addEventListener("click", () => { currentDate = d; renderTimeline(); });
    strip.appendChild(b);
  }
}

function renderDayHeader() {
  const today = dateKey(new Date());
  const cur = dateKey(currentDate);
  const diff = Math.round((new Date(cur) - new Date(today)) / 86400000);
  let title;
  if (diff === 0) title = "Hoy";
  else if (diff === 1) title = "Mañana";
  else if (diff === -1) title = "Ayer";
  else title = DAY_NAMES[currentDate.getDay()][0].toUpperCase() + DAY_NAMES[currentDate.getDay()].slice(1);
  $("day-title").textContent = title;
  $("day-date").textContent = `${DAY_NAMES[currentDate.getDay()]} ${currentDate.getDate()} de ${MONTHS[currentDate.getMonth()]}`;
}

/* ---------- timeline ---------- */
const HOUR_H = 68; // debe coincidir con --hour-h

function buildHours() {
  const wrap = $("hours");
  wrap.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const row = document.createElement("div");
    row.className = "hour-row";
    row.style.top = `${h * HOUR_H}px`;
    row.innerHTML = `<span>${pad(h)}:00</span>`;
    wrap.appendChild(row);
  }
}

function renderTimeline() {
  ensureRepeats(dateKey(currentDate));
  renderDayHeader();
  renderWeekStrip();
  renderStreakChip();
  renderReschedulePill();
  const layer = $("tasks-layer");
  layer.innerHTML = "";
  const all = tasksFor(dateKey(currentDate));
  const anytime = all.filter((t) => t.anytime);
  const tasks = all.filter((t) => !t.anytime).slice().sort((a, b) => toMin(a.start) - toMin(b.start));
  $("empty-day").hidden = all.length > 0;
  renderAnytime(anytime);

  // reparto en columnas: los bloques que se solapan visualmente van lado a lado
  const items = tasks.map((t) => {
    const top = (toMin(t.start) / 60) * HOUR_H;
    const height = Math.max((t.duration / 60) * HOUR_H, 46);
    return { t, top, bottom: top + height, height, col: 0, cols: 1 };
  });
  let cluster = [];
  let clusterEnd = -1;
  const flushCluster = () => {
    if (!cluster.length) return;
    const colEnds = [];
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.top + 2);
      if (c === -1) { c = colEnds.length; colEnds.push(0); }
      it.col = c;
      colEnds[c] = it.bottom;
    }
    for (const it of cluster) it.cols = colEnds.length;
    cluster = [];
  };
  for (const it of items) {
    if (it.top >= clusterEnd - 2) flushCluster();
    clusterEnd = cluster.length ? Math.max(clusterEnd, it.bottom) : it.bottom;
    cluster.push(it);
  }
  flushCluster();

  for (const { t, top, height, col, cols } of items) {
    const btn = document.createElement("button");
    btn.className = "task-block" + (t.done ? " done" : "");
    btn.style.top = `${top}px`;
    btn.style.height = `${height}px`;
    btn.style.left = `calc(${(col / cols) * 100}% + ${col ? 4 : 0}px)`;
    btn.style.width = `calc(${100 / cols}% - ${cols > 1 ? 4 : 0}px)`;
    btn.style.background = t.color;
    const end = toHHMM(toMin(t.start) + t.duration);
    const doneChecks = (t.checklist || []).filter((c) => c.done).length;
    const checkHint = (t.checklist || []).length
      ? `<div class="task-check-hint">☑ ${doneChecks}/${t.checklist.length}</div>` : "";
    btn.innerHTML = `<span class="task-emoji">${t.emoji}</span>
      <div><div class="task-name">${escapeHtml(t.title)}</div>
      <div class="task-meta">${t.start} – ${end} · ${t.duration} min</div>${checkHint}</div>`;
    btn.addEventListener("click", () => openTaskDetail(t.id));
    layer.appendChild(btn);
  }
  updateNowLine();
  updateFocusPill();
  updateGcalPill();
  renderGcal();
}

/* ---------- modo enfoque ---------- */
function focusCandidate() {
  const k = dateKey(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const all = (data.tasksByDate[k] || []).filter((t) => !t.done);
  const pending = all.filter((t) => !t.anytime).sort((a, b) => toMin(a.start) - toMin(b.start));
  const anytimePending = all.filter((t) => t.anytime);
  if (!pending.length && !anytimePending.length) return null;
  // primero: tarea cuyo bloque cubre este momento
  const current = pending.find((t) => toMin(t.start) <= nowMin && nowMin < toMin(t.start) + t.duration);
  if (current) return { task: current, isNow: true, inMin: 0 };
  // si no: la próxima que viene
  const upcoming = pending.find((t) => toMin(t.start) > nowMin);
  if (upcoming) return { task: upcoming, isNow: false, inMin: toMin(upcoming.start) - nowMin };
  // si no hay más con hora: una "en cualquier momento", o la más atrasada
  if (anytimePending.length) return { task: anytimePending[0], isNow: true, inMin: 0 };
  return { task: pending[pending.length - 1], isNow: false, inMin: 0 };
}

function fmtCountdown(min) {
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `en ${h} h ${m} min` : `en ${h} h`;
}

function updateFocusPill() {
  const pill = $("btn-focus");
  const viewingToday = dateKey(currentDate) === dateKey(new Date());
  const cand = viewingToday ? focusCandidate() : null;
  pill.hidden = !cand;
  if (cand) {
    const label = cand.isNow ? "Ahora: " : "Siguiente: ";
    const countdown = !cand.isNow && cand.inMin > 0 ? ` · ${fmtCountdown(cand.inMin)}` : "";
    $("focus-pill-text").textContent = label + `${cand.task.emoji} ${cand.task.title}` + countdown;
  }
}

$("btn-focus").addEventListener("click", () => {
  const cand = focusCandidate();
  if (cand) startTimer(cand.task);
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function updateNowLine() {
  const line = $("now-line");
  const isToday = dateKey(currentDate) === dateKey(new Date());
  line.style.display = isToday ? "block" : "none";
  if (!isToday) return;
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  line.style.top = `${(min / 60) * HOUR_H}px`;
  $("now-label").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function scrollToNow() {
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const y = (min / 60) * HOUR_H - 140;
  $("timeline-scroll").scrollTop = Math.max(0, y);
}

/* ---------- navegación de días ---------- */
$("btn-prev-day").addEventListener("click", () => { currentDate.setDate(currentDate.getDate() - 1); renderTimeline(); });
$("btn-next-day").addEventListener("click", () => { currentDate.setDate(currentDate.getDate() + 1); renderTimeline(); });
$("day-title-wrap").addEventListener("click", () => { currentDate = new Date(); renderTimeline(); scrollToNow(); });

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.view).classList.add("active");
    if (tab.dataset.view === "view-routines") renderRoutines();
    if (tab.dataset.view === "view-stats") renderStats();
    if (tab.dataset.view === "view-todo") renderTodos();
  });
});

/* ---------- sheets genéricos ---------- */
function openSheet(id) { $(id).hidden = false; }
function closeSheet(id) { $(id).hidden = true; }
document.querySelectorAll(".sheet-backdrop").forEach((bd) => {
  bd.addEventListener("click", (e) => { if (e.target === bd) bd.hidden = true; });
});

/* ---------- form de tarea ---------- */
let tfEmoji = EMOJIS[0];
let tfColor = COLORS[0];

function buildPicker(gridId, options, selected, onPick, isColor) {
  const grid = $(gridId);
  grid.innerHTML = "";
  options.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = (isColor ? "color-opt" : "emoji-opt") + (opt === selected ? " selected" : "");
    if (isColor) b.style.background = opt; else b.textContent = opt;
    b.addEventListener("click", () => {
      onPick(opt);
      grid.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    grid.appendChild(b);
  });
}

function addChecklistRow(container, value = "") {
  const row = document.createElement("div");
  row.className = "check-item-row";
  row.innerHTML = `<input type="text" placeholder="Paso..." maxlength="80">
    <button type="button" class="remove-check" aria-label="Quitar">✕</button>`;
  row.querySelector("input").value = value;
  row.querySelector(".remove-check").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function openTaskForm(task) {
  editingTaskId = task ? task.id : null;
  $("tf-heading").textContent = task ? "Editar tarea" : "Nueva tarea";
  $("tf-title").value = task ? task.title : "";
  const now = new Date();
  const roundedMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  $("tf-start").value = task ? task.start : toHHMM(Math.min(roundedMin, 23 * 60 + 45));
  $("tf-duration").value = task ? task.duration : 30;
  $("tf-anytime").checked = task ? !!task.anytime : false;
  $("tf-start-field").classList.toggle("disabled", $("tf-anytime").checked);
  $("tf-repeat").value = "none"; // la repetición se define al crear; editar afecta solo esta instancia
  tfEmoji = task ? task.emoji : EMOJIS[0];
  tfColor = task ? task.color : COLORS[0];
  buildPicker("tf-emoji-grid", EMOJIS, tfEmoji, (v) => (tfEmoji = v), false);
  buildPicker("tf-color-grid", COLORS, tfColor, (v) => (tfColor = v), true);
  const cont = $("tf-checklist-items");
  cont.innerHTML = "";
  (task ? task.checklist || [] : []).forEach((c) => addChecklistRow(cont, c.text));
  openSheet("sheet-task-form");
  if (!task) setTimeout(() => $("tf-title").focus(), 250);
}

$("btn-add-task").addEventListener("click", () => openTaskForm(null));
$("tf-add-check").addEventListener("click", () => addChecklistRow($("tf-checklist-items")));
$("tf-cancel").addEventListener("click", () => closeSheet("sheet-task-form"));

$("tf-anytime").addEventListener("change", () => {
  $("tf-start-field").classList.toggle("disabled", $("tf-anytime").checked);
});

$("tf-save").addEventListener("click", () => {
  const title = $("tf-title").value.trim();
  if (!title) { toast("Ponle un título a la tarea"); return; }
  const start = $("tf-start").value || "09:00";
  const duration = Math.max(5, parseInt($("tf-duration").value, 10) || 30);
  const anytime = $("tf-anytime").checked;
  const repeat = $("tf-repeat").value;
  const checklist = [...$("tf-checklist-items").querySelectorAll("input")]
    .map((i) => i.value.trim()).filter(Boolean)
    .map((text) => ({ text, done: false }));

  if (editingTaskId) {
    const found = findTask(editingTaskId);
    if (found) {
      const old = found.task;
      // conservar el estado "hecho" de pasos que no cambiaron de texto
      checklist.forEach((c) => {
        const prev = (old.checklist || []).find((p) => p.text === c.text);
        if (prev) c.done = prev.done;
      });
      Object.assign(old, { title, start, duration, emoji: tfEmoji, color: tfColor, checklist, anytime });
    }
  } else {
    if (repeat !== "none") {
      // plantilla repetida: se materializa cada día que corresponda
      if (!data.repeating) data.repeating = [];
      data.repeating.push({
        id: uid(), title, start, duration, emoji: tfEmoji, color: tfColor,
        checklist: checklist.map((c) => c.text), anytime,
        repeat, createdOn: dateKey(currentDate),
      });
      ensureRepeats(dateKey(currentDate));
      toast(repeat === "daily" ? "Se repetirá todos los días 🔁" : "Se repetirá cada semana 🔁");
    } else {
      tasksFor(dateKey(currentDate)).push({
        id: uid(), title, start, duration, emoji: tfEmoji, color: tfColor, checklist, done: false, anytime,
      });
    }
  }
  save();
  closeSheet("sheet-task-form");
  renderTimeline();
});

/* ---------- detalle de tarea ---------- */
function openTaskDetail(id) {
  const found = findTask(id);
  if (!found) return;
  detailTaskId = id;
  const t = found.task;
  $("td-emoji").textContent = t.emoji;
  $("td-title").textContent = t.title;
  $("td-time").textContent = t.anytime
    ? `En cualquier momento · ${t.duration} min`
    : `${t.start} – ${toHHMM(toMin(t.start) + t.duration)} · ${t.duration} min`;
  $("td-toggle-done").textContent = t.done ? "↩ Reabrir" : "✓ Completar";
  renderDetailChecklist(t);
  openSheet("sheet-task-detail");
}

function renderDetailChecklist(t) {
  const wrap = $("td-checklist");
  wrap.innerHTML = "";
  const items = t.checklist || [];
  if (!items.length) {
    wrap.innerHTML = `<p class="checklist-empty">Sin subpasos. Puedes agregarlos con ✏️ Editar.</p>`;
    return;
  }
  items.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "checklist-item" + (c.done ? " done" : "");
    row.innerHTML = `<span class="checklist-box">${c.done ? "✓" : ""}</span><span class="checklist-text">${escapeHtml(c.text)}</span>`;
    row.addEventListener("click", () => {
      c.done = !c.done;
      save();
      renderDetailChecklist(t);
      renderTimeline();
    });
    wrap.appendChild(row);
  });
}

$("td-toggle-done").addEventListener("click", () => {
  const found = findTask(detailTaskId);
  if (!found) return;
  found.task.done = !found.task.done;
  save();
  closeSheet("sheet-task-detail");
  renderTimeline();
  toast(found.task.done ? "¡Tarea completada! 🎉" : "Tarea reabierta");
});

$("td-edit").addEventListener("click", () => {
  const found = findTask(detailTaskId);
  if (!found) return;
  closeSheet("sheet-task-detail");
  openTaskForm(found.task);
});

$("td-delete").addEventListener("click", () => {
  const found = findTask(detailTaskId);
  if (!found) return;
  if (!confirm(`¿Borrar "${found.task.title}"?`)) return;
  data.tasksByDate[found.dkey] = data.tasksByDate[found.dkey].filter((t) => t.id !== detailTaskId);
  save();
  closeSheet("sheet-task-detail");
  renderTimeline();
});

/* ---------- timer ---------- */
const RING_R = 112;
const RING_CIRC = 2 * Math.PI * RING_R;

$("td-start-timer").addEventListener("click", () => {
  const found = findTask(detailTaskId);
  if (!found) return;
  closeSheet("sheet-task-detail");
  startTimer(found.task);
});

function nextPendingAfter(task, dkey) {
  const list = (data.tasksByDate[dkey] || [])
    .filter((t) => !t.done && t.id !== task.id && toMin(t.start) >= toMin(task.start))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  return list[0] || null;
}

function renderFocusChecklist(task) {
  const wrap = $("focus-checklist");
  wrap.innerHTML = "";
  (task.checklist || []).forEach((c) => {
    const row = document.createElement("div");
    row.className = "checklist-item" + (c.done ? " done" : "");
    row.innerHTML = `<span class="checklist-box">${c.done ? "✓" : ""}</span><span class="checklist-text">${escapeHtml(c.text)}</span>`;
    row.addEventListener("click", () => {
      c.done = !c.done;
      save();
      renderFocusChecklist(task);
    });
    wrap.appendChild(row);
  });
}

function startTimer(task) {
  stopTimerInterval();
  timer = {
    taskId: task.id,
    totalSec: task.duration * 60,
    remainingSec: task.duration * 60,
    running: true,
  };
  $("timer-emoji").textContent = task.emoji;
  $("timer-title").textContent = task.title;
  renderFocusChecklist(task);
  const found = findTask(task.id);
  const next = found ? nextPendingAfter(task, found.dkey) : null;
  $("focus-next").hidden = !next;
  if (next) $("focus-next-task").textContent = `${next.emoji} ${next.title} · ${next.start}`;
  $("ring-fill").style.stroke = task.color;
  $("ring-fill").style.strokeDasharray = RING_CIRC;
  $("timer-pause").textContent = "⏸ Pausar";
  $("timer-overlay").classList.remove("paused");
  $("timer-overlay").hidden = false;
  renderTimerTick();
  timer.intervalId = setInterval(() => {
    if (!timer || !timer.running) return;
    timer.remainingSec--;
    renderTimerTick();
    if (timer.remainingSec <= 0) {
      timer.running = false;
      stopTimerInterval();
      $("timer-remaining").textContent = "00:00";
      toast("⏰ ¡Tiempo cumplido!");
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }, 1000);
}

function renderTimerTick() {
  const s = Math.max(0, timer.remainingSec);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  $("timer-remaining").textContent = mm >= 60
    ? `${Math.floor(mm / 60)}:${pad(mm % 60)}:${pad(ss)}`
    : `${pad(mm)}:${pad(ss)}`;
  const frac = timer.totalSec ? s / timer.totalSec : 0;
  $("ring-fill").style.strokeDashoffset = RING_CIRC * (1 - frac);
}

function stopTimerInterval() {
  if (timer && timer.intervalId) clearInterval(timer.intervalId);
}

$("timer-pause").addEventListener("click", () => {
  if (!timer) return;
  timer.running = !timer.running;
  $("timer-pause").textContent = timer.running ? "⏸ Pausar" : "▶ Reanudar";
  $("timer-overlay").classList.toggle("paused", !timer.running);
});

$("timer-done").addEventListener("click", () => {
  let next = null;
  if (timer) {
    const found = findTask(timer.taskId);
    if (found) {
      found.task.done = true;
      save();
      next = nextPendingAfter(found.task, found.dkey);
    }
  }
  if (next) {
    // auto-avance: seguir enfocada con la siguiente tarea
    toast(`¡Lista! 🎉 Ahora: ${next.title}`);
    startTimer(next);
    renderTimeline();
  } else {
    closeTimer();
    renderTimeline();
    toast("¡Terminaste todo lo pendiente! 🎉🎉");
  }
});

$("timer-close").addEventListener("click", closeTimer);

function closeTimer() {
  stopTimerInterval();
  timer = null;
  $("timer-overlay").hidden = true;
}

/* ---------- rutinas ---------- */
function renderRoutines() {
  const list = $("routines-list");
  list.innerHTML = "";
  if (!data.routines.length && !(data.repeating || []).length) {
    list.innerHTML = `<div class="routines-empty">🔁<br>Aún no tienes rutinas.<br>Crea una con <strong>+</strong></div>`;
    return;
  }
  data.routines.forEach((r) => {
    const total = r.items.reduce((s, it) => s + it.duration, 0);
    const card = document.createElement("div");
    card.className = "routine-card";
    card.innerHTML = `
      <div class="routine-head">
        <span class="routine-emoji">${r.emoji}</span>
        <span class="routine-name">${escapeHtml(r.name)}</span>
        <span class="routine-total">${total} min</span>
      </div>
      <div class="routine-steps">${r.items.map((it) => `${it.emoji} ${escapeHtml(it.title)} · ${it.duration}′`).join("<br>")}</div>
      <div class="routine-actions">
        <button class="btn btn-primary small" data-act="apply">▶ Aplicar al día</button>
        <button class="btn btn-ghost small" data-act="edit">✏️</button>
        <button class="btn btn-ghost small danger" data-act="del">🗑</button>
      </div>`;
    card.querySelector('[data-act="apply"]').addEventListener("click", () => openApplyRoutine(r.id));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => openRoutineForm(r));
    card.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (!confirm(`¿Borrar la rutina "${r.name}"?`)) return;
      data.routines = data.routines.filter((x) => x.id !== r.id);
      save();
      renderRoutines();
    });
    list.appendChild(card);
  });

  // tareas repetidas (plantillas)
  const reps = data.repeating || [];
  if (reps.length) {
    const title = document.createElement("div");
    title.className = "rep-section-title";
    title.textContent = "🔁 Tareas repetidas";
    list.appendChild(title);
    reps.forEach((rep) => {
      const row = document.createElement("div");
      row.className = "rep-row";
      const freq = rep.repeat === "daily" ? "Diaria" : "Semanal";
      const when = rep.anytime ? "sin hora" : rep.start;
      row.innerHTML = `<span>${rep.emoji}</span>
        <span class="rep-title">${escapeHtml(rep.title)} <small style="color:var(--text-soft)">· ${when}</small></span>
        <span class="rep-freq">${freq}</span>
        <button class="rep-del" aria-label="Dejar de repetir">🗑</button>`;
      row.querySelector(".rep-del").addEventListener("click", () => {
        if (!confirm(`¿Dejar de repetir "${rep.title}"? (las ya creadas se mantienen)`)) return;
        deleteRepeating(rep.id);
        renderRoutines();
      });
      list.appendChild(row);
    });
  }
}

/* --- form de rutina --- */
let rfEmoji = "🔁";

function addRoutineItemRow(container, item) {
  const row = document.createElement("div");
  row.className = "rf-item-card";
  row.innerHTML = `
    <div class="rf-item-top">
      <input type="text" class="rf-it-title" placeholder="Paso (ej: Ducharme)" maxlength="80">
      <button type="button" class="remove-check" aria-label="Quitar">✕</button>
    </div>
    <div class="field-row">
      <label class="field"><span>Ícono</span><input type="text" class="rf-it-emoji" maxlength="4" style="width:100%"></label>
      <label class="field"><span>Minutos</span><input type="number" class="rf-it-dur" min="5" max="600" step="5"></label>
    </div>`;
  row.querySelector(".rf-it-title").value = item ? item.title : "";
  row.querySelector(".rf-it-emoji").value = item ? item.emoji : "📝";
  row.querySelector(".rf-it-dur").value = item ? item.duration : 15;
  row.querySelector(".remove-check").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function openRoutineForm(routine) {
  editingRoutineId = routine ? routine.id : null;
  $("rf-heading").textContent = routine ? "Editar rutina" : "Nueva rutina";
  $("rf-name").value = routine ? routine.name : "";
  rfEmoji = routine ? routine.emoji : "🔁";
  buildPicker("rf-emoji-grid", ["🔁","☀️","🌙","🏠","💼","🏃","🧘","📚"], rfEmoji, (v) => (rfEmoji = v), false);
  const cont = $("rf-items");
  cont.innerHTML = "";
  (routine ? routine.items : [null]).forEach((it) => addRoutineItemRow(cont, it));
  openSheet("sheet-routine-form");
}

$("btn-add-routine").addEventListener("click", () => openRoutineForm(null));
$("rf-add-item").addEventListener("click", () => addRoutineItemRow($("rf-items")));
$("rf-cancel").addEventListener("click", () => closeSheet("sheet-routine-form"));

$("rf-save").addEventListener("click", () => {
  const name = $("rf-name").value.trim();
  if (!name) { toast("Ponle un nombre a la rutina"); return; }
  const items = [...$("rf-items").querySelectorAll(".rf-item-card")].map((card, i) => ({
    title: card.querySelector(".rf-it-title").value.trim(),
    emoji: card.querySelector(".rf-it-emoji").value.trim() || "📝",
    duration: Math.max(5, parseInt(card.querySelector(".rf-it-dur").value, 10) || 15),
    color: COLORS[i % COLORS.length],
    checklist: [],
  })).filter((it) => it.title);
  if (!items.length) { toast("Agrega al menos un paso"); return; }

  if (editingRoutineId) {
    const r = data.routines.find((x) => x.id === editingRoutineId);
    if (r) Object.assign(r, { name, emoji: rfEmoji, items });
  } else {
    data.routines.push({ id: uid(), name, emoji: rfEmoji, items });
  }
  save();
  closeSheet("sheet-routine-form");
  renderRoutines();
});

/* --- aplicar rutina --- */
function openApplyRoutine(id) {
  const r = data.routines.find((x) => x.id === id);
  if (!r) return;
  applyRoutineId = id;
  const total = r.items.reduce((s, it) => s + it.duration, 0);
  $("ar-heading").textContent = `${r.emoji} ${r.name}`;
  $("ar-summary").textContent = `${r.items.length} pasos · ${total} min en total. Se agregarán en cadena al día que estás viendo (${$("day-date").textContent}).`;
  const now = new Date();
  const roundedMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  $("ar-start").value = toHHMM(Math.min(roundedMin, 23 * 60));
  openSheet("sheet-apply-routine");
}

$("ar-cancel").addEventListener("click", () => closeSheet("sheet-apply-routine"));

$("ar-apply").addEventListener("click", () => {
  const r = data.routines.find((x) => x.id === applyRoutineId);
  if (!r) return;
  let cursor = toMin($("ar-start").value || "08:00");
  const tasks = tasksFor(dateKey(currentDate));
  r.items.forEach((it) => {
    tasks.push({
      id: uid(), title: it.title, emoji: it.emoji, color: it.color,
      start: toHHMM(cursor), duration: it.duration,
      checklist: (it.checklist || []).map((text) => ({ text, done: false })),
      done: false,
    });
    cursor += it.duration;
  });
  save();
  closeSheet("sheet-apply-routine");
  // volver a la vista Hoy para ver el resultado
  document.querySelector('.tab[data-view="view-today"]').click();
  renderTimeline();
  toast(`Rutina "${r.name}" agregada ✨`);
});

/* ---------- tareas repetidas ---------- */
function ensureRepeats(dkey) {
  if (!data.repeating || !data.repeating.length) return;
  if (!data.repStamped) data.repStamped = {};
  const stamped = data.repStamped[dkey] || (data.repStamped[dkey] = []);
  const dow = new Date(dkey + "T12:00:00").getDay();
  let changed = false;
  for (const rep of data.repeating) {
    if (dkey < rep.createdOn) continue;
    if (rep.repeat === "weekly" && new Date(rep.createdOn + "T12:00:00").getDay() !== dow) continue;
    if (stamped.includes(rep.id)) continue;
    tasksFor(dkey).push({
      id: uid(), title: rep.title, emoji: rep.emoji, color: rep.color,
      start: rep.start, duration: rep.duration, anytime: rep.anytime,
      checklist: (rep.checklist || []).map((text) => ({ text, done: false })),
      done: false, fromRep: rep.id,
    });
    stamped.push(rep.id);
    changed = true;
  }
  if (changed) save();
}

function deleteRepeating(repId) {
  data.repeating = (data.repeating || []).filter((r) => r.id !== repId);
  save();
}

/* ---------- en cualquier momento ---------- */
function renderAnytime(list) {
  const section = $("anytime-section");
  const wrap = $("anytime-list");
  section.hidden = !list.length;
  wrap.innerHTML = "";
  list.forEach((t) => {
    const card = document.createElement("button");
    card.className = "anytime-card" + (t.done ? " done" : "");
    card.style.background = t.color;
    const doneChecks = (t.checklist || []).filter((c) => c.done).length;
    const hint = (t.checklist || []).length ? ` <span class="task-check-hint">☑ ${doneChecks}/${t.checklist.length}</span>` : "";
    card.innerHTML = `<span class="anytime-emoji">${t.emoji}</span>
      <span class="anytime-name">${escapeHtml(t.title)}${hint}</span>
      <span class="anytime-check">${t.done ? "✓" : ""}</span>`;
    card.querySelector(".anytime-check").addEventListener("click", (e) => {
      e.stopPropagation();
      t.done = !t.done;
      save();
      renderTimeline();
      if (t.done) toast("¡Lista! 🎉");
    });
    card.addEventListener("click", () => openTaskDetail(t.id));
    wrap.appendChild(card);
  });
}

/* ---------- racha y ánimo ---------- */
const MOODS = ["😞", "😕", "😐", "🙂", "😄", "🤩"];

function dayActive(k) {
  const done = (data.tasksByDate[k] || []).some((t) => t.done);
  return done || !!(data.moods && data.moods[k]);
}

function computeStreak() {
  let streak = 0;
  const d = new Date();
  if (!dayActive(dateKey(d))) d.setDate(d.getDate() - 1); // hoy aún no cuenta en contra
  while (dayActive(dateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderStreakChip() {
  const s = computeStreak();
  $("streak-chip").textContent = `🔥 ${s} día${s === 1 ? "" : "s"}`;
  const todayMood = data.moods && data.moods[dateKey(new Date())];
  $("btn-mood").textContent = todayMood ? `${todayMood} Hoy` : "🙂 Ánimo";
}

$("btn-mood").addEventListener("click", () => {
  const grid = $("mood-grid");
  grid.innerHTML = "";
  const today = dateKey(new Date());
  const current = data.moods && data.moods[today];
  MOODS.forEach((m) => {
    const b = document.createElement("button");
    b.className = "mood-opt" + (m === current ? " selected" : "");
    b.textContent = m;
    b.addEventListener("click", () => {
      if (!data.moods) data.moods = {};
      data.moods[today] = m;
      save();
      closeSheet("sheet-mood");
      renderStreakChip();
      toast(`Registrado ${m}`);
    });
    grid.appendChild(b);
  });
  openSheet("sheet-mood");
});

/* ---------- reprogramar pendientes ---------- */
function pastPendingTasks() {
  const today = dateKey(new Date());
  const out = [];
  for (const k in data.tasksByDate) {
    if (k >= today) continue;
    data.tasksByDate[k].forEach((t) => { if (!t.done) out.push({ task: t, dkey: k }); });
  }
  return out;
}

function renderReschedulePill() {
  const pill = $("btn-reschedule");
  const viewingToday = dateKey(currentDate) === dateKey(new Date());
  const pend = viewingToday ? pastPendingTasks() : [];
  pill.hidden = !pend.length;
  if (pend.length) {
    $("reschedule-text").textContent =
      `Traer ${pend.length} pendiente${pend.length > 1 ? "s" : ""} de días anteriores`;
  }
}

$("btn-reschedule").addEventListener("click", () => {
  const pend = pastPendingTasks();
  if (!pend.length) return;
  const today = dateKey(new Date());
  pend.forEach(({ task, dkey }) => {
    data.tasksByDate[dkey] = data.tasksByDate[dkey].filter((t) => t.id !== task.id);
    tasksFor(today).push(task);
  });
  save();
  currentDate = new Date();
  renderTimeline();
  toast(`${pend.length} tarea${pend.length > 1 ? "s" : ""} traída${pend.length > 1 ? "s" : ""} a hoy 📥`);
});

/* ---------- vista progreso ---------- */
const DAY_LETTERS_SUN = ["D", "L", "M", "X", "J", "V", "S"];

function statsLastDays(n) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const k = dateKey(d);
    const tasks = data.tasksByDate[k] || [];
    out.push({
      key: k,
      letter: DAY_LETTERS_SUN[d.getDay()],
      done: tasks.filter((t) => t.done).length,
      total: tasks.length,
      mood: data.moods ? data.moods[k] : null,
      isToday: k === dateKey(new Date()),
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function renderStats() {
  const list = $("stats-list");
  const days = statsLastDays(7);
  const todayStats = days[6];
  const weekDone = days.reduce((s, d) => s + d.done, 0);
  let allDone = 0;
  for (const k in data.tasksByDate) allDone += data.tasksByDate[k].filter((t) => t.done).length;
  const streak = computeStreak();
  const maxDone = Math.max(1, ...days.map((d) => d.done));

  const charCard = data.character
    ? `<div class="stats-card char-card">
        <div class="char-scene">
          ${buildAvatarSVG(data.character)}
          <button class="char-edit-btn" id="char-edit" aria-label="Editar personaje">✏️</button>
        </div>
        <div class="char-talk">
          <span class="char-name-tag">${escapeHtml(data.character.name)}</span>
          <div class="char-bubble">${characterMessage()}</div>
        </div>
      </div>`
    : `<div class="stats-card char-invite">
        <p>🏝️ Aún no hay nadie viviendo en tu isla...<br>¡Crea tu personaje!</p>
        <button class="btn btn-primary" id="char-create">✨ Crear personaje</button>
      </div>`;

  list.innerHTML = charCard + `
    <div class="stats-row">
      <div class="stats-card">
        <h3>Racha</h3>
        <div class="medal">
          <span class="medal-emoji">🔥</span>
          <span class="medal-num">${streak}</span>
          <span class="medal-sub">día${streak === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div class="stats-card">
        <h3>Hoy</h3>
        <div class="medal">
          <span class="medal-emoji">✅</span>
          <span class="medal-num">${todayStats.done}<small style="font-size:.8rem;color:var(--text-soft)">/${todayStats.total}</small></span>
          <span class="medal-sub">tareas</span>
        </div>
      </div>
    </div>
    <div class="stats-card">
      <h3>Tareas completadas · últimos 7 días (${weekDone})</h3>
      <div class="bars">
        ${days.map((d) => `
          <div class="bar-col${d.isToday ? " today" : ""}">
            <span class="bar-count">${d.done || ""}</span>
            <div class="bar" style="height:${Math.round((d.done / maxDone) * 78)}px"></div>
            <span class="bar-label">${d.letter}</span>
          </div>`).join("")}
      </div>
    </div>
    <div class="stats-card">
      <h3>Ánimo de la semana</h3>
      <div class="mood-history">
        ${days.map((d) => `
          <div class="mood-day">
            <span class="mood-day-emoji">${d.mood || "·"}</span>
            <span class="mood-day-label">${d.letter}</span>
          </div>`).join("")}
      </div>
    </div>
    <div class="stats-card">
      <h3>Total histórico</h3>
      <div class="medal">
        <span class="medal-emoji">🏆</span>
        <span class="medal-num">${allDone}</span>
        <span class="medal-sub">completadas</span>
      </div>
    </div>`;

  const editBtn = $("char-edit") || $("char-create");
  if (editBtn) editBtn.addEventListener("click", openCharacterEditor);
}

/* ---------- to-do con prioridades ---------- */
const PRIORITIES = [
  { key: "high", label: "▲ Alto", hint: "Necesita concentración" },
  { key: "med", label: "● Medio", hint: "Cuando haya un rato" },
  { key: "low", label: "▼ Bajo", hint: "Si sobra energía" },
];

function renderTodos() {
  const list = $("todo-list");
  list.innerHTML = "";
  const todos = data.todos || [];
  PRIORITIES.forEach(({ key, label, hint }) => {
    const group = todos.filter((t) => t.priority === key);
    const header = document.createElement("div");
    header.className = `prio-header ${key}`;
    header.textContent = `${label} (${group.length})`;
    list.appendChild(header);
    if (!group.length) {
      const empty = document.createElement("div");
      empty.className = "todo-empty-group";
      empty.textContent = hint;
      list.appendChild(empty);
      return;
    }
    group.forEach((t) => {
      const row = document.createElement("div");
      row.className = "todo-row" + (t.done ? " done" : "");
      row.innerHTML = `
        <button class="todo-check">${t.done ? "✓" : ""}</button>
        <span class="todo-emoji">${t.emoji}</span>
        <div class="todo-body">
          <div class="todo-title">${escapeHtml(t.title)}</div>
          <div class="todo-dur">${t.duration} min</div>
        </div>
        <button class="todo-act" title="Planificar hoy">📅</button>
        <button class="todo-act" title="Borrar">🗑</button>`;
      row.querySelector(".todo-check").addEventListener("click", () => {
        t.done = !t.done;
        save();
        renderTodos();
        if (t.done) toast("¡Lista! 🎉");
      });
      row.querySelectorAll(".todo-act")[0].addEventListener("click", () => {
        // pasa al día de hoy como tarea "en cualquier momento"
        tasksFor(dateKey(new Date())).push({
          id: uid(), title: t.title, emoji: t.emoji, color: COLORS[2],
          start: "09:00", duration: t.duration, anytime: true,
          checklist: [], done: false,
        });
        data.todos = data.todos.filter((x) => x.id !== t.id);
        save();
        renderTodos();
        toast("Movida a Hoy 📅");
      });
      row.querySelectorAll(".todo-act")[1].addEventListener("click", () => {
        if (!confirm(`¿Borrar "${t.title}"?`)) return;
        data.todos = data.todos.filter((x) => x.id !== t.id);
        save();
        renderTodos();
      });
      list.appendChild(row);
    });
  });
}

$("btn-add-todo").addEventListener("click", () => {
  $("todo-title").value = "";
  $("todo-priority").value = "med";
  $("todo-duration").value = 30;
  openSheet("sheet-todo-form");
  setTimeout(() => $("todo-title").focus(), 250);
});
$("todo-cancel").addEventListener("click", () => closeSheet("sheet-todo-form"));

$("todo-save").addEventListener("click", () => {
  const title = $("todo-title").value.trim();
  if (!title) { toast("Escribe qué tienes pendiente 🙂"); return; }
  if (!data.todos) data.todos = [];
  const lib = classifyTask(title);
  data.todos.push({
    id: uid(), title,
    emoji: lib ? lib.emoji : "📝",
    priority: $("todo-priority").value,
    duration: Math.max(5, parseInt($("todo-duration").value, 10) || 30),
    done: false,
  });
  save();
  closeSheet("sheet-todo-form");
  renderTodos();
});

/* ---------- personaje de la isla ---------- */
const SKIN_TONES = ["#ffe0c2", "#f5c99b", "#d9a066", "#a06b42"];
const HAIR_COLORS = ["#4a3220", "#8a5a2b", "#e8b64c", "#c94f2e", "#5a5a6e", "#8e6fc4"];
const SHIRT_COLORS = ["#6fb14e", "#5a79d6", "#e8825f", "#f2c14e", "#c98bc9", "#4fb0a5"];
const HAIR_STYLES = [
  { key: "clasico", label: "Clásico" },
  { key: "coletas", label: "Coletas" },
  { key: "monito", label: "Moño" },
  { key: "puntas", label: "Puntas" },
];
const EYE_STYLES = [
  { key: "redondos", label: "Redondos" },
  { key: "felices", label: "Felices" },
  { key: "brillo", label: "Brillo ✨" },
];

function buildAvatarSVG(c) {
  // pelo trasero (marco alrededor de la cabeza) + flequillo delantero por estilo
  const hairBack = {
    clasico: `<circle cx="60" cy="54" r="39" fill="${c.hairColor}"/>`,
    coletas: `<circle cx="60" cy="54" r="39" fill="${c.hairColor}"/>
      <circle cx="17" cy="72" r="12" fill="${c.hairColor}"/>
      <circle cx="103" cy="72" r="12" fill="${c.hairColor}"/>
      <circle cx="24" cy="63" r="3.4" fill="#e05d5d"/>
      <circle cx="96" cy="63" r="3.4" fill="#e05d5d"/>`,
    monito: `<circle cx="60" cy="54" r="39" fill="${c.hairColor}"/>
      <circle cx="60" cy="13" r="12" fill="${c.hairColor}"/>
      <circle cx="60" cy="21" r="3.4" fill="#e05d5d"/>`,
    puntas: `<circle cx="60" cy="54" r="39" fill="${c.hairColor}"/>
      <path d="M36 22 L40 8 L47 19 Z M53 17 L60 3 L67 17 Z M73 19 L80 8 L84 22 Z" fill="${c.hairColor}"/>`,
  };
  const fringe = c.hair === "puntas"
    ? `<path d="M28 54 Q28 23 60 23 Q92 23 92 54 L84 41 L79 52 L71 38 L64 50 L56 38 L48 50 L41 40 L35 52 Z" fill="${c.hairColor}"/>`
    : `<path d="M28 55 Q27 22 60 22 Q93 22 92 55 Q87 43 77 47 Q71 36 60 38 Q49 36 43 47 Q33 43 28 55 Z" fill="${c.hairColor}"/>`;

  const eyes = {
    redondos: `<ellipse cx="45" cy="63" rx="5" ry="7" fill="#2f2620"/>
      <ellipse cx="75" cy="63" rx="5" ry="7" fill="#2f2620"/>
      <circle cx="46.6" cy="60" r="1.8" fill="#fff"/>
      <circle cx="76.6" cy="60" r="1.8" fill="#fff"/>`,
    felices: `<path d="M39 63 Q45 55 51 63" stroke="#2f2620" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M69 63 Q75 55 81 63" stroke="#2f2620" stroke-width="3.4" fill="none" stroke-linecap="round"/>`,
    brillo: `<ellipse cx="45" cy="63" rx="5.5" ry="7.5" fill="#2f2620"/>
      <ellipse cx="75" cy="63" rx="5.5" ry="7.5" fill="#2f2620"/>
      <circle cx="46.8" cy="59.5" r="2.2" fill="#fff"/>
      <circle cx="76.8" cy="59.5" r="2.2" fill="#fff"/>
      <circle cx="43" cy="65.5" r="1.1" fill="#fff"/>
      <circle cx="73" cy="65.5" r="1.1" fill="#fff"/>`,
  };

  return `<svg viewBox="0 0 120 152" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="60" cy="146" rx="26" ry="4.5" fill="rgba(0,0,0,.12)"/>
    <!-- piernas y zapatos -->
    <rect x="48" y="122" width="9" height="16" rx="4.5" fill="${c.skin}"/>
    <rect x="63" y="122" width="9" height="16" rx="4.5" fill="${c.skin}"/>
    <ellipse cx="52" cy="140" rx="8.5" ry="5" fill="#8a5a33"/>
    <ellipse cx="68" cy="140" rx="8.5" ry="5" fill="#8a5a33"/>
    <!-- bracitos -->
    <ellipse cx="34" cy="106" rx="6" ry="11" fill="${c.skin}" transform="rotate(18 34 106)"/>
    <ellipse cx="86" cy="106" rx="6" ry="11" fill="${c.skin}" transform="rotate(-18 86 106)"/>
    <!-- polera -->
    <path d="M40 92 Q60 88 80 92 L84 122 Q60 127 36 122 Z" fill="${c.shirt}"/>
    <path d="M40 92 L32 100 L38 106 L44 98 Z" fill="${c.shirt}"/>
    <path d="M80 92 L88 100 L82 106 L76 98 Z" fill="${c.shirt}"/>
    <!-- pelo trasero -->
    ${hairBack[c.hair] || hairBack.clasico}
    <!-- cara -->
    <circle cx="60" cy="60" r="33" fill="${c.skin}"/>
    <!-- flequillo -->
    ${fringe}
    <!-- ojos -->
    ${eyes[c.eyes] || eyes.redondos}
    <!-- nariz triangulito -->
    <path d="M56.5 71 L63.5 71 L60 76 Z" fill="rgba(140, 85, 40, .6)"/>
    <!-- boca -->
    <path d="M54 81 Q60 86.5 66 81" stroke="#2f2620" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <!-- chapitas -->
    <ellipse cx="38" cy="74" rx="5.5" ry="3.4" fill="#f5a3a3" opacity=".65"/>
    <ellipse cx="82" cy="74" rx="5.5" ry="3.4" fill="#f5a3a3" opacity=".65"/>
  </svg>`;
}

let chDraft = null;

function defaultCharacter() {
  return { name: "", skin: SKIN_TONES[1], hair: "clasico", hairColor: HAIR_COLORS[0], eyes: "redondos", shirt: SHIRT_COLORS[0] };
}

function buildStylePicker(gridId, styles, selectedKey, onPick) {
  const grid = $(gridId);
  grid.innerHTML = "";
  styles.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "style-opt" + (s.key === selectedKey ? " selected" : "");
    b.textContent = s.label;
    b.addEventListener("click", () => {
      onPick(s.key);
      grid.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    grid.appendChild(b);
  });
}

function refreshCharPreview() {
  $("char-preview").innerHTML = buildAvatarSVG(chDraft);
}

function openCharacterEditor() {
  chDraft = Object.assign(defaultCharacter(), data.character || {});
  $("ch-name").value = chDraft.name || "";
  buildPicker("ch-skin", SKIN_TONES, chDraft.skin, (v) => { chDraft.skin = v; refreshCharPreview(); }, true);
  buildStylePicker("ch-hair", HAIR_STYLES, chDraft.hair, (v) => { chDraft.hair = v; refreshCharPreview(); });
  buildPicker("ch-haircolor", HAIR_COLORS, chDraft.hairColor, (v) => { chDraft.hairColor = v; refreshCharPreview(); }, true);
  buildStylePicker("ch-eyes", EYE_STYLES, chDraft.eyes, (v) => { chDraft.eyes = v; refreshCharPreview(); });
  buildPicker("ch-shirt", SHIRT_COLORS, chDraft.shirt, (v) => { chDraft.shirt = v; refreshCharPreview(); }, true);
  refreshCharPreview();
  openSheet("sheet-character");
}

$("ch-cancel").addEventListener("click", () => closeSheet("sheet-character"));
$("ch-save").addEventListener("click", () => {
  chDraft.name = $("ch-name").value.trim() || "Isleño/a";
  data.character = chDraft;
  save();
  closeSheet("sheet-character");
  renderStats();
  toast(`¡Hola, ${chDraft.name}! 🏝️`);
});

function characterMessage() {
  const streak = computeStreak();
  const k = dateKey(new Date());
  const tasks = data.tasksByDate[k] || [];
  const done = tasks.filter((t) => t.done).length;
  const pending = tasks.length - done;
  const h = new Date().getHours();
  const saludo = h < 12 ? "¡Buenos días!" : h < 20 ? "¡Buenas tardes!" : "¡Buenas noches!";
  if (streak >= 3) return `${saludo} Llevas ${streak} días seguidos cuidando tu isla. ¡Increíble! 🔥`;
  if (pending === 0 && done > 0) return `${saludo} ¡Terminaste todo lo de hoy! Hora de descansar bajo un árbol 🌳`;
  if (done > 0) return `${saludo} Ya llevas ${done} tarea${done > 1 ? "s" : ""} hoy. Pasito a pasito 🐾`;
  if (pending > 0) return `${saludo} Hay ${pending} cosita${pending > 1 ? "s" : ""} esperando. ¿Partimos con una chiquitita?`;
  return `${saludo} Día tranquilo en la isla. Si quieres, planificamos algo juntas 🍃`;
}

/* ---------- captura por voz + divisor de tareas ---------- */

/* Biblioteca de tipos de tarea: palabra clave → emoji, duración y subpasos pequeños.
   Todo local, pensado para cerebros TDAH: pasos chicos, arranque de 5 minutos. */
const TASK_LIB = [
  { kw: ["limpiar","ordenar","aseo","barrer","aspirar"], emoji: "🧹", dur: 30, color: "#b7e4c7",
    steps: ["Poner un timer o música", "Despejar las superficies", "Guardar cada cosa en su lugar", "Pasada final rápida"] },
  { kw: ["cocinar","cocina","almuerzo","cena","comida","desayuno"], emoji: "🍳", dur: 40, color: "#ffe08a",
    steps: ["Decidir qué preparar", "Sacar los ingredientes", "Cocinar", "Servir y dejar la cocina lista"] },
  { kw: ["informe","documento","escribir","redactar","ensayo","tesis","presentación","planificación"], emoji: "📝", dur: 45, color: "#cdb4f6",
    steps: ["Abrir el documento", "Escribir 5 minutos sin parar", "Desarrollar las ideas principales", "Releer y guardar"] },
  { kw: ["llamar","llamada","teléfono","telefono"], emoji: "📞", dur: 10, color: "#a8d8f0",
    steps: ["Buscar el número", "Anotar qué necesito decir", "Hacer la llamada"] },
  { kw: ["correo","correos","email","mail","responder mensajes"], emoji: "💌", dur: 15, color: "#f4acb7",
    steps: ["Abrir la bandeja", "Responder solo lo urgente", "Archivar el resto"] },
  { kw: ["comprar","compras","supermercado","feria","mercado"], emoji: "🛒", dur: 40, color: "#ffb4a2",
    steps: ["Hacer la lista", "Revisar qué falta en casa", "Ir a comprar", "Guardar las compras"] },
  { kw: ["estudiar","leer","curso","clase","repasar"], emoji: "📚", dur: 40, color: "#b5c7f7",
    steps: ["Preparar el material", "Estudiar 25 minutos enfocada", "Pausa de 5 minutos", "Repasar lo aprendido"] },
  { kw: ["lavar la ropa","ropa","lavadora","colgar","doblar"], emoji: "🧺", dur: 15, color: "#d8e2dc",
    steps: ["Juntar la ropa", "Poner la lavadora", "Colgar o doblar cuando termine"] },
  { kw: ["ducha","ducharme","bañarme","baño personal"], emoji: "🚿", dur: 15, color: "#a8d8f0", steps: [] },
  { kw: ["ejercicio","caminar","gimnasio","yoga","entrenar","trotar"], emoji: "🏃", dur: 30, color: "#b7e4c7",
    steps: ["Ponerme ropa cómoda", "Empezar suave 5 minutos", "Completar la sesión"] },
  { kw: ["pagar","cuenta","cuentas","banco","trámite","tramite"], emoji: "🧾", dur: 20, color: "#ffe08a",
    steps: ["Juntar los datos necesarios", "Hacer el pago o trámite", "Guardar el comprobante"] },
  { kw: ["doctor","médico","medico","dentista","hora médica","remedio","medicamento"], emoji: "💊", dur: 15, color: "#f4acb7", steps: [] },
  { kw: ["perro","gato","mascota","veterinario"], emoji: "🐶", dur: 20, color: "#ffb4a2", steps: [] },
  { kw: ["regar","plantas","jardín","jardin"], emoji: "🌱", dur: 10, color: "#b7e4c7", steps: [] },
  { kw: ["reunión","reunion","junta","meet"], emoji: "👥", dur: 30, color: "#b5c7f7",
    steps: ["Revisar el tema antes", "Anotar mis puntos", "Participar", "Anotar acuerdos"] },
];
const GENERIC_STEPS = ["Preparar lo que necesito", "Empezar con solo 5 minutos", "Seguir hasta terminar", "Cerrar y dejar listo"];

// verbos que marcan el inicio de una tarea nueva al dividir por " y "
const TASK_VERBS = /^(llamar|escribir|ordenar|limpiar|comprar|hacer|estudiar|preparar|revisar|enviar|mandar|pagar|sacar|lavar|cocinar|ir|terminar|leer|responder|agendar|organizar|planchar|regar|bañar|ducharme|entrenar|caminar|buscar|llevar|recoger|arreglar|regar)\b/i;

function extractDuration(text) {
  let dur = null;
  let t = text;
  const min = t.match(/(\d+)\s*(?:min(?:utos)?)/i);
  const hrs = t.match(/(\d+)\s*horas?/i);
  if (min) { dur = parseInt(min[1], 10); t = t.replace(min[0], ""); }
  else if (/hora y media/i.test(t)) { dur = 90; t = t.replace(/(?:una\s+)?hora y media/i, ""); }
  else if (/media hora/i.test(t)) { dur = 30; t = t.replace(/media hora/i, ""); }
  else if (/una hora/i.test(t)) { dur = 60; t = t.replace(/una hora/i, ""); }
  else if (hrs) { dur = parseInt(hrs[1], 10) * 60; t = t.replace(hrs[0], ""); }
  else if (/\b(rápido|rapido|cortito|breve)\b/i.test(t)) { dur = 10; t = t.replace(/\b(rápido|rapido|cortito|breve)\b/i, ""); }
  t = t.replace(/\b(como|en|de|por|unos?)\s*$/i, "").trim();
  return { dur, text: t };
}

// verbos que suelen INICIAR una tarea nueva en dictado sin comas
const VERB_SET = new Set(["ordenar","limpiar","escribir","llamar","comprar","estudiar","preparar","revisar","enviar","mandar","pagar","sacar","lavar","cocinar","terminar","leer","responder","agendar","organizar","planchar","regar","hacer","entrenar","caminar","buscar","llevar","recoger","arreglar","tomar","avanzar","redactar","barrer","aspirar"]);
// si la palabra anterior es una de estas, el verbo NO inicia tarea nueva ("tengo que hacer", "ir a comprar")
const NO_SPLIT_PREV = new Set(["a","de","para","que","y","e","o","al","del","no","me","te","se","lo","la","voy","tengo","debo","necesito","quiero","puedo","hay"]);

function splitByVerbs(s) {
  const words = s.split(/\s+/);
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/[^a-záéíóúñü]/g, "");
    const prev = i > 0 ? words[i - 1].toLowerCase().replace(/[^a-záéíóúñü]/g, "") : "";
    if (i > 0 && cur.length >= 2 && VERB_SET.has(w) && !NO_SPLIT_PREV.has(prev)) {
      out.push(cur.join(" "));
      cur = [];
    }
    cur.push(words[i]);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

function splitIntoTaskPhrases(raw) {
  // separadores fuertes primero
  let parts = raw.split(/\s*(?:,|;|\.|\n|y luego\b|y después\b|después\b|luego\b|también tengo que\b|también\b|además\b)\s*/i);
  // dividir por " y " solo si lo que sigue parte con un verbo de tarea
  const out = [];
  for (const p of parts) {
    let rest = p;
    while (true) {
      const m = rest.match(/\s+y\s+(.+)$/i);
      if (m && TASK_VERBS.test(m[1].trim())) {
        out.push(rest.slice(0, m.index));
        rest = m[1];
      } else break;
    }
    out.push(rest);
  }
  // dictado sin comas: cortar donde aparece un verbo de tarea nuevo
  const final = [];
  for (const p of out) final.push(...splitByVerbs(p));
  return final.map((s) => s.trim()).filter((s) => s.length > 2);
}

function cleanTaskTitle(s) {
  let t = s.replace(/^(tengo que|hay que|debo|necesito|me toca|quiero|tengo|voy a|además|ademas|encima)\s+/i, "").trim();
  if (!t) return "";
  return t[0].toUpperCase() + t.slice(1);
}

function classifyTask(title) {
  const low = title.toLowerCase();
  for (const entry of TASK_LIB) {
    if (entry.kw.some((k) => low.includes(k))) return entry;
  }
  return null;
}

function parseBrainDump(raw) {
  const phrases = splitIntoTaskPhrases(raw);
  const tasks = [];
  phrases.forEach((phrase, i) => {
    const { dur: cueDur, text } = extractDuration(phrase);
    const title = cleanTaskTitle(text);
    if (!title) return;
    const lib = classifyTask(title);
    tasks.push({
      title,
      emoji: lib ? lib.emoji : "📝",
      color: lib ? lib.color : COLORS[i % COLORS.length],
      duration: cueDur || (lib ? lib.dur : 25),
      steps: lib ? lib.steps.slice() : GENERIC_STEPS.slice(),
      keep: true,
    });
  });
  return tasks;
}

/* --- UI de captura --- */
let proposedPlan = [];
let recognition = null;
let listening = false;

$("btn-capture").addEventListener("click", () => {
  $("capture-text").value = "";
  stopListening();
  openSheet("sheet-capture");
});
$("capture-cancel").addEventListener("click", () => { stopListening(); closeSheet("sheet-capture"); });

let micFinals = {};      // índice → texto final (evita duplicados de iOS)
let micTimeout = null;   // tope de seguridad

function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "es-CL";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    // iOS repite resultados finales: guardarlos por índice los deduplica
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) micFinals[i] = e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const final = Object.keys(micFinals).sort((a, b) => a - b).map((k) => micFinals[k]).join(" ");
    $("capture-text").value = (final + " " + interim).replace(/\s+/g, " ").trim();
  };
  rec.onend = () => { if (listening) stopListening(); };
  rec.onerror = () => {
    stopListening();
    toast("No pude escuchar 😕 Usa el micrófono del teclado o escribe.");
  };
  return rec;
}

function stopListening() {
  listening = false;
  clearTimeout(micTimeout);
  if (recognition) {
    try { recognition.abort(); } catch (e) {
      try { recognition.stop(); } catch (e2) {}
    }
  }
  $("mic-btn").classList.remove("listening");
  $("mic-icon").textContent = "🎤";
  $("mic-label").textContent = "Toca para dictar";
}

$("mic-btn").addEventListener("click", () => {
  if (listening) { stopListening(); return; }
  if (!recognition) recognition = setupRecognition();
  if (!recognition) {
    toast("Tu navegador no tiene dictado directo. Usa el 🎤 del teclado en el cuadro de texto.");
    $("capture-text").focus();
    return;
  }
  try {
    micFinals = {};
    recognition.start();
    listening = true;
    $("mic-btn").classList.add("listening");
    $("mic-icon").textContent = "🔴";
    $("mic-label").textContent = "Escuchando... toca para parar";
    // tope de seguridad: nunca escuchar más de 60 s seguidos
    clearTimeout(micTimeout);
    micTimeout = setTimeout(() => { if (listening) { stopListening(); toast("Listo 🎤 revisa el texto y divide"); } }, 60000);
  } catch (e) {
    stopListening();
  }
});

$("capture-plan").addEventListener("click", () => {
  stopListening();
  const raw = $("capture-text").value.trim();
  if (!raw) { toast("Dicta o escribe algo primero 🙂"); return; }
  proposedPlan = parseBrainDump(raw);
  if (!proposedPlan.length) { toast("No entendí tareas ahí. Intenta de nuevo 🙂"); return; }
  closeSheet("sheet-capture");
  renderPlanPreview();
  const now = new Date();
  const roundedMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  $("plan-start").value = toHHMM(Math.min(roundedMin, 23 * 60));
  openSheet("sheet-plan");
});

function renderPlanPreview() {
  const list = $("plan-list");
  list.innerHTML = "";
  proposedPlan.forEach((t) => {
    const card = document.createElement("div");
    card.className = "plan-task" + (t.keep ? "" : " removed");
    card.style.background = t.color;
    card.innerHTML = `
      <span class="plan-task-emoji">${t.emoji}</span>
      <div class="plan-task-body">
        <div class="plan-task-title">${escapeHtml(t.title)}</div>
        <div class="plan-task-dur">${t.duration} min</div>
        ${t.steps.length ? `<div class="plan-task-steps">${t.steps.map((s) => "· " + escapeHtml(s)).join("<br>")}</div>` : ""}
      </div>
      <button class="plan-task-remove" aria-label="Quitar">${t.keep ? "✕" : "↩"}</button>`;
    card.querySelector(".plan-task-remove").addEventListener("click", () => {
      t.keep = !t.keep;
      renderPlanPreview();
    });
    list.appendChild(card);
  });
}

$("plan-cancel").addEventListener("click", () => {
  closeSheet("sheet-plan");
  openSheet("sheet-capture");
});

$("plan-apply").addEventListener("click", () => {
  const chosen = proposedPlan.filter((t) => t.keep);
  if (!chosen.length) { toast("No queda ninguna tarea en el plan"); return; }
  let cursor = toMin($("plan-start").value || "09:00");
  const tasks = tasksFor(dateKey(currentDate));
  chosen.forEach((t) => {
    tasks.push({
      id: uid(), title: t.title, emoji: t.emoji, color: t.color,
      start: toHHMM(cursor), duration: t.duration,
      checklist: t.steps.map((text) => ({ text, done: false })),
      done: false,
    });
    cursor += t.duration;
  });
  save();
  closeSheet("sheet-plan");
  renderTimeline();
  toast(`${chosen.length} tarea${chosen.length > 1 ? "s" : ""} agregada${chosen.length > 1 ? "s" : ""} ✨`);
});

/* ---------- google calendar (solo lectura) ---------- */
// Pega aquí el ID de cliente OAuth (termina en .apps.googleusercontent.com).
// Mientras esté vacío, el botón de conectar no se muestra.
const GCAL_CLIENT_ID = "505796645595-bgpoe88bere3634ch9si9md6slku956g.apps.googleusercontent.com";
// events = leer eventos + crear recordatorios (la app nunca borra ni toca otros eventos)
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";

let gcalToken = null;       // { token, exp }
let gcalTokenClient = null;
let gcalCache = {};         // dkey -> eventos

try { gcalToken = JSON.parse(localStorage.getItem("midia-gcal-token")); } catch (e) {}
const gcalValid = () => gcalToken && Date.now() < gcalToken.exp;

function loadGIS() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

function gcalConnect(interactive) {
  if (!GCAL_CLIENT_ID) return;
  loadGIS().then(() => {
    if (!gcalTokenClient) {
      gcalTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GCAL_CLIENT_ID,
        scope: GCAL_SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) {
            gcalToken = { token: resp.access_token, exp: Date.now() + (resp.expires_in - 90) * 1000 };
            localStorage.setItem("midia-gcal-token", JSON.stringify(gcalToken));
            localStorage.setItem("midia-gcal-connected", "1");
            gcalCache = {};
            updateGcalPill();
            renderGcal();
            toast("Google Calendar conectado 📅");
          }
        },
      });
    }
    // si ya se conectó antes, reconectar sin pantallas (un toque y listo)
    const yaConectada = localStorage.getItem("midia-gcal-connected") === "1";
    gcalTokenClient.requestAccessToken({ prompt: interactive && !yaConectada ? "consent" : "" });
  }).catch(() => { if (interactive) toast("No pude cargar Google. ¿Tienes internet?"); });
}

$("btn-gcal").addEventListener("click", () => gcalConnect(true));

function updateGcalPill() {
  const pill = $("btn-gcal");
  if (!GCAL_CLIENT_ID) { pill.hidden = true; return; }
  pill.hidden = gcalValid();
  $("gcal-pill-text").textContent = localStorage.getItem("midia-gcal-connected") === "1"
    ? "Reconectar Google Calendar"
    : "Conectar Google Calendar";
}

async function fetchGcalEvents(dkey) {
  if (gcalCache[dkey]) return gcalCache[dkey];
  if (!gcalValid()) return null;
  const timeMin = new Date(dkey + "T00:00:00").toISOString();
  const timeMax = new Date(dkey + "T23:59:59").toISOString();
  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    + "?singleEvents=true&orderBy=startTime&maxResults=50"
    + "&timeMin=" + encodeURIComponent(timeMin)
    + "&timeMax=" + encodeURIComponent(timeMax);
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + gcalToken.token } });
    if (r.status === 401 || r.status === 403) {
      localStorage.removeItem("midia-gcal-token");
      gcalToken = null;
      updateGcalPill();
      return null;
    }
    const j = await r.json();
    const evs = (j.items || [])
      .filter((e) => e.status !== "cancelled")
      .map((e) => {
        const allDay = !!(e.start && e.start.date);
        let startMin = 0, endMin = 0;
        if (!allDay) {
          const s = new Date(e.start.dateTime);
          const en = new Date(e.end.dateTime);
          startMin = s.getHours() * 60 + s.getMinutes();
          endMin = en.getHours() * 60 + en.getMinutes();
          if (endMin <= startMin) endMin = startMin + 30;
        }
        return { title: e.summary || "(sin título)", allDay, startMin, endMin };
      });
    gcalCache[dkey] = evs;
    return evs;
  } catch (e) { return null; } // sin internet: silencio, la app sigue igual
}

async function renderGcal() {
  const dkey = dateKey(currentDate);
  const layer = $("gcal-layer");
  const alldayWrap = $("gcal-allday-wrap");
  const alldayList = $("gcal-allday-list");
  layer.innerHTML = "";
  alldayList.innerHTML = "";
  alldayWrap.hidden = true;
  const evs = await fetchGcalEvents(dkey);
  if (!evs || dkey !== dateKey(currentDate)) return; // cambió el día mientras cargaba
  const allday = evs.filter((e) => e.allDay);
  const timed = evs.filter((e) => !e.allDay);
  if (allday.length) {
    alldayWrap.hidden = false;
    allday.forEach((e) => {
      const div = document.createElement("div");
      div.className = "gcal-allday";
      div.innerHTML = `<span>📅</span><span>${escapeHtml(e.title)}</span>`;
      alldayList.appendChild(div);
    });
  }
  timed.forEach((e) => {
    const top = (e.startMin / 60) * HOUR_H;
    const height = Math.max(((e.endMin - e.startMin) / 60) * HOUR_H, 30);
    const div = document.createElement("div");
    div.className = "gcal-block";
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;
    div.innerHTML = `<div class="gcal-title">📅 ${escapeHtml(e.title)}</div>
      <div class="gcal-time">${toHHMM(e.startMin)} – ${toHHMM(e.endMin)}</div>`;
    layer.appendChild(div);
  });
}

/* --- recordatorios: enviar tareas de hoy a Google Calendar con alarma --- */
async function sendRemindersToCalendar() {
  if (!GCAL_CLIENT_ID) return;
  if (!gcalValid()) {
    gcalConnect(true);
    toast("Conectando con Google... toca 🔔 de nuevo en un momento");
    return;
  }
  const dkey = dateKey(currentDate);
  if (!data.gcalPushed) data.gcalPushed = {};
  if (!data.gcalPushed[dkey]) data.gcalPushed[dkey] = {};
  const pushed = data.gcalPushed[dkey];
  const tasks = tasksFor(dkey).filter((t) => !t.done && !t.anytime && !pushed[t.id]);
  if (!tasks.length) { toast("Nada nuevo que recordar 🙂"); return; }
  let ok = 0;
  for (const t of tasks) {
    const startDate = new Date(dkey + "T" + t.start + ":00");
    const body = {
      summary: `${t.emoji} ${t.title}`,
      description: "Creado por Mi Día 🏝️",
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: new Date(startDate.getTime() + t.duration * 60000).toISOString() },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }, { method: "popup", minutes: 0 }] },
    };
    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: "Bearer " + gcalToken.token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 401 || r.status === 403) {
        localStorage.removeItem("midia-gcal-token");
        gcalToken = null;
        updateGcalPill();
        toast("Permiso vencido: toca conectar y reintenta 🔄");
        return;
      }
      if (r.ok) {
        const j = await r.json();
        pushed[t.id] = j.id;
        ok++;
      }
    } catch (e) { toast("Sin internet 😕 inténtalo más tarde"); break; }
  }
  save();
  gcalCache = {};
  renderGcal();
  if (ok) toast(`🔔 ${ok} recordatorio${ok > 1 ? "s" : ""} creado${ok > 1 ? "s" : ""} en tu Calendar`);
}

$("btn-remind").addEventListener("click", sendRemindersToCalendar);

// intento silencioso al abrir si ya estuvo conectada y el token venció
if (GCAL_CLIENT_ID && localStorage.getItem("midia-gcal-connected") === "1" && !gcalValid() && navigator.onLine) {
  setTimeout(() => gcalConnect(false), 1200);
}

/* ---------- init ---------- */
load();
buildHours();
renderTimeline();
scrollToNow();
setInterval(() => { updateNowLine(); updateFocusPill(); }, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
