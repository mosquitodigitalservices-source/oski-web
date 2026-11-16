'use strict';

// The publishable key is meant to be public; what each person can read or change is
// enforced by the row-level security policies in supabase/schema*.sql.
const SUPABASE_URL = 'https://yycmgicikxvdwvthswiv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_geSIYOPYXbVW98u5DdPTvA_pw_Uf1yt';
// The link in a password-recovery email lands here with "type=recovery" in the address.
// It has to be read before the Supabase client consumes and clears it.
const openedFromRecoveryLink = window.location.hash.includes('type=recovery');
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Records are stored exactly as the Mac app encodes them, so both read the same rows:
// dates are seconds since 2001-01-01 and ids are uppercase UUIDs.
const SWIFT_EPOCH = 978307200;
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_CATEGORIES = ['Streaming', 'Monitor', 'Color Panel', 'RAIDs', 'Carts', 'Cables', 'Accesories'];
const TECH_CATEGORIES = ['DIT', 'Data Wrangler', 'Streaming Tech', 'Colorist'];
const TECH_COLORS = [
  { red: 1, green: 0.58, blue: 0 }, { red: 1, green: 0.18, blue: 0.58 },
  { red: 1, green: 0.82, blue: 0 }, { red: 0.57, green: 0.32, blue: 0.93 },
  { red: 0.2, green: 0.78, blue: 0.65 }, { red: 0.35, green: 0.62, blue: 0.95 },
];
const LEVELS = {
  basic: ['Básico', 'Ve solo su calendario y consulta el inventario.'],
  collaborator: ['Colaborador', 'Ve el calendario del equipo y reserva material.'],
  manager: ['Encargado', 'Edita proyectos, inventario y técnicos.'],
};
const PAGES = [['calendar', 'Calendario'], ['projects', 'Proyectos'], ['items', 'Ítems'], ['team', 'Técnicos']];

const state = {
  session: null, memberships: [], membership: null,
  authMode: 'signIn', awaitingCode: false, recovering: false, authEmail: '', authError: '', authInfo: '', busy: false,
  page: 'calendar', calendarMode: 'projects', anchor: startOfDay(new Date()), selectedDay: null,
  items: [], technicians: [], projects: [], settings: null,
  search: '', categoryFilter: '', statusFilter: '', notice: '',
};

const app = document.getElementById('app');
const modal = document.getElementById('modal');

// ---------- helpers

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function newID() { return crypto.randomUUID().toUpperCase(); }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function fromSwift(seconds) { return new Date((seconds + SWIFT_EPOCH) * 1000); }
function toSwift(date) { return date.getTime() / 1000 - SWIFT_EPOCH; }
function toInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function fromInput(value) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
function shortDate(date) { return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
function rangeText(start, end) {
  const a = shortDate(start); const b = shortDate(end);
  return a === b ? a : `${a} - ${b}`;
}
function sameText(a, b) { return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(); }
function cssColor(color) {
  return color ? `rgb(${Math.round(color.red * 255)},${Math.round(color.green * 255)},${Math.round(color.blue * 255)})` : '';
}
function access() {
  const m = state.membership;
  return m ? (m.role === 'company' ? 'company' : m.access_level) : null;
}
function canManage() { return ['company', 'manager'].includes(access()); }
function canViewTeam() { return canManage() || access() === 'collaborator'; }
function isMine(project) { return sameText(project.employeeName, state.membership.display_name); }
function techColor(name) {
  const tech = state.technicians.find((t) => sameText(t.name, name));
  return cssColor(tech && tech.color);
}
function message(error) {
  const text = String((error && error.message) || error || '').toLowerCase();
  if (text.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (text.includes('email not confirmed')) return 'Falta confirmar el correo con el código que te enviamos.';
  if (text.includes('expired') || (text.includes('invalid') && text.includes('token'))) return 'El código no es válido o ha caducado. Pide uno nuevo.';
  if (text.includes('different from the old')) return 'La contraseña nueva tiene que ser distinta de la anterior.';
  if (text.includes('error sending')) return 'El servidor no pudo enviar el correo. Hay que revisar la configuración de correo (SMTP) en Supabase.';
  if (text.includes('rate limit') || text.includes('security purposes')) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
  if (text.includes('row-level security') || text.includes('permission denied')) return 'Tu nivel de permisos no permite este cambio.';
  if (text.includes('duplicate key')) return 'Ese correo ya estaba invitado.';
  if (text.includes('failed to fetch') || text.includes('network')) return 'No hay conexión con el servidor. Comprueba internet y vuelve a probar.';
  return `No se pudo completar: ${(error && error.message) || error}`;
}

// ---------- session

async function loadMemberships() {
  const user = state.session.user;
  await db.rpc('accept_invitations');
  const query = () => db.from('memberships')
    .select('company_id, role, access_level, display_name, company:companies(name)')
    .eq('user_id', user.id).order('created_at');
  let { data, error } = await query();
  if (error) throw error;

  const meta = user.user_metadata || {};
  if (!data.length && meta.account_type === 'company' && meta.display_name) {
    const created = await db.rpc('create_company', { company_name: meta.display_name });
    if (created.error) throw created.error;
    ({ data, error } = await query());
    if (error) throw error;
  }
  if (!data.length) {
    await db.auth.signOut({ scope: 'local' });
    state.session = null;
    throw new Error('Ninguna empresa te ha invitado todavía con este correo. Pide a tu empresa que te añada y vuelve a entrar.');
  }

  state.memberships = data;
  const saved = localStorage.getItem('oski.company');
  state.membership = data.find((m) => m.company_id === saved) || data[0];
}

async function loadData() {
  const { data, error } = await db.from('company_records')
    .select('collection, data').eq('company_id', state.membership.company_id);
  if (error) throw error;
  const of = (collection) => data.filter((row) => row.collection === collection).map((row) => row.data);
  state.items = of('items');
  state.technicians = of('technicians');
  state.projects = of('projects');
  state.settings = of('settings')[0] || null;
}

async function saveRecord(collection, record) {
  const { error } = await db.from('company_records').upsert(
    { company_id: state.membership.company_id, collection, id: record.id, data: record },
    { onConflict: 'company_id,collection,id' },
  );
  if (error) throw error;
}

async function saveRecords(collection, records) {
  if (!records.length) return;
  const { error } = await db.from('company_records').upsert(
    records.map((record) => ({ company_id: state.membership.company_id, collection, id: record.id, data: record })),
    { onConflict: 'company_id,collection,id' },
  );
  if (error) throw error;
}

async function deleteRecords(collection, ids) {
  if (!ids.length) return;
  const { error } = await db.from('company_records').delete()
    .eq('company_id', state.membership.company_id).eq('collection', collection).in('id', ids);
  if (error) throw error;
}

/** Runs a change, reloads the company's data and shows what went wrong, if anything. */
async function change(action) {
  state.notice = '';
  try {
    await action();
  } catch (error) {
    state.notice = message(error);
  }
  try {
    await loadData();
  } catch (error) {
    state.notice = message(error);
  }
  closeModal();
  render();
}

async function enter() {
  try {
    await loadMemberships();
    await loadData();
    state.authError = '';
  } catch (error) {
    if (String(error && error.message).includes('foreign key')) {
      // The browser still holds a session for an account that was deleted on the server.
      await db.auth.signOut({ scope: 'local' });
      state.session = null;
      state.authError = 'Esa cuenta ya no existe en el servidor. Regístrate de nuevo.';
    } else {
      state.authError = message(error);
      state.notice = state.authError;
    }
  }
  render();
}

// ---------- calendar files

function icsText(value) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

function icsDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((part) => Number(part || 0));
  return m[7] ? new Date(Date.UTC(year, month - 1, day, hour, minute, second)) : new Date(year, month - 1, day, hour, minute, second);
}

/** Reads the events of an iCalendar (.ics) file. Repeating events count once, on their first date. */
function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let event = null;
  let nested = 0;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { event = {}; nested = 0; continue; }
    if (!event) continue;
    if (line === 'END:VEVENT') {
      if (event.start) events.push(event);
      event = null;
    } else if (line.startsWith('BEGIN:')) {
      nested += 1;
    } else if (line.startsWith('END:')) {
      nested -= 1;
    } else if (!nested) {
      const colon = line.indexOf(':');
      const name = line.slice(0, colon).split(';')[0];
      const value = line.slice(colon + 1);
      if (name === 'SUMMARY') event.title = icsText(value);
      else if (name === 'DESCRIPTION') event.description = icsText(value);
      else if (name === 'DTSTART') { event.start = icsDate(value); event.allDay = /^\d{8}$/.test(value); }
      else if (name === 'DTEND') event.end = icsDate(value);
    }
  }

  return events.map((e) => {
    const start = startOfDay(e.start);
    let end = e.end ? startOfDay(e.end) : start;
    // An all-day event ends on the morning after its last day.
    if (e.allDay && e.end) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    return { title: e.title || 'Sin título', description: (e.description || '').split('\n')[0].slice(0, 60), start, end: end < start ? start : end };
  });
}

// ---------- categories

function technicianCategories() {
  const all = [...TECH_CATEGORIES, ...state.technicians.map((t) => t.category)];
  return all.filter((name, index) => name && all.findIndex((other) => sameText(other, name)) === index);
}

function categories() {
  const settings = state.settings || {};
  const all = [...(settings.categoryOrder || []), ...DEFAULT_CATEGORIES, ...(settings.customCategories || []), ...state.items.map((i) => i.category)];
  return all.filter((name, index) => name && all.findIndex((other) => sameText(other, name)) === index);
}

// ---------- rendering

function render() {
  app.innerHTML = state.session && state.membership && !state.recovering ? dashboardHTML() : authHTML();
  app.querySelectorAll('[data-color]').forEach((el) => { el.style.background = el.dataset.color; });
}

function authHTML() {
  const register = state.authMode !== 'signIn';
  const body = state.recovering ? `
    <p class="muted">Elige una contraseña nueva para tu cuenta.</p>
    <label class="field">Contraseña nueva (mínimo 8 caracteres)<input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <button class="btn primary" ${state.busy ? 'disabled' : ''}>Guardar contraseña</button>` : state.awaitingCode ? `
    <p class="muted">Te hemos enviado un código de 6 cifras a ${esc(state.authEmail)}. Escríbelo para confirmar tu cuenta.</p>
    <label class="field">Código<input class="input mono" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
    <div class="dlg-foot">
      <button type="button" class="link" data-action="auth-back">Volver</button>
      <button type="button" class="link" data-action="auth-resend">Reenviar</button>
      <button class="btn primary" ${state.busy ? 'disabled' : ''}>Confirmar</button>
    </div>` : `
    <div class="seg" role="group">
      ${[['signIn', 'Entrar'], ['company', 'Empresa'], ['technician', 'Técnico']].map(([mode, label]) =>
        `<button type="button" data-action="auth-mode" data-mode="${mode}" aria-pressed="${state.authMode === mode}">${label}</button>`).join('')}
    </div>
    ${register ? `<label class="field">${state.authMode === 'company' ? 'Nombre de la empresa' : 'Tu nombre'}<input class="input" name="name" required></label>` : ''}
    <label class="field">Correo<input class="input" name="email" type="email" autocomplete="username" required value="${esc(state.authEmail)}"></label>
    <label class="field">Contraseña${register ? ' (mínimo 8 caracteres)' : ''}<input class="input" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="${register ? 8 : 1}" required></label>
    ${state.authMode === 'technician' ? '<p class="muted">Tu empresa tiene que haberte invitado antes con este mismo correo.</p>' : ''}
    <button class="btn primary" ${state.busy ? 'disabled' : ''}>${register ? 'Crear cuenta' : 'Entrar'}</button>
    ${register ? '' : '<button type="button" class="link" data-action="auth-recover">Recuperar contraseña</button>'}`;

  return `<div class="auth"><form class="box form" data-form="auth">
    <div><h1>OSKI</h1><p class="lead">Acceso de empresas y técnicos</p></div>
    ${body}
    ${state.authError ? `<p class="error" role="alert">${esc(state.authError)}</p>` : ''}
    ${state.authInfo ? `<p class="muted" role="status">${esc(state.authInfo)}</p>` : ''}
  </form></div>`;
}

function dashboardHTML() {
  const pages = PAGES.filter(([id]) => id !== 'team' || canViewTeam());
  const nav = pages.map(([id, label]) =>
    `<button type="button" data-action="page" data-page="${id}" ${state.page === id ? 'aria-current="page"' : ''}>${label}</button>`).join('');
  const m = state.membership;
  const company = state.memberships.length > 1
    ? `<select data-action="company" aria-label="Empresa">${state.memberships.map((x) =>
        `<option value="${x.company_id}" ${x === m ? 'selected' : ''}>${esc(x.company.name)}</option>`).join('')}</select>`
    : `<span>${esc(m.company.name)}</span>`;
  const page = { calendar: calendarHTML, projects: projectsHTML, items: itemsHTML, team: teamHTML }[state.page]();

  return `<header class="top">
    <div class="brand">OSKI</div>
    <nav class="tools" aria-label="Secciones">${nav}</nav>
    <div class="who">${company}<button type="button" class="link" data-action="sign-out">Salir</button></div>
  </header>
  <main>
    ${state.notice ? `<div class="notice" role="status">${esc(state.notice)}</div>` : ''}
    ${page}
  </main>
  <nav class="nav-bottom" aria-label="Secciones">${nav}</nav>`;
}

function visibleProjects() {
  return [...state.projects].sort((a, b) => b.date - a.date);
}

function projectRow(project) {
  const editable = canManage() || isMine(project);
  return `<div class="row">
    <i class="dot" data-color="${techColor(project.employeeName)}"></i>
    <div class="main"><b>${esc(project.projectName)}${project.productionCompany ? ` · ${esc(project.productionCompany)}` : ''}</b><span>${esc(project.employeeName)}</span></div>
    <span class="when">${rangeText(fromSwift(project.date), fromSwift(project.endDate))}</span>
    ${editable ? `<button type="button" class="icon-btn" data-action="project-edit" data-id="${project.id}" aria-label="Editar proyecto">✎</button>` : ''}
  </div>`;
}

function itemReservationRow(item) {
  return `<div class="row">
    <div class="main"><b>${esc(item.name)}</b><span>${esc(item.notes || '-')}</span></div>
    <span class="when">${rangeText(fromSwift(item.day), fromSwift(item.endDay ?? item.day))}</span>
    ${canViewTeam() ? `<button type="button" class="icon-btn" data-action="item-release" data-id="${item.id}" aria-label="Liberar ítem">×</button>` : ''}
  </div>`;
}

function calendarHTML() {
  const inventory = state.calendarMode === 'inventory';
  const month = state.anchor;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + last.getDate()) / 7);
  const today = startOfDay(new Date()).getTime();
  const entries = inventory
    ? state.items.filter((i) => i.status === 'Ocupado').map((i) => ({ start: i.day, end: i.endDay ?? i.day, color: techColor(i.notes) }))
    : state.projects.map((p) => ({ start: p.date, end: p.endDate, color: techColor(p.employeeName) }));

  let cells = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => `<div class="wd ${i > 4 ? 'we' : ''}">${d}</div>`).join('');
  for (let i = 0; i < weeks * 7; i += 1) {
    const day = new Date(gridStart); day.setDate(gridStart.getDate() + i);
    const time = day.getTime();
    const bars = entries.filter((e) => startOfDay(fromSwift(e.start)).getTime() <= time && time <= startOfDay(fromSwift(e.end)).getTime())
      .slice(0, 3).map((e) => `<i data-color="${e.color}"></i>`).join('');
    const classes = ['day', day.getMonth() !== month.getMonth() ? 'out' : '', time === today ? 'today' : '',
      state.selectedDay && state.selectedDay.getTime() === time ? 'sel' : ''].join(' ');
    cells += `<button type="button" class="${classes}" data-action="day" data-day="${toInput(day)}" aria-label="${day.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}">
      <span class="n">${day.getDate()}</span><span class="bars">${bars}</span></button>`;
  }

  const title = month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const inDay = (start, end) => !state.selectedDay
    || (startOfDay(fromSwift(start)).getTime() <= state.selectedDay.getTime() && state.selectedDay.getTime() <= startOfDay(fromSwift(end)).getTime());
  const rows = inventory
    ? state.items.filter((i) => i.status === 'Ocupado' && inDay(i.day, i.endDay ?? i.day)).map(itemReservationRow)
    : visibleProjects().filter((p) => inDay(p.date, p.endDate)).map(projectRow);
  const listTitle = (inventory ? 'Reservas' : 'Proyectos') + (state.selectedDay ? ` · ${shortDate(state.selectedDay)}` : '');
  const canAdd = inventory ? canViewTeam() : true;

  return `<div class="page-title">
    <h1 class="eyebrow">Calendario</h1>
    <div class="seg" role="group">
      <button type="button" data-action="calendar-mode" data-mode="projects" aria-pressed="${!inventory}">Equipo</button>
      <button type="button" data-action="calendar-mode" data-mode="inventory" aria-pressed="${inventory}">Inventario</button>
    </div>
    ${inventory ? '' : '<button type="button" class="btn" data-action="calendar-import">Importar</button>'}
  </div>
  <div class="cols">
    <section class="box">
      <div class="cal-head">
        <h2>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h2>
        <button type="button" class="btn small" data-action="month" data-step="-1" aria-label="Mes anterior">‹</button>
        <button type="button" class="btn small" data-action="month" data-step="0">Hoy</button>
        <button type="button" class="btn small" data-action="month" data-step="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal">${cells}</div>
    </section>
    <section class="box">
      <h2 class="sec"><span class="grow">${esc(listTitle)}</span>
        ${state.selectedDay ? '<button type="button" class="link" data-action="day-clear">Ver todo</button>' : ''}
        ${canAdd ? `<button type="button" class="btn small" data-action="${inventory ? 'item-reserve' : 'project-new'}">+ ${inventory ? 'Nueva' : 'Nuevo'}</button>` : ''}
      </h2>
      ${rows.length ? `<div class="rows">${rows.join('')}</div>` : `<p class="empty">${inventory ? 'No hay material reservado.' : 'No hay proyectos.'}</p>`}
    </section>
  </div>`;
}

function projectsHTML() {
  const groups = new Map();
  for (const project of visibleProjects()) {
    const key = fromSwift(project.date).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    groups.set(key, [...(groups.get(key) || []), project]);
  }
  const body = [...groups].map(([month, projects]) =>
    `<h3 class="group">${esc(month)}</h3><div class="rows">${projects.map(projectRow).join('')}</div>`).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Proyectos</h1>
    <button type="button" class="btn primary" data-action="project-new">+ Nuevo proyecto</button>
  </div>
  <section class="box">${body || '<p class="empty">Todavía no hay proyectos.</p>'}</section>`;
}

function itemsHTML() {
  const search = state.search.trim().toLowerCase();
  const items = state.items
    .filter((i) => !search || i.name.toLowerCase().includes(search))
    .filter((i) => !state.categoryFilter || sameText(i.category, state.categoryFilter))
    .filter((i) => !state.statusFilter || i.status === state.statusFilter)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const body = categories().map((category) => {
    const rows = items.filter((i) => sameText(i.category, category));
    if (!rows.length) return '';
    return `<h3 class="group">${esc(category)}</h3><div class="rows">${rows.map((item) => {
      const busy = item.status === 'Ocupado';
      const detail = busy ? `${item.notes || 'Reservado'} · ${rangeText(fromSwift(item.day), fromSwift(item.endDay ?? item.day))}` : '';
      return `<div class="row">
        <div class="main"><b>${esc(item.name)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</div>
        <span class="badge ${busy ? 'on' : ''}">${esc(item.status)}</span>
        ${canViewTeam() ? `<button type="button" class="btn small" data-action="${busy ? 'item-release' : 'item-reserve'}" data-id="${item.id}">${busy ? 'Liberar' : 'Reservar'}</button>` : ''}
        ${canManage() ? `<button type="button" class="icon-btn" data-action="item-delete" data-id="${item.id}" aria-label="Eliminar ${esc(item.name)}">×</button>` : ''}
      </div>`;
    }).join('')}</div>`;
  }).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Ítems</h1>
    ${canManage() ? '<button type="button" class="btn primary" data-action="item-new">+ Nuevo ítem</button>' : ''}
  </div>
  <div class="filters">
    <input class="input" type="search" placeholder="Buscar ítem" value="${esc(state.search)}" data-input="search" aria-label="Buscar ítem">
    <select class="input" data-input="categoryFilter" aria-label="Categoría">
      <option value="">Todas las categorías</option>
      ${categories().map((c) => `<option ${sameText(c, state.categoryFilter) ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <select class="input" data-input="statusFilter" aria-label="Estado">
      ${[['', 'Todos'], ['Disponible', 'Disponible'], ['Ocupado', 'Ocupado']].map(([v, l]) => `<option value="${v}" ${state.statusFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
  </div>
  <section class="box">${body || '<p class="empty">No hay ítems que mostrar.</p>'}</section>`;
}

function teamHTML() {
  const rows = state.technicians.map((tech) => `<div class="row">
    <i class="dot" data-color="${cssColor(tech.color)}"></i>
    <div class="main"><b>${esc(tech.name)}</b><span>${esc([tech.category, tech.phone, tech.email].filter(Boolean).join(' · '))}</span></div>
    <span class="badge ${tech.availability === 'Ocupado' ? 'on' : ''}">${esc(tech.availability)}</span>
    ${canManage() ? `<button type="button" class="icon-btn" data-action="tech-edit" data-id="${tech.id}" aria-label="Editar ${esc(tech.name)}">✎</button>` : ''}
  </div>`).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Técnicos</h1>
    ${access() === 'company' ? '<button type="button" class="btn" data-action="invite">Invitar técnico</button>' : ''}
    ${canManage() ? '<button type="button" class="btn primary" data-action="tech-new">+ Nuevo técnico</button>' : ''}
  </div>
  <section class="box">${rows ? `<div class="rows">${rows}</div>` : '<p class="empty">Todavía no hay técnicos.</p>'}</section>`;
}

// ---------- dialogs

function openModal(title, formName, fields, { submit = 'Guardar', remove = null, id = '' } = {}) {
  modal.innerHTML = `<form class="dialog form" data-form="${formName}" data-id="${id}">
    <h2>${esc(title)}</h2>
    ${fields}
    <p class="error" role="alert" hidden></p>
    <div class="dlg-foot">
      ${remove ? `<button type="button" class="link danger" data-action="${remove}" data-id="${id}">Eliminar</button>` : ''}
      <button type="button" class="btn" data-action="close">Cancelar</button>
      <button class="btn primary">${esc(submit)}</button>
    </div>
  </form>`;
  modal.hidden = false;
  const first = modal.querySelector('input,select');
  if (first) first.focus();
}

function closeModal() { modal.hidden = true; modal.innerHTML = ''; }

function field(label, name, value = '', attributes = '') {
  return `<label class="field">${label}<input class="input" name="${name}" value="${esc(value)}" ${attributes}></label>`;
}
function select(label, name, options, selected) {
  return `<label class="field">${label}<select class="input" name="${name}">${options.map((o) => {
    const [value, text] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(value)}" ${sameText(value, selected) ? 'selected' : ''}>${esc(text)}</option>`;
  }).join('')}</select></label>`;
}
const NEW_OPTION = '__new__';

/** A select whose last line lets the person type a value that is not in the list. */
function selectWithNew(label, name, options, selected) {
  return `${select(label, name, [...options, [NEW_OPTION, '+ Nueva categoría…']], selected).replace('<select ', '<select data-new ')}
    <label class="field" hidden>Nombre de la categoría nueva<input class="input" name="${name}New"></label>`;
}

/** The value of a selectWithNew field: the chosen option or the typed name ('' when left empty). */
function chosenOrNew(values, name) {
  return values[name] === NEW_OPTION ? values[`${name}New`].trim() : values[name];
}

function assignableNames(current) {
  const names = canManage() ? state.technicians.map((t) => t.name) : [state.membership.display_name];
  return !current || names.some((n) => sameText(n, current)) ? names : [current, ...names];
}

function dates(start, end) {
  return `<div class="pair">${field('Inicio', 'start', toInput(start), 'type="date" required')}${field('Fin', 'end', toInput(end), 'type="date" required')}</div>`;
}

function projectDialog(project) {
  const day = state.selectedDay || startOfDay(new Date());
  const options = assignableNames(project && project.employeeName);
  const current = project ? project.employeeName : options[0];
  openModal(project ? 'Editar proyecto' : 'Nuevo proyecto', 'project',
    select('Técnico', 'employee', options, current)
    + field('Proyecto', 'name', project ? project.projectName : '', 'required')
    + field('Productora', 'company', project ? project.productionCompany : '')
    + dates(project ? fromSwift(project.date) : day, project ? fromSwift(project.endDate) : day),
    { id: project ? project.id : '', remove: project ? 'project-delete' : null, submit: project ? 'Guardar' : 'Añadir' });
}

function reserveDialog(item) {
  const day = state.selectedDay || startOfDay(new Date());
  const free = state.items.filter((i) => i.status !== 'Ocupado').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!item && !free.length) { state.notice = 'No queda material disponible para reservar.'; render(); return; }
  openModal('Reservar material', 'reserve',
    (item ? `<p class="muted">${esc(item.name)}</p>` : select('Ítem', 'item', free.map((i) => [i.id, i.name]), ''))
    + field('Proyecto', 'project') + field('Productora o técnico', 'company') + dates(day, day),
    { id: item ? item.id : '', submit: 'Reservar' });
}

function itemDialog() {
  openModal('Nuevo ítem', 'item',
    field('Nombre', 'name', '', 'required')
    + selectWithNew('Categoría', 'category', categories(), 'Accesories'),
    { submit: 'Añadir' });
}

function techDialog(tech) {
  openModal(tech ? 'Editar técnico' : 'Nuevo técnico', 'tech',
    field('Nombre', 'name', tech ? tech.name : '', 'required')
    + selectWithNew('Categoría', 'category', technicianCategories(), tech ? tech.category : 'DIT')
    + select('Estado', 'availability', ['Libre', 'Ocupado'], tech ? tech.availability : 'Libre')
    + field('Teléfono', 'phone', tech ? tech.phone : '', 'type="tel"')
    + field('Email', 'email', tech ? tech.email : '', 'type="email"'),
    { id: tech ? tech.id : '', remove: tech ? 'tech-delete' : null, submit: tech ? 'Guardar' : 'Añadir' });
}

function importDialog() {
  const options = assignableNames(null);
  if (!options.length) { state.notice = 'Añade antes un técnico al que asignar los eventos.'; render(); return; }
  openModal('Importar calendario', 'calendarImport',
    `<p class="muted">Elige un archivo de calendario (.ics). En Google Calendar: Ajustes, «Importar y exportar», Exportar. En el Calendario de Mac (iCloud): Archivo, Exportar.</p>
    <label class="field">Archivo .ics<input class="input" type="file" name="file" accept=".ics,text/calendar" required></label>`
    + select('Asignar los eventos a', 'employee', options, options[0])
    + '<p class="muted">Se importan los eventos de 12 meses atrás a 12 meses adelante. Los que ya estén se omiten.</p>',
    { submit: 'Importar' });
}

function inviteDialog() {
  openModal('Invitar técnico', 'invite',
    '<p class="muted">El técnico se registra en OSKI con este correo y queda dentro de tu empresa. Usa el mismo nombre con el que le asignas proyectos.</p>'
    + field('Correo del técnico', 'email', '', 'type="email" required')
    + field('Nombre', 'name', '', 'required')
    + select('Permisos', 'level', Object.entries(LEVELS).map(([value, [label, summary]]) => [value, `${label}: ${summary}`]), 'basic'),
    { submit: 'Invitar' });
}

// ---------- form handling

const forms = {
  async auth(values) {
    state.busy = true; state.authError = ''; state.authInfo = ''; render();
    try {
      if (state.recovering) {
        const { error } = await db.auth.updateUser({ password: values.password });
        if (error) throw error;
        state.recovering = false;
        await enter();
      } else if (state.awaitingCode) {
        const { data, error } = await db.auth.verifyOtp({ email: state.authEmail, token: values.code.trim(), type: 'signup' });
        if (error) throw error;
        state.session = data.session; state.awaitingCode = false;
        await enter();
      } else if (state.authMode === 'signIn') {
        state.authEmail = values.email.trim();
        const { data, error } = await db.auth.signInWithPassword({ email: state.authEmail, password: values.password });
        if (error) throw error;
        state.session = data.session;
        await enter();
      } else {
        state.authEmail = values.email.trim();
        const { data, error } = await db.auth.signUp({
          email: state.authEmail, password: values.password,
          options: { data: { account_type: state.authMode, display_name: values.name.trim() } },
        });
        if (error) throw error;
        if (data.user && data.user.identities && !data.user.identities.length) throw new Error('Ese correo ya está registrado. Entra con tu contraseña.');
        state.awaitingCode = true;
      }
    } catch (error) {
      state.authError = message(error);
    }
    state.busy = false; render();
  },

  project(values, id) {
    const start = fromInput(values.start); const end = fromInput(values.end);
    return change(() => saveRecord('projects', {
      id: id || newID(), projectName: values.name.trim(), productionCompany: values.company.trim(),
      employeeName: values.employee, date: toSwift(start < end ? start : end), endDate: toSwift(start < end ? end : start),
    }));
  },

  reserve(values, id) {
    const item = state.items.find((i) => i.id === (id || values.item));
    const start = fromInput(values.start); const end = fromInput(values.end);
    const notes = [values.project.trim(), values.company.trim()].filter(Boolean).join(' · ');
    const record = { ...item, status: 'Ocupado', day: toSwift(start < end ? start : end), notes };
    if (start.getTime() === end.getTime()) delete record.endDay; else record.endDay = toSwift(start < end ? end : start);
    return change(() => saveRecord('items', record));
  },

  item(values, id, form) {
    const typed = chosenOrNew(values, 'category');
    if (!typed) return showFormError(form, 'Escribe el nombre de la categoría nueva.');
    const category = categories().find((c) => sameText(c, typed)) || typed;
    const created = category === typed && !categories().some((c) => sameText(c, typed)) ? typed : '';
    return change(async () => {
      if (created) {
        const settings = state.settings || { id: SETTINGS_ID, customCategories: [], categoryOrder: [], categoryColors: {} };
        await saveRecord('settings', {
          ...settings,
          customCategories: [...(settings.customCategories || []), created],
          categoryOrder: [...(settings.categoryOrder || []), created],
        });
      }
      await saveRecord('items', { id: newID(), name: values.name.trim(), status: 'Disponible', category, day: toSwift(new Date()), notes: '' });
    });
  },

  tech(values, id, form) {
    const typed = chosenOrNew(values, 'category');
    if (!typed) return showFormError(form, 'Escribe el nombre de la categoría nueva.');
    const category = technicianCategories().find((c) => sameText(c, typed)) || typed;
    const existing = state.technicians.find((t) => t.id === id);
    return change(() => saveRecord('technicians', {
      id: id || newID(), name: values.name.trim(), availability: values.availability, category,
      color: existing ? existing.color : TECH_COLORS[state.technicians.length % TECH_COLORS.length],
      phone: values.phone.trim(), email: values.email.trim(),
    }));
  },

  async calendarImport(values, id, form) {
    let events;
    try {
      events = parseICS(await values.file.text());
    } catch (error) {
      return showFormError(form, 'No se pudo leer el archivo.');
    }
    if (!events.length) return showFormError(form, 'El archivo no contiene eventos de calendario.');

    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    const to = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate());
    const key = (title, start, end) => `${title.trim().toLowerCase()}|${Math.round(start)}|${Math.round(end)}`;
    const known = new Set(state.projects.filter((p) => sameText(p.employeeName, values.employee))
      .map((p) => key(p.projectName, toSwift(startOfDay(fromSwift(p.date))), toSwift(startOfDay(fromSwift(p.endDate))))));
    const inRange = events.filter((e) => e.end >= from && e.start <= to);
    const records = [];

    for (const e of inRange) {
      const k = key(e.title, toSwift(e.start), toSwift(e.end));
      if (known.has(k)) continue;
      known.add(k);
      records.push({ id: newID(), projectName: e.title, productionCompany: e.description, employeeName: values.employee, date: toSwift(e.start), endDate: toSwift(e.end) });
    }

    await change(() => saveRecords('projects', records));
    if (!state.notice) {
      state.notice = records.length
        ? `Importados ${records.length} de ${inRange.length} eventos para ${values.employee}.`
        : `Ningún evento nuevo: los ${inRange.length} del periodo ya estaban importados o el archivo no tiene eventos en ese periodo.`;
      render();
    }
  },

  async invite(values, id, form) {
    const { error } = await db.from('invitations').insert({
      company_id: state.membership.company_id, email: values.email.trim().toLowerCase(),
      display_name: values.name.trim(), access_level: values.level,
    });
    if (error) {
      return showFormError(form, message(error));
    }
    closeModal();
    state.notice = `Invitación guardada para ${values.email.trim()}. Dile que se registre en OSKI con ese correo.`;
    render();
  },
};

function showFormError(form, text) {
  const box = form.querySelector('.error');
  box.textContent = text;
  box.hidden = false;
}

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  forms[form.dataset.form](Object.fromEntries(new FormData(form)), form.dataset.id, form);
});

// ---------- actions

const actions = {
  'auth-mode': (el) => { state.authMode = el.dataset.mode; state.authError = ''; state.authInfo = ''; render(); },
  'auth-back': () => { state.awaitingCode = false; state.authError = ''; render(); },
  'auth-recover': async () => {
    const email = app.querySelector('input[name="email"]').value.trim();
    state.authEmail = email; state.authError = ''; state.authInfo = '';
    if (!email) {
      state.authError = 'Escribe tu correo y vuelve a pulsar «Recuperar contraseña».';
    } else {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      if (error) state.authError = message(error);
      else state.authInfo = `Te hemos enviado un correo a ${email} con un enlace para elegir una contraseña nueva.`;
    }
    render();
  },
  'auth-resend': async () => {
    const { error } = await db.auth.resend({ type: 'signup', email: state.authEmail });
    state.authError = error ? message(error) : 'Te hemos enviado un código nuevo.';
    render();
  },
  'sign-out': async () => {
    await db.auth.signOut({ scope: 'local' });
    Object.assign(state, { session: null, membership: null, memberships: [], awaitingCode: false, authMode: 'signIn', notice: '' });
    render();
  },
  page: (el) => { state.page = el.dataset.page; state.notice = ''; render(); window.scrollTo(0, 0); },
  'calendar-mode': (el) => { state.calendarMode = el.dataset.mode; render(); },
  month: (el) => {
    const step = Number(el.dataset.step);
    state.anchor = step ? new Date(state.anchor.getFullYear(), state.anchor.getMonth() + step, 1) : startOfDay(new Date());
    render();
  },
  day: (el) => {
    const day = fromInput(el.dataset.day);
    state.selectedDay = state.selectedDay && state.selectedDay.getTime() === day.getTime() ? null : day;
    render();
  },
  'day-clear': () => { state.selectedDay = null; render(); },
  close: closeModal,
  'project-new': () => projectDialog(null),
  'project-edit': (el) => projectDialog(state.projects.find((p) => p.id === el.dataset.id)),
  'project-delete': (el) => change(() => deleteRecords('projects', [el.dataset.id])),
  'item-new': itemDialog,
  'item-reserve': (el) => reserveDialog(state.items.find((i) => i.id === el.dataset.id) || null),
  'item-release': (el) => {
    const item = { ...state.items.find((i) => i.id === el.dataset.id), status: 'Disponible', day: toSwift(new Date()), notes: '' };
    delete item.endDay;
    return change(() => saveRecord('items', item));
  },
  'item-delete': (el) => {
    const item = state.items.find((i) => i.id === el.dataset.id);
    if (window.confirm(`¿Eliminar «${item.name}» del inventario? No se puede deshacer.`)) change(() => deleteRecords('items', [item.id]));
  },
  'tech-new': () => techDialog(null),
  'tech-edit': (el) => techDialog(state.technicians.find((t) => t.id === el.dataset.id)),
  'tech-delete': (el) => change(() => deleteRecords('technicians', [el.dataset.id])),
  invite: inviteDialog,
  'calendar-import': importDialog,
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (el && el.tagName !== 'SELECT' && actions[el.dataset.action]) actions[el.dataset.action](el);
  else if (event.target === modal) closeModal();
});

document.addEventListener('change', async (event) => {
  const el = event.target;
  if (el.dataset.action === 'company') {
    state.membership = state.memberships.find((m) => m.company_id === el.value);
    localStorage.setItem('oski.company', el.value);
    state.page = 'calendar';
    await change(async () => {});
  } else if ('new' in el.dataset) {
    const extra = el.closest('label').nextElementSibling;
    extra.hidden = el.value !== NEW_OPTION;
    if (!extra.hidden) extra.querySelector('input').focus();
  } else if (el.dataset.input && el.tagName === 'SELECT') {
    state[el.dataset.input] = el.value;
    render();
  }
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.dataset.input === 'search') {
    state.search = el.value;
    render();
    const box = app.querySelector('[data-input="search"]');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
});

// ---------- start

(async function start() {
  render();
  const { data } = await db.auth.getSession();
  if (data.session) {
    state.session = data.session;
    if (openedFromRecoveryLink) {
      state.recovering = true;
      render();
    } else {
      await enter();
    }
  } else if (openedFromRecoveryLink) {
    state.authError = 'El enlace para cambiar la contraseña no es válido o ha caducado. Pide uno nuevo.';
    render();
  }
})();
