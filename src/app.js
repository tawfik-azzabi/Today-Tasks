/* ===== TODAY TASKS — app.js ===== */
'use strict';

/* ===== STORAGE ===== */
const Store = {
  key: 'todaytasks_v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || this.defaults(); }
    catch { return this.defaults(); }
  },
  save(data) {
    localStorage.setItem(this.key, JSON.stringify(data));
  },
  defaults() {
    return {
      tasks: [],
      scratchpad: '',
      theme: 'light',
      notifDismissed: false,
      lastCleanup: new Date().toDateString()
    };
  }
};

/* ===== STATE ===== */
let state = Store.load();
let dragSrc = null;
let editingId = null;
let currentView = 'today'; // today | tomorrow | backlog
let filterPrio = 'all'; // all | p1 | p2 | p3

/* ===== UTILS ===== */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function today() { return new Date().toDateString(); }
function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toDateString();
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function save() { Store.save(state); }

/* ===== RECURRING TASK ENGINE ===== */
function processRecurring() {
  const td = today();
  if (state.lastCleanup === td) return;
  state.lastCleanup = td;

  state.tasks.forEach(t => {
    if (!t.recur || t.recur === 'none') return;
    if (t.recurDate === td) return; // already generated today

    const spawn = t.recur === 'daily' ||
      (t.recur === 'weekly' && shouldRunWeekly(t)) ||
      (t.recur === 'monthly' && shouldRunMonthly(t));

    if (spawn) {
      state.tasks.push({
        ...t,
        id: uid(),
        done: false,
        date: td,
        starred: false,
        isRecurInstance: true,
        recur: 'none',
        recurDate: null,
        createdAt: Date.now()
      });
      t.recurDate = td;
    }
  });
  save();
}
function shouldRunWeekly(t) {
  const base = new Date(t.createdAt);
  const now = new Date();
  return base.getDay() === now.getDay();
}
function shouldRunMonthly(t) {
  const base = new Date(t.createdAt);
  const now = new Date();
  return base.getDate() === now.getDate();
}

/* ===== REMINDER ENGINE ===== */
let reminderTimers = {};
function scheduleReminders() {
  Object.values(reminderTimers).forEach(clearTimeout);
  reminderTimers = {};

  state.tasks.forEach(t => {
    if (!t.reminderTime || t.done) return;
    const [h, m] = t.reminderTime.split(':').map(Number);
    const now = new Date();
    const fire = new Date();
    fire.setHours(h, m, 0, 0);
    const diff = fire - now;
    if (diff > 0 && diff < 86400000) {
      reminderTimers[t.id] = setTimeout(() => {
        triggerReminder(t);
      }, diff);
    }
  });
}
function triggerReminder(task) {
  const msg = `⏰ Rappel : ${task.text}`;
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Today Tasks', { body: task.text, icon: '/favicon.ico' });
  } else {
    showNotif(msg);
  }
}
function showNotif(msg, duration = 3000) {
  const el = document.createElement('div');
  el.className = 'notif';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ===== TASK CRUD ===== */
function addTask(text, priority, view) {
  text = text.trim();
  if (!text) return;
  const t = {
    id: uid(),
    text,
    priority: priority || 'p2',
    done: false,
    note: '',
    reminderTime: '',
    recur: 'none',
    recurDate: null,
    starred: false,
    date: view === 'tomorrow' ? tomorrow() : view === 'backlog' ? 'backlog' : today(),
    createdAt: Date.now(),
    order: state.tasks.length
  };
  state.tasks.unshift(t);
  save();
  render();
  showNotif(`Tâche ajoutée : ${text.slice(0, 40)}`);
}

function toggleDone(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done) t.doneAt = Date.now();
  save();
  render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(x => x.id !== id);
  save();
  render();
}

function toggleStar(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.starred = !t.starred;
  save();
  render();
}

function saveEdit(id, text, note, reminderTime, priority, recur) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.text = text.trim() || t.text;
  t.note = note.trim();
  t.reminderTime = reminderTime;
  t.priority = priority;
  t.recur = recur;
  editingId = null;
  save();
  scheduleReminders();
  render();
}

function moveTask(id, dir) {
  const td = today(), tm = tomorrow();
  const arr = getFilteredTasks();
  const idx = arr.findIndex(x => x.id === id);
  if (dir === 'up' && idx > 0) {
    const tmp = arr[idx].order;
    arr[idx].order = arr[idx - 1].order;
    arr[idx - 1].order = tmp;
    save(); render();
  } else if (dir === 'down' && idx < arr.length - 1) {
    const tmp = arr[idx].order;
    arr[idx].order = arr[idx + 1].order;
    arr[idx + 1].order = tmp;
    save(); render();
  }
}

/* ===== FILTERING ===== */
function getFilteredTasks() {
  let tasks = state.tasks.filter(t => {
    if (currentView === 'today') return t.date === today();
    if (currentView === 'tomorrow') return t.date === tomorrow();
    if (currentView === 'backlog') return t.date === 'backlog';
    return false;
  });
  if (filterPrio !== 'all') tasks = tasks.filter(t => t.priority === filterPrio);
  tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const prioOrder = { p1: 0, p2: 1, p3: 2 };
    if (a.priority !== b.priority) return prioOrder[a.priority] - prioOrder[b.priority];
    return (a.order || 0) - (b.order || 0);
  });
  return tasks;
}

function getTop3() {
  return state.tasks
    .filter(t => t.date === today() && !t.done && t.starred)
    .sort((a, b) => {
      const prioOrder = { p1: 0, p2: 1, p3: 2 };
      return prioOrder[a.priority] - prioOrder[b.priority];
    })
    .slice(0, 3);
}

/* ===== COUNTS ===== */
function getCounts() {
  const td = today(), tm = tomorrow();
  const todayActive = state.tasks.filter(t => t.date === td && !t.done).length;
  const todayDone = state.tasks.filter(t => t.date === td && t.done).length;
  const tomorrowCount = state.tasks.filter(t => t.date === tm && !t.done).length;
  const backlogCount = state.tasks.filter(t => t.date === 'backlog' && !t.done).length;
  return { todayActive, todayDone, tomorrowCount, backlogCount };
}

/* ===== RENDER ===== */
function render() {
  const app = document.getElementById('app');
  const counts = getCounts();
  const tasks = getFilteredTasks();
  const top3 = getTop3();
  const allToday = state.tasks.filter(t => t.date === today());
  const doneToday = allToday.filter(t => t.done).length;
  const progress = allToday.length ? Math.round((doneToday / allToday.length) * 100) : 0;

  const viewTitle = currentView === 'today' ? "Aujourd'hui" : currentView === 'tomorrow' ? 'Demain' : 'Backlog';
  const viewDate = currentView === 'today' ? fmtDate(new Date()) : currentView === 'tomorrow' ? fmtDate(new Date(Date.now() + 86400000)) : 'Tâches non planifiées';

  const needsNotifPermission = 'Notification' in window &&
    Notification.permission === 'default' &&
    !state.notifDismissed;

  app.innerHTML = `
    <div class="sidebar">
      <div class="sidebar-logo">
        <span>TODAY//TASKS</span>
        <small>${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</small>
      </div>
      <nav class="sidebar-nav">
        <button class="nav-item ${currentView === 'today' ? 'active' : ''}" data-view="today">
          ◈ Aujourd'hui
          <span class="nav-badge ${counts.todayActive > 0 ? 'has-items' : ''}">${counts.todayActive}</span>
        </button>
        <button class="nav-item ${currentView === 'tomorrow' ? 'active' : ''}" data-view="tomorrow">
          ◇ Demain
          <span class="nav-badge ${counts.tomorrowCount > 0 ? 'has-items' : ''}">${counts.tomorrowCount}</span>
        </button>
        <button class="nav-item ${currentView === 'backlog' ? 'active' : ''}" data-view="backlog">
          ≡ Backlog
          <span class="nav-badge">${counts.backlogCount}</span>
        </button>
      </nav>
      <div class="sidebar-footer">
        <button class="icon-btn" id="btn-theme" title="Thème">☽</button>
        <button class="icon-btn" id="btn-notif-perm" title="Notifications">🔔</button>
        <button class="icon-btn" id="btn-clear-done" title="Effacer tâches finies">✗</button>
      </div>
    </div>

    <div class="main">
      ${needsNotifPermission ? `
      <div class="notif-banner" id="notif-banner">
        <span>Activer les notifications pour les rappels horaires</span>
        <button class="dismiss" id="btn-dismiss-notif">Plus tard</button>
        <button id="btn-allow-notif">Activer</button>
      </div>` : ''}

      <div class="topbar">
        <div>
          <div class="topbar-title">${viewTitle}</div>
          <div class="topbar-date">${viewDate}</div>
        </div>
        <div class="topbar-spacer"></div>
        <div class="filter-bar">
          <button class="filter-btn ${filterPrio === 'all' ? 'active' : ''}" data-filter="all">Tout</button>
          <button class="filter-btn ${filterPrio === 'p1' ? 'active' : ''}" data-filter="p1">P1</button>
          <button class="filter-btn ${filterPrio === 'p2' ? 'active' : ''}" data-filter="p2">P2</button>
          <button class="filter-btn ${filterPrio === 'p3' ? 'active' : ''}" data-filter="p3">P3</button>
        </div>
      </div>

      <div class="quick-add-bar">
        <div class="quick-add-form">
          <input class="quick-add-input" id="new-task-input" type="text"
            placeholder="Ajouter une tâche… (Entrée pour valider)"
            autocomplete="off" maxlength="200" />
          <select class="prio-select" id="new-task-prio">
            <option value="p1">P1</option>
            <option value="p2" selected>P2</option>
            <option value="p3">P3</option>
          </select>
          <button class="btn-add" id="btn-quick-add">+ Ajouter</button>
        </div>
      </div>

      ${currentView === 'today' ? `
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
      <div class="stats-bar">
        <div class="stat"><span>${doneToday}</span>/${allToday.length} terminées</div>
        <div class="stat"><span>${progress}%</span> complet</div>
      </div>` : ''}

      <div class="content">
        ${currentView === 'today' ? `
        <div class="top3-section">
          <div class="section-header">
            <span class="section-label">★ Top priorités</span>
            <span class="section-count">${top3.length}/3</span>
          </div>
          ${top3.length === 0
            ? `<div class="top3-empty">Épinglez des tâches avec ★ pour les mettre en avant</div>`
            : top3.map((t, i) => `
              <div class="top3-item">
                <span class="top3-rank">#${i + 1}</span>
                <span class="prio-dot ${t.priority}"></span>
                <span class="top3-text">${esc(t.text)}</span>
                <span class="prio-badge ${t.priority}">${t.priority.toUpperCase()}</span>
              </div>`).join('')
          }
        </div>` : ''}

        <div class="tasks-section">
          <div class="section-header">
            <span class="section-label">Tâches</span>
            <span class="section-count">${tasks.length}</span>
          </div>
          <ul class="task-list" id="task-list">
            ${tasks.length === 0
              ? `<li class="empty-state">Aucune tâche · Appuyez sur "+ Ajouter" pour commencer</li>`
              : tasks.map(t => renderTask(t)).join('')
            }
          </ul>
        </div>

        <div class="scratchpad-section">
          <div class="section-header">
            <span class="section-label">Pense-bête</span>
          </div>
          <textarea class="scratchpad-area" id="scratchpad"
            placeholder="Notes libres, idées, brouillons…"
            rows="4">${esc(state.scratchpad)}</textarea>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  scheduleReminders();
}

function renderTask(t) {
  const isEditing = editingId === t.id;

  if (isEditing) {
    return `
    <li class="task-item" data-id="${t.id}">
      <div class="prio-dot ${t.priority}" style="margin-top:8px"></div>
      <div class="task-body">
        <input class="task-edit-input" id="edit-text-${t.id}" value="${esc(t.text)}" maxlength="200" />
        <textarea class="task-edit-note" id="edit-note-${t.id}" rows="2"
          placeholder="Note optionnelle…">${esc(t.note)}</textarea>
        <div class="task-edit-row">
          <select class="task-edit-prio" id="edit-prio-${t.id}">
            <option value="p1" ${t.priority === 'p1' ? 'selected' : ''}>P1 — Haute</option>
            <option value="p2" ${t.priority === 'p2' ? 'selected' : ''}>P2 — Moyenne</option>
            <option value="p3" ${t.priority === 'p3' ? 'selected' : ''}>P3 — Basse</option>
          </select>
          <input class="task-edit-time" id="edit-time-${t.id}" type="time"
            value="${t.reminderTime || ''}" title="Rappel horaire" />
          <select class="task-edit-recur" id="edit-recur-${t.id}">
            <option value="none" ${(!t.recur || t.recur === 'none') ? 'selected' : ''}>Une fois</option>
            <option value="daily" ${t.recur === 'daily' ? 'selected' : ''}>Quotidienne</option>
            <option value="weekly" ${t.recur === 'weekly' ? 'selected' : ''}>Hebdo</option>
            <option value="monthly" ${t.recur === 'monthly' ? 'selected' : ''}>Mensuelle</option>
          </select>
          <button class="btn-save" data-save="${t.id}">✓ OK</button>
          <button class="btn-cancel" data-cancel="${t.id}">Annuler</button>
        </div>
      </div>
    </li>`;
  }

  const reminderHtml = t.reminderTime
    ? `<span class="task-reminder">⏰ ${t.reminderTime}</span>` : '';
  const recurHtml = t.recur && t.recur !== 'none'
    ? `<span class="recur-badge">↻ ${t.recur === 'daily' ? 'quotidien' : t.recur === 'weekly' ? 'hebdo' : 'mensuel'}</span>` : '';

  return `
  <li class="task-item ${t.done ? 'done' : ''}"
      data-id="${t.id}"
      draggable="true">
    <span class="drag-handle" title="Déplacer">⠿</span>
    <button class="task-check" data-check="${t.id}" title="${t.done ? 'Marquer non-fait' : 'Marquer fait'}">
      ${t.done ? '✓' : ''}
    </button>
    <div class="task-body">
      <div class="task-text">${esc(t.text)}</div>
      ${t.note ? `<div class="task-note">${esc(t.note)}</div>` : ''}
      ${(reminderHtml || recurHtml) ? `<div class="task-meta">${reminderHtml}${recurHtml}</div>` : ''}
    </div>
    <span class="prio-badge ${t.priority}">${t.priority.toUpperCase()}</span>
    <div class="task-actions">
      <button class="task-star ${t.starred ? 'starred' : ''}" data-star="${t.id}" title="Épingler en top 3">★</button>
      <button class="task-action-btn" data-up="${t.id}" title="Monter">↑</button>
      <button class="task-action-btn" data-down="${t.id}" title="Descendre">↓</button>
      <button class="task-action-btn" data-edit="${t.id}" title="Modifier">✎</button>
      <button class="task-action-btn danger" data-delete="${t.id}" title="Supprimer">✕</button>
    </div>
  </li>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== EVENTS ===== */
function bindEvents() {
  // Nav
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentView = btn.dataset.view;
      editingId = null;
      render();
    });
  });

  // Filter
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterPrio = btn.dataset.filter;
      render();
    });
  });

  // Quick add
  const input = document.getElementById('new-task-input');
  const prioSel = document.getElementById('new-task-prio');
  const btnAdd = document.getElementById('btn-quick-add');

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        addTask(input.value, prioSel.value, currentView);
        input.value = '';
        input.focus();
      }
    });
    input.focus();
  }
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      addTask(input.value, prioSel.value, currentView);
      input.value = '';
      input.focus();
    });
  }

  // Task list delegation
  const list = document.getElementById('task-list');
  if (list) {
    list.addEventListener('click', e => {
      const el = e.target;
      if (el.dataset.check) { toggleDone(el.dataset.check); return; }
      if (el.dataset.delete) { deleteTask(el.dataset.delete); return; }
      if (el.dataset.star) { toggleStar(el.dataset.star); return; }
      if (el.dataset.edit) { editingId = el.dataset.edit; render(); return; }
      if (el.dataset.cancel) { editingId = null; render(); return; }
      if (el.dataset.up) { moveTask(el.dataset.up, 'up'); return; }
      if (el.dataset.down) { moveTask(el.dataset.down, 'down'); return; }
      if (el.dataset.save) {
        const id = el.dataset.save;
        const text = document.getElementById(`edit-text-${id}`).value;
        const note = document.getElementById(`edit-note-${id}`).value;
        const time = document.getElementById(`edit-time-${id}`).value;
        const prio = document.getElementById(`edit-prio-${id}`).value;
        const recur = document.getElementById(`edit-recur-${id}`).value;
        saveEdit(id, text, note, time, prio, recur);
        return;
      }
    });

    // Keyboard submit on edit inputs
    list.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.classList.contains('task-edit-input')) {
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        const id = li.dataset.id;
        const text = document.getElementById(`edit-text-${id}`).value;
        const note = document.getElementById(`edit-note-${id}`).value;
        const time = document.getElementById(`edit-time-${id}`).value;
        const prio = document.getElementById(`edit-prio-${id}`).value;
        const recur = document.getElementById(`edit-recur-${id}`).value;
        saveEdit(id, text, note, time, prio, recur);
      }
      if (e.key === 'Escape') {
        editingId = null; render();
      }
    });

    // Drag & drop
    list.addEventListener('dragstart', e => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      dragSrc = li.dataset.id;
      li.classList.add('dragging');
    });
    list.addEventListener('dragend', e => {
      document.querySelectorAll('.task-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
      });
    });
    list.addEventListener('dragover', e => {
      e.preventDefault();
      const li = e.target.closest('li[data-id]');
      if (!li || li.dataset.id === dragSrc) return;
      document.querySelectorAll('.task-item').forEach(el => el.classList.remove('drag-over'));
      li.classList.add('drag-over');
    });
    list.addEventListener('drop', e => {
      e.preventDefault();
      const li = e.target.closest('li[data-id]');
      if (!li || !dragSrc || li.dataset.id === dragSrc) return;
      const srcTask = state.tasks.find(t => t.id === dragSrc);
      const dstTask = state.tasks.find(t => t.id === li.dataset.id);
      if (srcTask && dstTask) {
        const tmp = srcTask.order;
        srcTask.order = dstTask.order;
        dstTask.order = tmp;
        save();
        render();
      }
    });
  }

  // Scratchpad
  const scratch = document.getElementById('scratchpad');
  if (scratch) {
    scratch.addEventListener('input', () => {
      state.scratchpad = scratch.value;
      save();
    });
  }

  // Theme toggle
  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = state.theme;
      save();
    });
  }

  // Clear done
  const btnClear = document.getElementById('btn-clear-done');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      const count = state.tasks.filter(t => t.done).length;
      state.tasks = state.tasks.filter(t => !t.done);
      save();
      render();
      showNotif(`${count} tâche(s) terminée(s) supprimée(s)`);
    });
  }

  // Notifications
  const btnNotifPerm = document.getElementById('btn-notif-perm');
  if (btnNotifPerm) {
    btnNotifPerm.addEventListener('click', () => {
      if ('Notification' in window) {
        Notification.requestPermission().then(p => {
          showNotif(p === 'granted' ? '🔔 Notifications activées' : 'Notifications refusées');
          render();
        });
      }
    });
  }
  const btnAllow = document.getElementById('btn-allow-notif');
  if (btnAllow) {
    btnAllow.addEventListener('click', () => {
      Notification.requestPermission().then(() => render());
    });
  }
  const btnDismiss = document.getElementById('btn-dismiss-notif');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      state.notifDismissed = true;
      save();
      render();
    });
  }
}

/* ===== INIT ===== */
function init() {
  // Apply saved theme
  document.documentElement.dataset.theme = state.theme || 'light';

  // Process recurring tasks
  processRecurring();

  // Initial render
  render();
}

init();
