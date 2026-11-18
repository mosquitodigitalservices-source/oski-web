'use strict';

// Invoices (for companies) and payroll closings (for technicians), each tied to a project.
// Only function declarations live here; app.js, loaded afterwards, wires them into its
// pages, forms and actions.

function money(value, { decimals = true } = {}) {
  const number = Number(value) || 0;
  const whole = Number.isInteger(number) && !decimals;
  return number.toLocaleString('es-ES', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}
function parseAmount(text) { return Number(String(text || '').replace(/\s|€/g, '').replace(',', '.')) || 0; }
function longDate(seconds) { return fromSwift(seconds).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function hoursText(hours) {
  const whole = Math.floor(hours);
  const half = hours - whole === 0.5 ? '1/2' : '';
  if (half) return whole ? `${whole} ${half}` : half;
  return money(hours, { decimals: false });
}
function myProfile() {
  return state.profile || { id: state.session.user.id, userId: state.session.user.id };
}
function invoiceTotal(invoice) { return invoice.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0); }
function payrollExtraHours(payroll) { return payroll.extras.reduce((sum, extra) => sum + (Number(extra.hours) || 0), 0); }
function payrollTotal(payroll) { return payroll.days * payroll.dayRate + payrollExtraHours(payroll) * payroll.extraRate; }
function projectOptions(selected) {
  const options = [['', 'Sin proyecto'], ...[...state.projects].sort((a, b) => b.date - a.date)
    .map((p) => [p.id, `${p.projectName} · ${shortDate(fromSwift(p.date))}`])];
  return select('Proyecto', 'projectId', options, selected || '').replace('<select ', '<select data-project ');
}

// ---------- pages

function invoicesHTML() {
  const rows = [...state.invoices].sort((a, b) => b.number - a.number).map((invoice) => `<div class="row">
    <div class="main"><b>Nº ${esc(invoice.number)} · ${esc(invoice.client.name || 'Sin cliente')}</b>
      <span>${esc(invoice.projectName || invoice.lines[0]?.description || '')}</span></div>
    <span class="when">${longDate(invoice.date)}</span>
    <span class="badge on">${money(invoiceTotal(invoice))} €</span>
    <button type="button" class="btn small" data-action="doc-open" data-type="invoice" data-id="${invoice.id}">Ver</button>
    <button type="button" class="icon-btn" data-action="invoice-edit" data-id="${invoice.id}" aria-label="Editar factura">✎</button>
  </div>`).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Facturas</h1>
    <button type="button" class="btn" data-action="profile-edit" data-kind="company">Mis datos</button>
    <button type="button" class="btn primary" data-action="invoice-new">+ Nueva factura</button>
  </div>
  <section class="box">${rows ? `<div class="rows">${rows}</div>` : '<p class="empty">Todavía no hay facturas.</p>'}</section>`;
}

function payrollsHTML() {
  const mine = (payroll) => payroll.userId === state.session.user.id;
  const rows = [...state.payrolls].sort((a, b) => b.shootDate - a.shootDate).map((payroll) => `<div class="row">
    <div class="main"><b>${esc(payroll.projectName || 'Sin proyecto')}</b>
      <span>${esc([payroll.person.name, payroll.person.surname].filter(Boolean).join(' '))}${payroll.person.role ? ` · ${esc(payroll.person.role)}` : ''}</span></div>
    <span class="when">${longDate(payroll.shootDate)}</span>
    <span class="badge on">${money(payrollTotal(payroll), { decimals: false })} €</span>
    <button type="button" class="btn small" data-action="doc-open" data-type="payroll" data-id="${payroll.id}">Ver</button>
    ${mine(payroll) ? `<button type="button" class="icon-btn" data-action="payroll-edit" data-id="${payroll.id}" aria-label="Editar nómina">✎</button>` : ''}
  </div>`).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Nóminas</h1>
    <button type="button" class="btn" data-action="profile-edit" data-kind="person">Mis datos</button>
    <button type="button" class="btn primary" data-action="payroll-new">+ Nueva nómina</button>
  </div>
  <section class="box">${rows ? `<div class="rows">${rows}</div>` : '<p class="empty">Todavía no hay cierres de nómina.</p>'}</section>`;
}

// ---------- dialogs

function rowsField(title, rowHTML, rows) {
  return `<div class="field">${title}<div class="lines" data-rows>${rows.map(rowHTML).join('')}</div>
    <button type="button" class="link" data-action="row-add">+ Añadir línea</button></div>`;
}

function invoiceLineHTML(line) {
  return `<div class="line">
    <input class="input grow" name="lineDescription" placeholder="Descripción" value="${esc(line.description)}">
    <input class="input amount" name="lineAmount" inputmode="decimal" placeholder="Importe" value="${line.amount ? esc(money(line.amount)) : ''}">
    <button type="button" class="icon-btn" data-action="row-remove" aria-label="Quitar línea">×</button>
  </div>`;
}

function extraLineHTML(extra) {
  return `<div class="line">
    <input class="input" name="extraDay" type="date" value="${extra.day ? toInput(fromSwift(extra.day)) : ''}" aria-label="Día">
    <input class="input grow" name="extraSchedule" placeholder="09:00 - 21:30" value="${esc(extra.schedule)}" aria-label="Horario">
    <input class="input amount" name="extraHours" inputmode="decimal" placeholder="Horas" value="${extra.hours ? esc(String(extra.hours).replace('.', ',')) : ''}" aria-label="Horas extra">
    <button type="button" class="icon-btn" data-action="row-remove" aria-label="Quitar línea">×</button>
  </div>`;
}

function profileDialog(kind) {
  const p = myProfile();
  const fields = kind === 'company'
    ? field('Nombre o razón social', 'name', p.name, 'required') + field('NIF', 'taxId', p.taxId)
      + field('Dirección', 'address1', p.address1) + field('Código postal y ciudad', 'address2', p.address2)
    : `<div class="pair">${field('Nombre', 'name', p.name, 'required')}${field('Apellidos', 'surname', p.surname)}</div>`
      + `<div class="pair">${field('Cargo', 'role', p.role)}${field('DNI', 'taxId', p.taxId)}</div>`
      + `<div class="pair">${field('Email', 'email', p.email || state.session.user.email, 'type="email"')}${field('Teléfono', 'phone', p.phone, 'type="tel"')}</div>`
      + field('Nº de cuenta (IBAN)', 'iban', p.iban);
  openModal('Mis datos', 'profile',
    `<p class="muted">Aparecen en ${kind === 'company' ? 'tus facturas' : 'tus cierres de nómina'}. Solo tú puedes verlos.</p>${fields}`);
}

function invoiceDialog(invoice) {
  const p = myProfile();
  if (!invoice && !p.name) { state.notice = 'Rellena antes «Mis datos»: son los datos del emisor de la factura.'; render(); return; }
  const next = state.invoices.reduce((max, i) => Math.max(max, Number(i.number) || 0), 0) + 1;
  const current = invoice || { number: next, date: toSwift(startOfDay(new Date())), projectId: '', client: {}, lines: [{ description: '', amount: 0 }] };
  openModal(invoice ? 'Editar factura' : 'Nueva factura', 'invoice',
    projectOptions(current.projectId)
    + `<div class="pair">${field('Nº de factura', 'number', current.number, 'inputmode="numeric" required')}${field('Fecha', 'date', toInput(fromSwift(current.date)), 'type="date" required')}</div>`
    + `<div class="pair">${field('Cliente', 'clientName', current.client.name, 'required')}${field('NIF del cliente', 'clientTaxId', current.client.taxId)}</div>`
    + `<div class="pair">${field('Dirección', 'clientAddress1', current.client.address1)}${field('Código postal y ciudad', 'clientAddress2', current.client.address2)}</div>`
    + rowsField('Conceptos', invoiceLineHTML, current.lines),
    { id: invoice ? invoice.id : '', remove: invoice ? 'invoice-delete' : null });
}

function payrollDialog(payroll) {
  const p = myProfile();
  if (!payroll && !p.name) { state.notice = 'Rellena antes «Mis datos»: nombre, DNI y cuenta para el cierre de nómina.'; render(); return; }
  const current = payroll || { projectId: '', shootDate: toSwift(startOfDay(new Date())), days: 1, dayRate: 0, extraRate: 0, irpf: 0, extras: [{ day: 0, schedule: '', hours: 0 }] };
  const extras = current.extras.length ? current.extras : [{ day: 0, schedule: '', hours: 0 }];
  openModal(payroll ? 'Editar nómina' : 'Nueva nómina', 'payroll',
    projectOptions(current.projectId)
    + field('Fecha de rodaje', 'shootDate', toInput(fromSwift(current.shootDate)), 'type="date" required')
    + `<div class="pair">${field('Jornadas', 'days', current.days, 'inputmode="decimal" required')}${field('Tarifa por jornada (€)', 'dayRate', current.dayRate || '', 'inputmode="decimal" required')}</div>`
    + `<div class="pair">${field('Tarifa hora extra (€)', 'extraRate', current.extraRate || '', 'inputmode="decimal"')}${field('Retención IRPF (%)', 'irpf', current.irpf || '', 'inputmode="decimal"')}</div>`
    + rowsField('Horas extra: día, horario y horas', extraLineHTML, extras),
    { id: payroll ? payroll.id : '', remove: payroll ? 'payroll-delete' : null });
}

/** Fills the form from the chosen project while the person has not typed their own values. */
function fillFromProject(selectEl) {
  const project = state.projects.find((p) => p.id === selectEl.value);
  if (!project) return;
  const form = selectEl.form;
  const description = form.querySelector('[name="lineDescription"]');
  if (description && !description.value) description.value = project.projectName;
  const client = form.querySelector('[name="clientName"]');
  if (client && !client.value) client.value = project.productionCompany || '';
  const shootDate = form.querySelector('[name="shootDate"]');
  if (shootDate) {
    shootDate.value = toInput(fromSwift(project.endDate));
    const days = Math.round((startOfDay(fromSwift(project.endDate)) - startOfDay(fromSwift(project.date))) / 86400000) + 1;
    form.querySelector('[name="days"]').value = days;
  }
}

// ---------- forms

function profileForm(values) {
  const clean = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).trim()]));
  return change(() => saveRecord('profiles', { ...myProfile(), ...clean }));
}

function invoiceForm(values, id, form) {
  const data = new FormData(form);
  const amounts = data.getAll('lineAmount');
  const lines = data.getAll('lineDescription')
    .map((description, index) => ({ description: String(description).trim(), amount: parseAmount(amounts[index]) }))
    .filter((line) => line.description || line.amount);
  if (!lines.length) return showFormError(form, 'Añade al menos un concepto con su importe.');
  const existing = state.invoices.find((i) => i.id === id);
  const p = myProfile();
  const project = state.projects.find((x) => x.id === values.projectId);
  return change(() => saveRecord('invoices', {
    id: id || newID(), userId: existing ? existing.userId : state.session.user.id,
    number: Number(values.number) || values.number.trim(), date: toSwift(fromInput(values.date)),
    projectId: values.projectId, projectName: project ? project.projectName : '',
    issuer: existing ? existing.issuer : { name: p.name, taxId: p.taxId, address1: p.address1, address2: p.address2 },
    client: { name: values.clientName.trim(), taxId: values.clientTaxId.trim(), address1: values.clientAddress1.trim(), address2: values.clientAddress2.trim() },
    lines,
  }));
}

function payrollForm(values, id, form) {
  const data = new FormData(form);
  const days = data.getAll('extraDay'); const schedules = data.getAll('extraSchedule'); const hours = data.getAll('extraHours');
  const extras = days.map((day, index) => ({ day: day ? toSwift(fromInput(day)) : 0, schedule: String(schedules[index]).trim(), hours: parseAmount(hours[index]) }))
    .filter((extra) => extra.day && extra.hours);
  const existing = state.payrolls.find((x) => x.id === id);
  const p = myProfile();
  const project = state.projects.find((x) => x.id === values.projectId);
  return change(() => saveRecord('payrolls', {
    id: id || newID(), userId: state.session.user.id,
    projectId: values.projectId, projectName: project ? project.projectName : (existing ? existing.projectName : ''),
    shootDate: toSwift(fromInput(values.shootDate)),
    person: { name: p.name, surname: p.surname, role: p.role, taxId: p.taxId, email: p.email, phone: p.phone, iban: p.iban },
    days: parseAmount(values.days), dayRate: parseAmount(values.dayRate), extraRate: parseAmount(values.extraRate), irpf: parseAmount(values.irpf),
    extras,
  }));
}

// ---------- printable sheets

function sheetHTML() {
  const { type, id } = state.sheet;
  const record = (type === 'invoice' ? state.invoices : state.payrolls).find((x) => x.id === id);
  const body = !record ? '<p class="empty">Este documento ya no existe.</p>' : (type === 'invoice' ? invoiceSheet(record) : payrollSheet(record));
  return `<div class="sheet-bar">
    <button type="button" class="btn" data-action="doc-close">Volver</button>
    <button type="button" class="btn primary" data-action="doc-print">Imprimir o guardar PDF</button>
  </div>
  <article class="sheet ${type}">${body}</article>`;
}

function invoiceSheet(invoice) {
  const lines = (party) => [party.taxId, party.address1, party.address2].filter(Boolean).map((line) => `<div>${esc(line)}</div>`).join('');
  return `<header class="inv-head"><strong>${esc(invoice.issuer.name)}</strong><strong>INVOICE</strong></header>
    <div class="inv-party">${lines(invoice.issuer)}</div>
    <div class="inv-meta">
      <div class="inv-party"><b>Bill To</b><div>${esc(invoice.client.name)}</div>${lines(invoice.client)}</div>
      <table class="inv-info"><tr><th>Invoice #</th><td>${esc(invoice.number)}</td></tr>
        <tr><th>Invoice Date</th><td>${longDate(invoice.date).replace(/\//g, '.')}</td></tr></table>
    </div>
    <table class="inv-lines">
      <thead><tr><th>DESCRIPTION</th><th>AMOUNT</th></tr></thead>
      <tbody>${invoice.lines.map((line) => `<tr><td>${esc(line.description)}</td><td>${money(line.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>TOTAL</th><td>${money(invoiceTotal(invoice))} €</td></tr></tfoot>
    </table>`;
}

function payrollSheet(payroll) {
  const person = payroll.person;
  const extraHours = payrollExtraHours(payroll);
  const euros = (value) => `${money(value, { decimals: false })}€`;
  const info = (label, value) => (value ? `<div><u><b>${label}</b></u>: ${esc(value)}</div>` : '');
  return `<table class="pay-head">
      <tr><th colspan="2">Cierre Nómina // ${esc(payroll.projectName || 'Sin proyecto')}</th></tr>
      <tr><td colspan="2"><b>Fecha de rodaje ${longDate(payroll.shootDate)}</b></td></tr>
      <tr><td>${info('Nombre', person.name)}${info('Apellidos', person.surname)}${info('Cargo', person.role)}${info('DNI', person.taxId)}</td>
        <td>${info('Email', person.email)}${info('Tel', person.phone)}${info('Nº Cuenta', person.iban)}</td></tr>
    </table>
    <table class="pay-table">
      <thead><tr><th>Jornadas (11+1)</th><th>Tarifa jornada</th><th>Cantidad total</th></tr></thead>
      <tbody>
        <tr><td>Shooting Days <b>x ${money(payroll.days, { decimals: false })}</b></td><td>${euros(payroll.dayRate)}</td><td>${euros(payroll.days * payroll.dayRate)}</td></tr>
        ${extraHours ? `<tr><td>Horas Extra (11+1) <b>x ${hoursText(extraHours)}</b></td><td>${euros(payroll.extraRate)}</td><td>${euros(extraHours * payroll.extraRate)}</td></tr>` : ''}
        ${payroll.irpf ? `<tr><td colspan="3"><b>Retención IRPF ${money(payroll.irpf, { decimals: false })}%</b></td></tr>` : ''}
        <tr><td colspan="2"><b>TOTAL BRUTO EN NÓMINA</b></td><td>${euros(payrollTotal(payroll))}</td></tr>
      </tbody>
    </table>
    ${payroll.extras.length ? `<table class="pay-table">
      <thead><tr><th colspan="3">HORAS EXTRAS</th></tr><tr><th>Día</th><th>Horario</th><th>Extra</th></tr></thead>
      <tbody>${payroll.extras.map((extra) => `<tr><td><b>${longDate(extra.day)}</b></td><td>${esc(extra.schedule)}</td><td>${hoursText(extra.hours)}h</td></tr>`).join('')}</tbody>
    </table>` : ''}
    <footer class="pay-foot"><div>${esc([person.name, person.surname].filter(Boolean).join(' '))}</div><div>${esc(person.email)}</div><div>${esc(person.phone)}</div></footer>`;
}
