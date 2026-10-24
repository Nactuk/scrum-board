(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STATUS = {
    todo: { label: 'Yapılacak', short: 'Yapılacak' },
    in_progress: { label: 'Devam Ediyor', short: 'Devam' },
    review: { label: 'İncelemede', short: 'İnceleme' },
    done: { label: 'Tamamlandı', short: 'Tamamlandı' }
  };
  const PRIORITY = {
    urgent: 'Acil', high: 'Yüksek', medium: 'Orta', low: 'Düşük'
  };
  const COLUMNS = ['todo', 'in_progress', 'review', 'done'];
  let state = { tasks: [], sprints: [], settings: {}, view: 'board', dragTaskId: null };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const todayISO = () => new Date().toLocaleDateString('en-CA');
  const formatDate = value => {
    if (!value) return 'Tarih belirlenmedi';
    const d = new Date(`${value}T12:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(d);
  };
  const formatRange = (start, end) => {
    if (!start && !end) return 'Tarih belirlenmedi';
    return `${formatDate(start)} – ${formatDate(end)}`;
  };
  const activeSprintId = () => Number(state.settings.active_sprint_id || 0);
  const activeSprint = () => state.sprints.find(s => Number(s.id) === activeSprintId()) || state.sprints[0] || null;
  const taskSprint = task => task.sprint_id == null ? null : Number(task.sprint_id);
  const inActiveSprint = () => state.tasks.filter(t => taskSprint(t) === activeSprintId());
  const backlogTasks = () => state.tasks.filter(t => taskSprint(t) === null);
  const initials = name => {
    const pieces = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!pieces.length) return '—';
    return (pieces.length > 1 ? pieces[0][0] + pieces[pieces.length - 1][0] : pieces[0].slice(0, 2)).toLocaleUpperCase('tr-TR');
  };
  const icon = (name, extra='') => {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4m8-4v4M3.5 10h17"/>',
      points: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/>',
      edit: '<path d="m14 5 5 5M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>',
      arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>'
    };
    return `<svg class="${extra}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.plus}</svg>`;
  };
  async function api(path, options = {}) {
    const config = { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } };
    if (config.body && typeof config.body !== 'string') config.body = JSON.stringify(config.body);
    const response = await fetch(path, config);
    let data = {};
    try { data = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) throw new Error(data.error || `İstek başarısız (${response.status})`);
    return data;
  }
  async function refresh({quiet = true} = {}) {
    try {
      state = { ...state, ...(await api('/api/bootstrap')) };
      render();
    } catch (error) {
      if (!quiet) toast(error.message, true);
      console.error(error);
    }
  }
  function toast(message, isError = false) {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' error' : ''}`;
    el.textContent = message;
    $('#toastRegion').appendChild(el);
    window.setTimeout(() => el.remove(), 3300);
  }
  function setView(view) {
    state.view = view;
    renderView();
    $$('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    $$('.view-tab[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  }
  function render() {
    const boardName = state.settings.board_name || 'Takım Scrum Boardu';
    $('#sidebarBoardName').textContent = boardName;
    document.title = `${boardName} · cadence`;
    renderSprintInfo();
    renderMetrics();
    renderSprintsSelect();
    renderNavCounts();
    renderPeopleStack();
    renderView();
  }
  function renderSprintInfo() {
    const sprint = activeSprint();
    const label = sprint?.name || 'Sprint bulunamadı';
    $('#sidebarSprintName').textContent = label;
    $('#activeSprintName').textContent = label;
    $('#sidebarSprintDates').textContent = sprint ? formatRange(sprint.start_date, sprint.end_date) : 'Önce bir sprint oluştur';
    $('#activeSprintDates').textContent = sprint ? formatRange(sprint.start_date, sprint.end_date) : '—';
    $('#activeSprintGoal').textContent = sprint?.goal || 'Bu sprint için henüz bir hedef yazılmamış.';
    const tasks = inActiveSprint();
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    $('#sprintProgressText').textContent = `${pct}%`;
    $('#sprintProgressFill').style.width = `${pct}%`;
    $('#sprintProgressSub').textContent = `${done} / ${tasks.length} görev tamamlandı`;
  }
  function renderMetrics() {
    const tasks = inActiveSprint();
    $('#metricTotal').innerHTML = `${tasks.length} <small>görev</small>`;
    $('#metricProgress').textContent = tasks.filter(t => t.status === 'in_progress').length;
    const done = tasks.filter(t => t.status === 'done').length;
    $('#metricDone').textContent = done;
    $('#metricDoneFoot').textContent = tasks.length ? `%${Math.round(done / tasks.length * 100)} tamamlandı` : 'Sprint çıktıları';
    $('#metricPoints').innerHTML = `${tasks.reduce((sum, t) => sum + Number(t.points || 0), 0)} <small>SP</small>`;
  }
  function renderSprintsSelect() {
    const active = activeSprintId();
    const options = state.sprints.map(s => `<option value="${s.id}" ${Number(s.id) === active ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#sprintSelect').innerHTML = options || '<option value="">Sprint yok</option>';
    $('#taskSprint').innerHTML = `<option value="">Backlog (sprint yok)</option>${state.sprints.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}`;
  }
  function renderNavCounts() {
    $('#boardNavCount').textContent = inActiveSprint().length;
    $('#backlogNavCount').textContent = backlogTasks().length;
  }
  function renderPeopleStack() {
    const names = [...new Set(inActiveSprint().map(t => t.assignee.trim()).filter(Boolean))].slice(0, 4);
    $('#peopleStack').innerHTML = names.map(name => `<span class="person-chip" title="${esc(name)}">${esc(initials(name))}</span>`).join('');
  }
  function filteredTasks(tasks) {
    const needle = $('#searchInput').value.trim().toLocaleLowerCase('tr-TR');
    const priority = $('#priorityFilter').value;
    return tasks.filter(task => {
      const haystack = [task.title, task.description, task.assignee, ...(task.labels || [])].join(' ').toLocaleLowerCase('tr-TR');
      return (!needle || haystack.includes(needle)) && (priority === 'all' || task.priority === priority);
    });
  }
  function taskCard(task) {
    const due = task.due_date ? formatDate(task.due_date) : '';
    const late = task.due_date && task.due_date < todayISO() && task.status !== 'done';
    const labels = (task.labels || []).slice(0, 4).map(label => `<span class="task-label">${esc(label)}</span>`).join('');
    return `<article class="task-card" draggable="true" data-task-id="${task.id}" tabindex="0" role="button" aria-label="Görevi düzenle: ${esc(task.title)}">
      <div class="task-card-top"><span class="task-id">TSK-${String(task.id).padStart(3, '0')}</span><span class="priority-pill priority-${esc(task.priority)}">${PRIORITY[task.priority] || 'Orta'}</span></div>
      <h3 class="task-title">${esc(task.title)}</h3>
      ${task.description ? `<p class="task-description">${esc(task.description)}</p>` : ''}
      ${labels ? `<div class="task-labels">${labels}</div>` : ''}
      <div class="task-card-bottom"><div class="task-person"><span class="task-avatar ${task.assignee ? '' : 'empty'}">${task.assignee ? esc(initials(task.assignee)) : '＋'}</span><span class="task-assignee">${esc(task.assignee || 'Atanmadı')}</span></div><div class="task-meta">${due ? `<span class="task-due ${late ? 'late' : ''}" title="Hedef tarih">${icon('calendar')}${esc(due)}</span>` : ''}${Number(task.points) > 0 ? `<span class="task-points" title="Story point">${icon('points')}${Number(task.points)}</span>` : ''}</div></div>
    </article>`;
  }
  function renderBoard() {
    const tasks = filteredTasks(inActiveSprint());
    $('#boardColumns').innerHTML = COLUMNS.map(status => {
      const items = tasks.filter(t => t.status === status);
      return `<section class="board-column column-${status}" data-status="${status}"><div class="column-head"><div class="column-title"><span class="column-dot"></span>${STATUS[status].label}<span class="column-count">${items.length}</span></div><button class="column-add" data-add-status="${status}" title="${STATUS[status].label} sütununa görev ekle" aria-label="Görev ekle">${icon('plus')}</button></div><div class="task-list" data-drop-status="${status}">${items.map(taskCard).join('') || `<div class="empty-column"><span class="empty-symbol">＋</span>${$('#searchInput').value.trim() ? 'Aramana uygun görev yok.' : 'Burada henüz görev yok.'}</div>`}</div><div class="column-footer"><button class="add-task-inline" data-add-status="${status}">${icon('plus')} Görev ekle</button></div></section>`;
    }).join('');
    bindTaskCards();
    bindDropZones();
    $$('[data-add-status]').forEach(btn => btn.addEventListener('click', () => openTaskModal(null, {status: btn.dataset.addStatus, sprint_id: activeSprintId()})));
  }
  function renderBacklog() {
    const tasks = filteredTasks(backlogTasks());
    if (!tasks.length) {
      $('#backlogList').innerHTML = `<div class="backlog-empty"><strong>${$('#searchInput').value.trim() ? 'Eşleşen görev bulunamadı' : 'Backlog şimdilik boş'}</strong>${$('#searchInput').value.trim() ? 'Arama veya filtre ölçütlerini değiştirmeyi deneyin.' : 'Henüz sprint’e alınmamış işleri burada tutabilir, ihtiyaç oldukça sprint’e taşıyabilirsin.'}</div>`;
      return;
    }
    $('#backlogList').innerHTML = `<div class="backlog-row backlog-header-row" style="background:#f8faf6;cursor:default"><div class="backlog-row-title"><strong>Görev</strong></div><div class="backlog-priority" style="font-size:9px;color:#8b958b">Öncelik</div><div class="assignee-cell">Sorumlu</div><div class="backlog-due" style="font-size:9px;color:#8b958b">Hedef tarih</div><div style="font-size:9px;color:#8b958b">Puan</div><div></div></div>` + tasks.map(task => `<div class="backlog-row" data-task-id="${task.id}" role="button" tabindex="0"><div class="backlog-row-title"><strong>${esc(task.title)}</strong><small>TSK-${String(task.id).padStart(3, '0')} · ${STATUS[task.status]?.label || 'Yapılacak'}</small></div><div class="backlog-priority"><span class="priority-pill priority-${esc(task.priority)}">${PRIORITY[task.priority] || 'Orta'}</span></div><div class="assignee-cell">${esc(task.assignee || 'Atanmadı')}</div><div class="backlog-due assignee-cell">${task.due_date ? esc(formatDate(task.due_date)) : '—'}</div><div class="assignee-cell">${Number(task.points || 0) ? `${Number(task.points)} SP` : '—'}</div><div style="color:#a3ada0">${icon('arrow')}</div></div>`).join('');
    bindTaskCards();
  }
  function renderInsights() {
    const tasks = state.tasks;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const totalPoints = tasks.reduce((n, t) => n + Number(t.points || 0), 0);
    $('#insightGrid').innerHTML = [
      ['Toplam görev', tasks.length], ['Tamamlanan', done], ['Devam eden', inProgress], ['Tahmini puan', totalPoints]
    ].map(([label, value]) => `<article class="insight-stat"><span>${label}</span><strong>${value}</strong></article>`).join('');
    $('#sprintReportList').innerHTML = state.sprints.length ? state.sprints.map(sprint => {
      const sprintTasks = tasks.filter(t => taskSprint(t) === Number(sprint.id));
      const sprintDone = sprintTasks.filter(t => t.status === 'done').length;
      const percent = sprintTasks.length ? Math.round(sprintDone / sprintTasks.length * 100) : 0;
      return `<div class="report-sprint"><span class="sprint-dot"></span><div class="report-sprint-main"><strong>${esc(sprint.name)} ${Number(sprint.id) === activeSprintId() ? '<span class="active-tag">AKTİF</span>' : ''}</strong><small>${esc(formatRange(sprint.start_date, sprint.end_date))}${sprint.goal ? ` · ${esc(sprint.goal)}` : ''}</small></div><div class="report-sprint-stats">${sprintDone} / ${sprintTasks.length} görev<div class="report-progress"><div style="width:${percent}%"></div></div></div><strong style="font-size:11px;color:#60785a;min-width:36px;text-align:right">${percent}%</strong></div>`;
    }).join('') : '<div class="backlog-empty">Henüz sprint bulunmuyor.</div>';
  }
  function renderView() {
    const labels = {board: ['Scrum boardu', 'Sprint boardu', 'İşleri görünür kıl. Odağını koru. Birlikte ilerle.'], backlog: ["Ürün backlog'u", "Ürün backlog'u", 'Öncelikleri netleştir, işleri sıraya koy ve sprint’e hazırla.'], insights: ['Raporlar', 'Proje görünümü', 'İlerlemeyi izle, iş yükünü gör ve sprint sonuçlarını değerlendir.']};
    const [crumb, title, subtitle] = labels[state.view] || labels.board;
    $('#crumbTitle').textContent = crumb;
    $('#pageTitle').innerHTML = `${title}<span class="title-period">.</span>`;
    $('#pageSubtitle').textContent = subtitle;
    $('#boardSection').classList.toggle('hidden', state.view !== 'board');
    $('#backlogSection').classList.toggle('hidden', state.view !== 'backlog');
    $('#insightsSection').classList.toggle('hidden', state.view !== 'insights');
    $('#sprintStrip').classList.toggle('hidden', state.view === 'insights');
    $('#metricsGrid').classList.toggle('hidden', state.view !== 'board');
    if (state.view === 'board') renderBoard();
    if (state.view === 'backlog') renderBacklog();
    if (state.view === 'insights') renderInsights();
  }
  function bindTaskCards() {
    $$('[data-task-id]').forEach(card => {
      const open = () => {
        const task = state.tasks.find(t => Number(t.id) === Number(card.dataset.taskId));
        if (task) openTaskModal(task);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
    $$('.task-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', event => {
        state.dragTaskId = Number(card.dataset.taskId);
        card.classList.add('dragging');
        if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(state.dragTaskId)); }
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); $$('.board-column').forEach(col => col.classList.remove('drag-over')); state.dragTaskId = null; });
    });
  }
  function bindDropZones() {
    $$('.board-column').forEach(column => {
      column.addEventListener('dragover', event => { event.preventDefault(); column.classList.add('drag-over'); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; });
      column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over'); });
      column.addEventListener('drop', async event => {
        event.preventDefault(); column.classList.remove('drag-over');
        const id = Number(event.dataTransfer?.getData('text/plain') || state.dragTaskId);
        const task = state.tasks.find(t => Number(t.id) === id);
        const status = column.dataset.status;
        if (!task || task.status === status) return;
        try {
          await api(`/api/tasks/${id}`, {method: 'PUT', body: {...task, status}});
          await refresh();
          toast(`Görev “${STATUS[status].label}” sütununa taşındı.`);
        } catch (error) { toast(error.message, true); }
      });
    });
  }
  function openTaskModal(task = null, defaults = {}) {
    $('#taskForm').reset();
    $('#taskError').classList.add('hidden');
    $('#taskId').value = task?.id || '';
    $('#taskModalKicker').textContent = task ? `TSK-${String(task.id).padStart(3, '0')} · GÖREVİ DÜZENLE` : 'GÖREV YÖNETİMİ';
    $('#taskModalTitle').textContent = task ? 'Görevi düzenle' : 'Yeni görev oluştur';
    $('#taskTitle').value = task?.title || '';
    $('#taskDescription').value = task?.description || '';
    $('#taskStatus').value = task?.status || defaults.status || 'todo';
    $('#taskPriority').value = task?.priority || 'medium';
    $('#taskAssignee').value = task?.assignee || '';
    $('#taskPoints').value = task?.points ?? 0;
    $('#taskDueDate').value = task?.due_date || '';
    $('#taskLabels').value = (task?.labels || []).join(', ');
    renderSprintsSelect();
    const sprintVal = task ? (task.sprint_id == null ? '' : String(task.sprint_id)) : (defaults.sprint_id == null ? (state.view === 'backlog' ? '' : String(activeSprintId())) : String(defaults.sprint_id));
    $('#taskSprint').value = sprintVal;
    $('#deleteTaskBtn').classList.toggle('hidden', !task);
    $('#taskModalBackdrop').classList.remove('hidden');
    setTimeout(() => $('#taskTitle').focus(), 50);
  }
  function closeModal(id) { $(`#${id}`).classList.add('hidden'); }
  function showFormError(id, message) { const el = $(`#${id}`); el.textContent = message; el.classList.remove('hidden'); }
  async function saveTask(event) {
    event.preventDefault();
    $('#taskError').classList.add('hidden');
    const id = $('#taskId').value;
    const points = Number.parseInt($('#taskPoints').value || '0', 10);
    if (!$('#taskTitle').value.trim()) return showFormError('taskError', 'Görev başlığı zorunludur.');
    if (!Number.isFinite(points) || points < 0 || points > 100) return showFormError('taskError', 'Story point 0 ile 100 arasında olmalı.');
    const body = {
      title: $('#taskTitle').value.trim(), description: $('#taskDescription').value.trim(), status: $('#taskStatus').value,
      priority: $('#taskPriority').value, assignee: $('#taskAssignee').value.trim(), points,
      due_date: $('#taskDueDate').value, sprint_id: $('#taskSprint').value || null,
      labels: $('#taskLabels').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
    };
    const button = $('#saveTaskBtn'); button.disabled = true; button.textContent = 'Kaydediliyor…';
    try {
      await api(id ? `/api/tasks/${id}` : '/api/tasks', {method: id ? 'PUT' : 'POST', body});
      closeModal('taskModalBackdrop');
      await refresh();
      toast(id ? 'Görev güncellendi.' : 'Yeni görev oluşturuldu.');
    } catch (error) { showFormError('taskError', error.message); }
    finally { button.disabled = false; button.innerHTML = 'Görevi kaydet <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'; }
  }
  async function deleteTask() {
    const id = $('#taskId').value;
    if (!id || !window.confirm('Bu görevi kalıcı olarak silmek istiyor musun?')) return;
    try {
      await api(`/api/tasks/${id}`, {method: 'DELETE'});
      closeModal('taskModalBackdrop');
      await refresh();
      toast('Görev silindi.');
    } catch (error) { showFormError('taskError', error.message); }
  }
  function openSprintModal() {
    $('#sprintForm').reset();
    $('#sprintError').classList.add('hidden');
    const today = new Date();
    const after = new Date(today); after.setDate(today.getDate() + 13);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    $('#sprintStart').value = iso(today);
    $('#sprintEnd').value = iso(after);
    $('#sprintName').value = `Sprint ${state.sprints.length + 1}`;
    $('#sprintGoal').value = '';
    $('#sprintModalBackdrop').classList.remove('hidden');
    setTimeout(() => $('#sprintName').focus(), 50);
  }
  async function saveSprint(event) {
    event.preventDefault();
    $('#sprintError').classList.add('hidden');
    if ($('#sprintEnd').value < $('#sprintStart').value) return showFormError('sprintError', 'Bitiş tarihi başlangıç tarihinden önce olamaz.');
    try {
      await api('/api/sprints', {method: 'POST', body: {name: $('#sprintName').value.trim(), goal: $('#sprintGoal').value.trim(), start_date: $('#sprintStart').value, end_date: $('#sprintEnd').value}});
      closeModal('sprintModalBackdrop');
      await refresh();
      setView('board');
      toast('Sprint oluşturuldu ve aktif sprint olarak seçildi.');
    } catch (error) { showFormError('sprintError', error.message); }
  }
  async function selectSprint() {
    const id = $('#sprintSelect').value;
    if (!id) return;
    try {
      await api('/api/settings', {method:'POST', body:{active_sprint_id:Number(id)}});
      await refresh();
      toast('Aktif sprint değiştirildi.');
    } catch (error) { toast(error.message, true); }
  }
  async function exportData() {
    try {
      const data = await api('/api/bootstrap');
      data.exported_at = new Date().toISOString();
      data.application = 'Takım Scrum Boardu';
      const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `scrum-board-yedek-${todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('JSON yedeği indirildi.');
    } catch (error) { toast(error.message, true); }
  }

  // Navigation and controls
  $$('.nav-item[data-view], .view-tab[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $('#newTaskBtn').addEventListener('click', () => openTaskModal());
  $('#boardAddBtn').addEventListener('click', () => openTaskModal(null, {sprint_id: activeSprintId()}));
  $('#backlogAddBtn').addEventListener('click', () => openTaskModal(null, {sprint_id: null}));
  $('#newSprintBtn').addEventListener('click', openSprintModal);
  $('#sidebarNewSprint').addEventListener('click', openSprintModal);
  $('#taskForm').addEventListener('submit', saveTask);
  $('#sprintForm').addEventListener('submit', saveSprint);
  $('#deleteTaskBtn').addEventListener('click', deleteTask);
  $('#sprintSelect').addEventListener('change', selectSprint);
  $('#searchInput').addEventListener('input', () => renderView());
  $('#priorityFilter').addEventListener('change', () => renderView());
  $('#exportBtn').addEventListener('click', exportData);
  $('#exportTopBtn').addEventListener('click', exportData);
  $('#insightsExportBtn').addEventListener('click', exportData);
  $$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
    if (event.key === 'Escape') $$('.modal-backdrop:not(.hidden)').forEach(el => closeModal(el.id));
  });

  refresh({quiet: false});
})();
