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
function invoiceSubtotal(invoice) { return invoice.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0); }
/** Older invoices were saved without VAT, so a missing rate counts as 0 to keep their totals. */
function invoiceVat(invoice) { return Math.round(invoiceSubtotal(invoice) * (Number(invoice.vat) || 0)) / 100; }
function invoiceTotal(invoice) { return invoiceSubtotal(invoice) + invoiceVat(invoice); }
const DEFAULT_PAYMENT_TERMS = 'Transferencia bancaria a 30 días f.f.';
function payrollExtraHours(payroll) { return payroll.extras.reduce((sum, extra) => sum + (Number(extra.hours) || 0), 0); }
function payrollTotal(payroll) { return payroll.days * payroll.dayRate + payrollExtraHours(payroll) * payroll.extraRate; }
/** Upcoming projects of the technicians first (soonest on top), then the past ones, so a new
 *  document starts from what is coming without losing the jobs already done. */
function projectOptions(selected) {
  const label = (p) => [p.projectName, p.productionCompany, rangeText(fromSwift(p.date), fromSwift(p.endDate)), p.employeeName]
    .filter(Boolean).join(' · ');
  const option = (p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(label(p))}</option>`;
  const group = (title, projects) => (projects.length ? `<optgroup label="${title}">${projects.map(option).join('')}</optgroup>` : '');
  const upcoming = state.projects.filter((p) => !isPast(p.endDate)).sort((a, b) => a.date - b.date);
  const past = state.projects.filter((p) => isPast(p.endDate)).sort((a, b) => b.date - a.date);
  return `<label class="field">Proyecto<select class="input" name="projectId" data-project>
    <option value="" ${selected ? '' : 'selected'}>Sin proyecto</option>${group('Próximos proyectos', upcoming)}${group('Anteriores', past)}
  </select></label>`;
}

// ---------- pages

function invoicesHTML() {
  const sorted = [...state.invoices].sort((a, b) => b.date - a.date || String(b.number).localeCompare(String(a.number), 'es', { numeric: true }));
  const groups = new Map();
  for (const invoice of sorted) {
    const key = fromSwift(invoice.date).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    groups.set(key, [...(groups.get(key) || []), invoice]);
  }
  const row = (invoice) => {
    const paid = invoice.paid === true;
    return `<div class="row inv-row ${paid ? 'paid' : 'due'}">
    <div class="main"><b>Nº ${esc(invoice.number)} · ${esc(invoice.client.name || 'Sin cliente')}</b>
      <span>${esc(invoice.projectName || invoice.lines[0]?.description || '')}</span></div>
    <span class="when">${longDate(invoice.date)}</span>
    <span class="amount">${money(invoiceTotal(invoice))} €</span>
    <button type="button" class="badge pay ${paid ? 'paid' : 'due'}" data-action="invoice-paid" data-id="${invoice.id}" title="Cambiar estado de pago">${paid ? 'Pagada' : 'Pendiente'}</button>
    <button type="button" class="btn small" data-action="doc-open" data-type="invoice" data-id="${invoice.id}">Ver</button>
    <button type="button" class="icon-btn" data-action="invoice-edit" data-id="${invoice.id}" aria-label="Editar factura">✎</button>
  </div>`;
  };
  const body = [...groups].map(([month, invoices]) => {
    const pending = invoices.filter((i) => i.paid !== true).reduce((sum, i) => sum + invoiceTotal(i), 0);
    return `<h3 class="group"><span>${esc(month)}</span>${pending ? `<span class="group-due">Pendiente ${money(pending)} €</span>` : ''}</h3>
      <div class="rows">${invoices.map(row).join('')}</div>`;
  }).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Facturas</h1>
    <button type="button" class="btn" data-action="profile-edit" data-kind="company">Mis datos</button>
    <button type="button" class="btn primary" data-action="invoice-new">+ Nueva factura</button>
  </div>
  <section class="box">${body || '<p class="empty">Todavía no hay facturas.</p>'}</section>`;
}

function payrollsHTML() {
  const mine = (payroll) => payroll.userId === state.session.user.id;
  const rows = [...state.payrolls].sort((a, b) => b.shootDate - a.shootDate).map((payroll) => `<div class="row">
    <div class="main"><b>${esc([payroll.projectName || 'Sin proyecto', payroll.production].filter(Boolean).join(' x '))}</b>
      <span>${esc([payroll.person.name, payroll.person.surname].filter(Boolean).join(' '))}${payroll.person.role ? ` · ${esc(payroll.person.role)}` : ''}</span></div>
    <span class="when">${longDate(payroll.shootDate)}</span>
    <span class="badge on">${money(payrollTotal(payroll), { decimals: false })} €</span>
    <button type="button" class="btn small" data-action="doc-open" data-type="payroll" data-id="${payroll.id}">Ver</button>
    ${mine(payroll) ? `<button type="button" class="icon-btn" data-action="payroll-edit" data-id="${payroll.id}" aria-label="Editar nómina">✎</button>` : ''}
  </div>`).join('');

  return `<div class="page-title">
    <h1 class="eyebrow">Nóminas</h1>
    <button type="button" class="btn" data-action="profile-edit" data-kind="person">Mis datos</button>
    <button type="button" class="btn" data-action="payroll-style">Diseño de la hoja</button>
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
    <input class="input grow" name="lineDescription" placeholder="Concepto" value="${esc(line.description)}">
    <input class="input" name="lineDetail" placeholder="Detalle (2 x 125€)" value="${esc(line.detail || '')}">
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
    ? `<div class="pair">${field('Nombre o razón social', 'name', p.name, 'required')}${field('NIF', 'taxId', p.taxId)}</div>`
      + `<div class="pair">${field('Dirección', 'address1', p.address1)}${field('Código postal y ciudad', 'address2', p.address2)}</div>`
      + `<div class="pair">${field('Email de contacto', 'email', p.email || state.session.user.email, 'type="email"')}${field('Teléfono', 'phone', p.phone, 'type="tel"')}</div>`
      + `<label class="field">Cuentas bancarias (una por línea)<textarea class="input" name="banks" rows="2" placeholder="CaixaBank ES00 0000 0000 0000 0000 0000">${esc(p.banks || '')}</textarea></label>`
      + `<div class="pair">${field('IVA habitual (%)', 'vat', p.vat ?? 21, 'inputmode="decimal"')}${field('Forma de pago habitual', 'paymentTerms', p.paymentTerms || DEFAULT_PAYMENT_TERMS)}</div>`
      + field('Registro Mercantil (pie de factura)', 'registry', p.registry, 'placeholder="Registro Mercantil de Madrid, Tomo …"')
      + `<div class="field">Logo${p.logo ? `<img class="style-preview" src="${p.logo}" alt="">` : ''}
        <input class="input" type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml">
        ${p.logo ? '<label class="check"><input type="checkbox" name="logoRemove"> Quitar</label>' : ''}</div>`
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
  const current = invoice || { number: '', date: toSwift(startOfDay(new Date())), projectId: '', client: {},
    lines: [{ description: '', detail: '', amount: 0 }], vat: p.vat ?? 21, paymentTerms: p.paymentTerms || DEFAULT_PAYMENT_TERMS };
  openModal(invoice ? 'Editar factura' : 'Nueva factura', 'invoice',
    projectOptions(current.projectId)
    + `<div class="pair">${field('Nº de factura', 'number', current.number, `placeholder="${esc(nextInvoiceNumber())}" required`)}${field('Fecha', 'date', toInput(fromSwift(current.date)), 'type="date" required')}</div>`
    + `<div class="pair">${field('Cliente', 'clientName', current.client.name, 'required')}${field('NIF del cliente', 'clientTaxId', current.client.taxId)}</div>`
    + `<div class="pair">${field('Dirección', 'clientAddress1', current.client.address1)}${field('Código postal y ciudad', 'clientAddress2', current.client.address2)}</div>`
    + rowsField('Conceptos', invoiceLineHTML, current.lines)
    + `<div class="pair">${field('IVA (%)', 'vat', current.vat ?? 0, 'inputmode="decimal"')}${field('Forma de pago', 'paymentTerms', current.paymentTerms || '')}</div>`,
    { id: invoice ? invoice.id : '', remove: invoice ? 'invoice-delete' : null });
}

/** A suggestion such as "262/2026": one more than the highest number used this year. */
function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const used = state.invoices.map((i) => String(i.number)).filter((n) => n.endsWith(`/${year}`)).map((n) => parseInt(n, 10) || 0);
  return `${Math.max(0, ...used) + 1}/${year}`;
}

const DEFAULT_PAYROLL_TEMPLATES = [
  { id: 'ficcion', name: 'Ficción', schedule: '10+1', dayRate: 0, extraRate: 0, irpf: 15 },
  { id: 'publicidad', name: 'Publicidad', schedule: '11+1', dayRate: 0, extraRate: 0, irpf: 15 },
  { id: 'otros', name: 'Otros', schedule: '10+1', dayRate: 0, extraRate: 0, irpf: 15 },
];
const DEFAULT_PAYROLL_STYLE = { title: 'Cierre Nómina', headerColor: '#a4c2f4', tableColor: '#9fc5e8', logo: '', signature: '' };

function payrollTemplates() {
  const saved = myProfile().payrollTemplates;
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_PAYROLL_TEMPLATES;
}
function payrollStyle() { return { ...DEFAULT_PAYROLL_STYLE, ...(myProfile().payrollStyle || {}) }; }

function payrollDialog(payroll) {
  const p = myProfile();
  const first = payrollTemplates()[0];
  const current = payroll || { projectId: '', production: '', shootDate: toSwift(startOfDay(new Date())), days: 1, schedule: first.schedule,
    dayRate: first.dayRate, extraRate: first.extraRate, irpf: first.irpf, extras: [{ day: 0, schedule: '', hours: 0 }] };
  const person = payroll ? payroll.person : p;
  const extras = current.extras.length ? current.extras : [{ day: 0, schedule: '', hours: 0 }];
  const templates = payrollTemplates();
  const step = (n, title, body) => `<section class="step" data-step="${n}" ${n > 1 ? 'hidden' : ''}>
    <p class="step-title"><span>Paso ${n} de 3</span>${title}</p>${body}</section>`;
  openModal(payroll ? 'Editar nómina' : 'Nueva nómina', 'payroll',
    step(1, 'Plantilla y tarifas',
      `<div class="line">${select('Plantilla', 'template', [['', 'Elegir plantilla…'], ...templates.map((t) => [t.id, t.name])], '').replace('<select ', '<select data-template ')}
        <button type="button" class="link" data-action="template-save">Guardar como plantilla</button>
        <button type="button" class="link danger" data-action="template-delete">Eliminar</button></div>`
      + `<div class="pair">${field('Tipo de jornada', 'schedule', current.schedule || '11+1', 'placeholder="11+1"')}${field('Retención IRPF (%)', 'irpf', current.irpf || '', 'inputmode="decimal"')}</div>`
      + `<div class="pair">${field('Tarifa por jornada (€)', 'dayRate', current.dayRate || '', 'inputmode="decimal" required')}${field('Tarifa hora extra (€)', 'extraRate', current.extraRate || '', 'inputmode="decimal"')}</div>`)
    + step(2, 'Proyecto',
      projectOptions(current.projectId)
      + `<div class="pair">${field('Productora', 'production', current.production ?? '')}${field('Fecha de rodaje', 'shootDate', toInput(fromSwift(current.shootDate)), 'type="date" required')}</div>`
      + field('Jornadas', 'days', current.days, 'inputmode="decimal" required')
      + rowsField('Días: horario y horas extra', extraLineHTML, extras))
    + step(3, 'Datos del técnico',
      '<p class="muted">Se guardan en tu perfil y se rellenan solos en las próximas nóminas.</p>'
      + `<div class="pair">${field('Nombre', 'pName', person.name, 'required')}${field('Apellidos', 'pSurname', person.surname)}</div>`
      + `<div class="pair">${field('Cargo', 'pRole', person.role)}${field('DNI', 'pTaxId', person.taxId)}</div>`
      + `<div class="pair">${field('Email', 'pEmail', person.email, 'type="email"')}${field('Teléfono', 'pPhone', person.phone, 'type="tel"')}</div>`
      + field('Nº de cuenta (IBAN)', 'pIban', person.iban)),
    { id: payroll ? payroll.id : '', remove: payroll ? 'payroll-delete' : null });
  setupWizard(modal.querySelector('form'));
}

/** Shows one step at a time, with Atrás / Siguiente, and Guardar only on the last step. */
function setupWizard(form) {
  const foot = form.querySelector('.dlg-foot');
  const submit = foot.querySelector('.btn.primary');
  submit.insertAdjacentHTML('beforebegin',
    '<button type="button" class="btn" data-action="wizard-back">Atrás</button><button type="button" class="btn primary" data-action="wizard-next">Siguiente</button>');
  showWizardStep(form, 1);
}

function showWizardStep(form, number) {
  const steps = [...form.querySelectorAll('.step')];
  steps.forEach((step) => { step.hidden = Number(step.dataset.step) !== number; });
  form.dataset.step = number;
  const last = number === steps.length;
  form.querySelector('[data-action="wizard-back"]').hidden = number === 1;
  form.querySelector('[data-action="wizard-next"]').hidden = last;
  form.querySelector('.dlg-foot > button:not([type])').hidden = !last;
  form.querySelector('.error').hidden = true;
  const first = form.querySelector(`.step[data-step="${number}"] input, .step[data-step="${number}"] select`);
  if (first) first.focus();
}

function wizardMove(button, direction) {
  const form = button.form;
  const current = Number(form.dataset.step);
  if (direction > 0) {
    const invalid = [...form.querySelectorAll(`.step[data-step="${current}"] input`)].find((input) => !input.checkValidity());
    if (invalid) { invalid.reportValidity(); return; }
  }
  showWizardStep(form, current + direction);
}

function applyPayrollTemplate(selectEl) {
  const template = payrollTemplates().find((t) => t.id === selectEl.value);
  if (!template) return;
  const form = selectEl.form;
  for (const key of ['schedule', 'dayRate', 'extraRate', 'irpf']) {
    form.querySelector(`[name="${key}"]`).value = template[key] ? String(template[key]).replace('.', ',') : '';
  }
  fillExtraHours(form);
}

/** Hours a day rate covers: "11+1" is 12 (11 of work plus 1 for lunch). */
function coveredHours(dayType) {
  const parts = String(dayType).match(/\d+(?:[.,]\d+)?/g) || [];
  return parts.reduce((sum, part) => sum + parseFloat(part.replace(',', '.')), 0);
}

/** Length of a schedule such as "09:00 - 21:30" (12,5), past midnight when the end is earlier. */
function scheduleLength(schedule) {
  const times = [...String(schedule).matchAll(/(\d{1,2})(?:[:.h](\d{2}))?/g)];
  if (times.length < 2) return null;
  const minutes = ([, h, m]) => Number(h) * 60 + Number(m || 0);
  let length = minutes(times[1]) - minutes(times[0]);
  if (length <= 0) length += 24 * 60;
  return length / 60;
}

/** Fills each day's extra hours: whatever the schedule lasts beyond the hours of the day type. */
function fillExtraHours(form, onlyLine) {
  const covered = coveredHours(form.querySelector('[name="schedule"]').value);
  if (!covered) return;
  const lines = onlyLine ? [onlyLine] : [...form.querySelectorAll('[name="extraSchedule"]')].map((input) => input.closest('.line'));
  for (const line of lines) {
    const length = scheduleLength(line.querySelector('[name="extraSchedule"]').value);
    if (length === null) continue;
    const extra = Math.round(Math.max(0, length - covered) * 100) / 100;
    line.querySelector('[name="extraHours"]').value = extra ? String(extra).replace('.', ',') : '';
  }
}

function savePayrollTemplate(button) {
  const form = button.form;
  const chosen = payrollTemplates().find((t) => t.id === form.querySelector('[name="template"]').value);
  const name = window.prompt('Nombre de la plantilla', chosen ? chosen.name : '');
  if (!name || !name.trim()) return;
  const value = (key) => form.querySelector(`[name="${key}"]`).value;
  const template = { schedule: value('schedule').trim(), dayRate: parseAmount(value('dayRate')), extraRate: parseAmount(value('extraRate')), irpf: parseAmount(value('irpf')) };
  const templates = payrollTemplates().filter((t) => !sameText(t.name, name));
  templates.push({ id: newID(), name: name.trim(), ...template });
  saveProfileQuietly({ payrollTemplates: templates }, form, `Plantilla «${name.trim()}» guardada.`);
}

function deletePayrollTemplate(button) {
  const form = button.form;
  const chosen = payrollTemplates().find((t) => t.id === form.querySelector('[name="template"]').value);
  if (!chosen) return showFormError(form, 'Elige primero la plantilla que quieres eliminar.');
  if (!window.confirm(`¿Eliminar la plantilla «${chosen.name}»?`)) return;
  saveProfileQuietly({ payrollTemplates: payrollTemplates().filter((t) => t.id !== chosen.id) }, form, 'Plantilla eliminada.');
}

/** Saves profile fields without closing the open dialog, then refreshes its template list. */
async function saveProfileQuietly(changes, form, done) {
  const profile = { ...myProfile(), ...changes };
  try {
    await saveRecord('profiles', profile);
    state.profile = profile;
    const select = form.querySelector('[name="template"]');
    select.innerHTML = [['', 'Elegir plantilla…'], ...payrollTemplates().map((t) => [t.id, t.name])]
      .map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    showFormError(form, done);
  } catch (error) {
    showFormError(form, message(error));
  }
}

function payrollStyleDialog() {
  const style = payrollStyle();
  const image = (name, label, value) => `<div class="field">${label}
    ${value ? `<img class="style-preview" src="${value}" alt="">` : ''}
    <input class="input" type="file" name="${name}" accept="image/png,image/jpeg,image/svg+xml">
    ${value ? `<label class="check"><input type="checkbox" name="${name}Remove"> Quitar</label>` : ''}</div>`;
  openModal('Diseño de la hoja', 'payrollStyle',
    field('Título del encabezado', 'title', style.title, 'required')
    + `<div class="pair">${field('Color del encabezado', 'headerColor', style.headerColor, 'type="color"')}${field('Color de las tablas', 'tableColor', style.tableColor, 'type="color"')}</div>`
    + image('logo', 'Logo (aparece al pie)', style.logo)
    + image('signature', 'Firma', style.signature)
    + '<button type="button" class="link" data-action="style-reset">Volver al diseño original</button>');
}

/** Shrinks an image to at most 500 px wide so it fits in the database record. */
function imageToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
      img.onload = () => {
        const scale = Math.min(1, 500 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function payrollStyleForm(values, id, form) {
  const style = payrollStyle();
  const next = { ...style, title: values.title.trim() || DEFAULT_PAYROLL_STYLE.title, headerColor: values.headerColor, tableColor: values.tableColor };
  try {
    for (const key of ['logo', 'signature']) {
      if (values[`${key}Remove`]) next[key] = '';
      else if (values[key] && values[key].size) next[key] = await imageToDataURL(values[key]);
    }
  } catch (error) {
    return showFormError(form, error.message);
  }
  return change(() => saveRecord('profiles', { ...myProfile(), payrollStyle: next }));
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
  const production = form.querySelector('[name="production"]');
  if (production) production.value = project.productionCompany || '';
  const shootDate = form.querySelector('[name="shootDate"]');
  if (shootDate) {
    shootDate.value = toInput(fromSwift(project.endDate));
    const days = Math.round((startOfDay(fromSwift(project.endDate)) - startOfDay(fromSwift(project.date))) / 86400000) + 1;
    form.querySelector('[name="days"]').value = days;
    fillProjectDays(form, project, days);
  }
}

/** One extra-hours line per shooting day, keeping whatever was already typed for a day. */
function fillProjectDays(form, project, days) {
  const rows = form.querySelector('[name="extraDay"]').closest('[data-rows]');
  const typed = new Map([...rows.querySelectorAll('.line')].map((line) => [
    line.querySelector('[name="extraDay"]').value,
    { schedule: line.querySelector('[name="extraSchedule"]').value, hours: parseAmount(line.querySelector('[name="extraHours"]').value) },
  ]));
  const start = startOfDay(fromSwift(project.date));
  rows.innerHTML = Array.from({ length: Math.min(days, 60) }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const kept = typed.get(toInput(day)) || { schedule: '', hours: 0 };
    return extraLineHTML({ day: toSwift(day), ...kept });
  }).join('');
}

// ---------- forms

async function profileForm(values, id, form) {
  const { logo, logoRemove, ...rest } = values;
  const next = { ...myProfile(), ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, String(value).trim()])) };
  if ('vat' in rest) next.vat = parseAmount(rest.vat);
  try {
    if (logoRemove) next.logo = '';
    else if (logo && logo.size) next.logo = await imageToDataURL(logo);
  } catch (error) {
    return showFormError(form, error.message);
  }
  return change(() => saveRecord('profiles', next));
}

function invoiceForm(values, id, form) {
  const data = new FormData(form);
  const amounts = data.getAll('lineAmount'); const details = data.getAll('lineDetail');
  const lines = data.getAll('lineDescription')
    .map((description, index) => ({ description: String(description).trim(), detail: String(details[index] || '').trim(), amount: parseAmount(amounts[index]) }))
    .filter((line) => line.description || line.amount);
  if (!lines.length) return showFormError(form, 'Añade al menos un concepto con su importe.');
  const existing = state.invoices.find((i) => i.id === id);
  const p = myProfile();
  const project = state.projects.find((x) => x.id === values.projectId);
  return change(() => saveRecord('invoices', {
    id: id || newID(), userId: existing ? existing.userId : state.session.user.id,
    number: values.number.trim(), date: toSwift(fromInput(values.date)),
    projectId: values.projectId, projectName: project ? project.projectName : (existing ? existing.projectName : ''),
    issuer: existing ? existing.issuer : { name: p.name, taxId: p.taxId, address1: p.address1, address2: p.address2,
      email: p.email || '', phone: p.phone || '', banks: p.banks || '', registry: p.registry || '', logo: p.logo || '' },
    vat: parseAmount(values.vat), paymentTerms: values.paymentTerms.trim(),
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
  const project = state.projects.find((x) => x.id === values.projectId);
  const text = (key) => String(values[key] || '').trim();
  const person = { name: text('pName'), surname: text('pSurname'), role: text('pRole'), taxId: text('pTaxId'), email: text('pEmail'), phone: text('pPhone'), iban: text('pIban') };
  return change(async () => {
    await saveRecord('profiles', { ...myProfile(), ...person });
    await savePayroll(person);
  });

  function savePayroll(person) { return saveRecord('payrolls', {
    id: id || newID(), userId: state.session.user.id,
    projectId: values.projectId, projectName: project ? project.projectName : (existing ? existing.projectName : ''),
    production: text('production'),
    shootDate: toSwift(fromInput(values.shootDate)),
    person,
    days: parseAmount(values.days), schedule: text('schedule') || '11+1',
    dayRate: parseAmount(values.dayRate), extraRate: parseAmount(values.extraRate), irpf: parseAmount(values.irpf),
    extras,
  }); }
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
  const issuer = invoice.issuer; const client = invoice.client;
  const block = (party) => [party.name, party.address1, party.address2, party.taxId].filter(Boolean).map((line) => `<div>${esc(line)}</div>`).join('');
  const euros = (value) => `€${money(value)}`;
  const banks = String(issuer.banks || '').split('\n').map((b) => b.trim()).filter(Boolean);
  return `<header class="inv-top">
      <h1>FACTURA</h1>
      <div class="inv-issuer">${block(issuer)}</div>
      ${issuer.logo ? `<img class="inv-logo" src="${issuer.logo}" alt="">` : '<span class="inv-logo"></span>'}
    </header>
    <div class="inv-meta">
      <div class="inv-client">${block(client)}</div>
      <table class="inv-info"><tr><th>Nº Factura</th><td>${esc(invoice.number)}</td></tr>
        <tr><th>Fecha</th><td>${longDate(invoice.date).replace(/\//g, '.')}</td></tr></table>
    </div>
    <div class="inv-head"><span>CONCEPTO</span><span>IMPORTE</span></div>
    <div class="inv-body">
      ${invoice.projectName ? `<p class="inv-ref">Referencia: "${esc(invoice.projectName)}"</p>` : ''}
      ${invoice.lines.map((line) => `<div class="inv-line"><b>${esc(line.description)}</b><span>${esc(line.detail || '')}</span><span>${euros(line.amount)}</span></div>`).join('')}
    </div>
    <table class="inv-totals">
      <tr><td></td><th>SubTotal</th><td>${euros(invoiceSubtotal(invoice))}</td></tr>
      <tr><td></td><th>IVA (${money(invoice.vat || 0, { decimals: false })}%)</th><td>${euros(invoiceVat(invoice))}</td></tr>
      <tr class="inv-total"><td>${invoice.paymentTerms ? `<b>Forma de Pago:</b> ${esc(invoice.paymentTerms)}` : ''}</td><th>TOTAL</th><td>${euros(invoiceTotal(invoice))}</td></tr>
    </table>
    <footer class="inv-foot">
      <div class="inv-contact"><b>Contacto:</b>${issuer.email ? `<div>${esc(issuer.email)}</div>` : ''}${issuer.phone ? `<div>Tlf: ${esc(issuer.phone)}</div>` : ''}</div>
      <div class="inv-banks">${banks.length ? `<b>Datos Bancarios:</b>${banks.map((b) => `<div>${esc(b)}</div>`).join('')}` : ''}</div>
      ${issuer.registry ? `<p class="inv-registry">${esc(issuer.registry)}</p>` : ''}
    </footer>`;
}

function payrollSheet(payroll) {
  const person = payroll.person;
  const style = payroll.userId === state.session.user.id ? payrollStyle() : DEFAULT_PAYROLL_STYLE;
  const schedule = esc(payroll.schedule || '11+1');
  const extraHours = payrollExtraHours(payroll);
  const euros = (value) => `${money(value, { decimals: false })}€`;
  const info = (label, value) => (value ? `<div><u><b>${label}</b></u>: ${esc(value)}</div>` : '');
  const title = [payroll.projectName || 'Sin proyecto', payroll.production].filter(Boolean).map(esc).join(' x ');
  return `<div class="pay-sheet" data-pay-head="${esc(style.headerColor)}" data-pay-table="${esc(style.tableColor)}">
    <table class="pay-head">
      <tr><th colspan="2">${esc(style.title)} // ${title}</th></tr>
      <tr><td colspan="2"><b>Fecha de rodaje ${longDate(payroll.shootDate)}</b></td></tr>
      <tr><td>${info('Nombre', person.name)}${info('Apellidos', person.surname)}${info('Cargo', person.role)}${info('DNI', person.taxId)}</td>
        <td>${info('Email', person.email)}${info('Tel', person.phone)}${info('Nº Cuenta', person.iban)}</td></tr>
    </table>
    <table class="pay-table">
      <thead><tr><th>Jornadas (${schedule})</th><th>Tarifa jornada</th><th>Cantidad total</th></tr></thead>
      <tbody>
        <tr><td>Shooting Days <b>x ${money(payroll.days, { decimals: false })}</b></td><td>${euros(payroll.dayRate)}</td><td>${euros(payroll.days * payroll.dayRate)}</td></tr>
        ${extraHours ? `<tr><td>Horas Extra (${schedule}) <b>x ${hoursText(extraHours)}</b></td><td>${euros(payroll.extraRate)}</td><td>${euros(extraHours * payroll.extraRate)}</td></tr>` : ''}
        ${payroll.irpf ? `<tr><td colspan="3"><b>Retención IRPF ${money(payroll.irpf, { decimals: false })}%</b></td></tr>` : ''}
        <tr><td colspan="2"><b>TOTAL BRUTO EN NÓMINA</b></td><td>${euros(payrollTotal(payroll))}</td></tr>
      </tbody>
    </table>
    ${payroll.extras.length ? `<table class="pay-table">
      <thead><tr><th colspan="3">HORAS EXTRAS</th></tr><tr><th>Día</th><th>Horario</th><th>Extra</th></tr></thead>
      <tbody>${payroll.extras.map((extra) => `<tr><td><b>${longDate(extra.day)}</b></td><td>${esc(extra.schedule)}</td><td>${hoursText(extra.hours)}h</td></tr>`).join('')}</tbody>
    </table>` : ''}
    ${style.signature ? `<img class="pay-signature" src="${style.signature}" alt="Firma">` : ''}
    <footer class="pay-foot">
      <div>${esc([person.name, person.surname].filter(Boolean).join(' '))}</div>
      ${person.role ? `<div>${esc(person.role)}${person.taxId ? ` · ${esc(person.taxId)}` : ''}</div>` : ''}
      <div>${esc(person.email)}</div><div>${esc(person.phone)}</div>
      ${style.logo ? `<img class="pay-logo" src="${style.logo}" alt="Logo">` : ''}
    </footer>
  </div>`;
}
