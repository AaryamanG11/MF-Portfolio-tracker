// ---------------------------------
// Helpers
// ---------------------------------

// Normalize many date formats to YYYY-MM-DD (Postgres-friendly)
function normalizeDateString(s) {
  if (!s) return null;
  const str = String(s).trim();

  // already ISO: 2025-08-10
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD-MM-YYYY or DD/MM/YYYY
  let m = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }

  // DD-Mon-YYYY (e.g., 29-May-2008)
  m = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    // DD-Mon-YYYY (e.g., 29-May-2008)
m = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
if (m) {
  const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
                   Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  const [, dd, mon, yyyy] = m;
  const mm = months[mon.slice(0,3)];
  if (mm) return `${yyyy}-${mm}-${dd}`;
}

  // Fallback: return original
  return str;
}}

// Get visible text of selected <option>
function getSelectedText(sel) {
  const opt = sel && sel.options ? sel.options[sel.selectedIndex] : null;
  return opt ? opt.text : '';
}

function capitalizeEachWord(str) {
  if (!str) return '';
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// ---------------------------------
// UI status helper (Bootstrap alerts)
// ---------------------------------
function uiStatus(msg, type = 'info') {
  // type: 'info' | 'success' | 'danger' | 'warning'
  const el = document.getElementById('statusArea');
  if (!el) return console.log(`[${type}] ${msg}`);
  el.innerHTML = `<div class="alert alert-${type} mb-0" role="alert">${msg}</div>`;
}

// Secondary status helper for the second card/table
function uiStatus2(msg, type = 'info') {
  const el = document.getElementById('statusArea2');
  if (!el) return console.log(`[${type}] ${msg}`);
  el.innerHTML = `<div class="alert alert-${type} mb-0" role="alert">${msg}</div>`;
}

// ---------------------------------
// Wrap long tick labels for Plotly
// ---------------------------------
function wrapTick(label, maxPerLine = 12) {
  if (!label) return '';
  const words = String(label).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length <= maxPerLine) {
      line = (line ? line + ' ' : '') + w;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.join('<br>');
}

// ---------------------------------
// Apply universal legend behavior + persist selections
// ---------------------------------
function applyLegendDefaults(layout, uirev = 'mf-default') {
  const merged = Object.assign({}, layout);
  merged.legend = Object.assign({
    itemclick: 'toggleothers',   // solo the clicked trace
    itemdoubleclick: false,      // no double-click override
    groupclick: 'toggleitem'     // click group title toggles items, not whole group
  }, layout.legend || {});
  merged.uirevision = uirev;     // keep legend state on replot
  return merged;
}


// ---------------------------------
// Select2 + MFAPI list
// ---------------------------------

$(document).ready(function () {
  let allFunds = null;

  function initFundSelect(selector, width = '40%') {
    const $el = $(selector);
    if (!$el.length) return; // element not on this page

    $el.select2({
      placeholder: "Search Mutual Fund (India)",
      allowClear: true,
      minimumInputLength: 2,
      width: width,
      ajax: {
        transport: function (params, success, failure) {
          if (allFunds) { success(allFunds); return; }
          fetch('https://api.mfapi.in/mf')
            .then(r => r.json())
            .then(data => { allFunds = data; success(data); })
            .catch(failure);
        },
        processResults: function (data, params) {
          const term = (params.term || '').toLowerCase();
          const filtered = data.filter(f => f.schemeName && f.schemeName.toLowerCase().includes(term));
          return {
            results: filtered.map(f => ({ id: String(f.schemeCode), text: f.schemeName }))
          };
        },
        delay: 250
      }
    });
  }

  // Initialize both dropdowns if present on the page
  initFundSelect('#mfDropdown', '40%');
  initFundSelect('#sipMfDropdown', '40%');

  // ✅ Initialize holder name dropdowns (Select2)
  $('#holderName, #sipHolderName').select2({
    placeholder: 'Select Holder',
    allowClear: true,
    width: '20%'
  });
});


// ---------------------------------
// Supabase init
// ---------------------------------

const SUPABASE_URL = 'https://sipdpipypzytffciqfvq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpcGRwaXB5cHp5dGZmY2lxZnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NDQ5MTAsImV4cCI6MjA3MDQyMDkxMH0.ruip7VfwgPhG4saY2U_5J-CtQJSl3I4_qelHZxTp44I';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('Supabase client initialised:', !!sb);


// ---------------------------------
// Refresh current NAVs for all rows
// ---------------------------------
async function refreshAllNAVs() {
  console.log('[NAV] Refreshing NAVs for all entries…');

  // 1) Load rows to update
  const { data: rows, error: fetchErr } = await sb
    .from('portfolio')
    .select('id, scheme_code, units');

  if (fetchErr) {
    console.error('[NAV] Failed loading portfolio rows:', fetchErr);
    throw new Error(fetchErr.message || 'Failed to load portfolio');
  }
  if (!rows || rows.length === 0) {
    console.log('[NAV] No rows to update.');
    return;
  }

  // 2) Fetch latest NAV once per scheme_code
  const uniqueCodes = [...new Set(rows.map(r => String(r.scheme_code)))];
  const navCache = {}; // scheme_code -> { nav:Number, date:String }

  for (const code of uniqueCodes) {
    try {
      const res = await fetch(`https://api.mfapi.in/mf/${code}`);
      const json = await res.json();
      const latest = json && json.data && json.data[0];
      if (latest && latest.nav) {
        const nav = parseFloat(latest.nav);
        const date = normalizeDateString(latest.date);
        navCache[code] = { nav: isFinite(nav) ? nav : null, date };
      } else {
        navCache[code] = { nav: null, date: null };
      }
    } catch (e) {
      console.warn('[NAV] Fetch failed for', code, e);
      navCache[code] = { nav: null, date: null };
    }
  }

  // 3) Build updates per row
  const updates = rows.map(r => {
    const n = navCache[String(r.scheme_code)] || { nav: null, date: null };
    const current_nav = n.nav;
    const nav_date = n.date;
    const current_value = (current_nav != null && isFinite(current_nav)) ? current_nav * Number(r.units) : null;
    return { id: r.id, current_nav, nav_date, current_value };
  });

  // 4) Update each row individually (avoid accidental inserts)
  for (const u of updates) {
    const { error: updErr } = await sb
      .from('portfolio')
      .update({
        current_nav: u.current_nav,
        nav_date: u.nav_date,
        current_value: u.current_value
      })
      .eq('id', u.id);
    if (updErr) {
      console.error('[NAV] Update failed for id', u.id, updErr);
      throw new Error(updErr.message || `Failed updating NAV for id ${u.id}`);
    }
  }

  console.log('[NAV] Refreshed NAVs for', updates.length, 'rows.');
}


// ---------------------------------
// Add Entry: fetch NAV, calc values, insert
// ---------------------------------

async function addEntry(evt) {
  console.log('addEntry() called');
  evt && evt.preventDefault();

  const btn = document.getElementById('addEntry');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

  const holderName = capitalizeEachWord(document.getElementById('holderName').value.trim());

  try {
    const mfSelect = document.getElementById('mfDropdown');
    const schemeCode = mfSelect.value;
    const schemeName = getSelectedText(mfSelect);
    const folioNumber = document.getElementById('folioNumber').value.trim();
    const bankName = document.getElementById('bankName').value.trim();
    const nomineeName = document.getElementById('nomineeName').value.trim();
    const transactionType = document.getElementById('transactionType').value;
    const unitsRaw = document.getElementById('unitsBought').value;
    const buyValueRaw = document.getElementById('buyingValue').value;
    const tradeDateRaw = document.getElementById('transactionDate').value;
    const investmentApp = document.getElementById('investmentApp').value;

    // Basic validation
    if (!holderName) throw new Error('Please enter holder name.');
    if (!schemeCode) throw new Error('Please select a mutual fund.');
    if (!transactionType || !['buy', 'sell', 'BUY', 'SELL'].includes(transactionType)) {
      throw new Error('Please choose BUY or SELL.');
    }
    if (!investmentApp || !['direct', 'amit', 'rkb', 'fisdom'].includes(investmentApp)) {
      throw new Error('Please choose where you invested from.');
    }
    if (!unitsRaw) throw new Error('Please enter units.');
    if (!buyValueRaw) throw new Error('Please enter buying value.');
    if (!tradeDateRaw) throw new Error('Please select the trade date.');

    let units = parseFloat(unitsRaw); const buyValue = parseFloat(buyValueRaw);
    if (!isFinite(units) || units < 0) throw new Error('Units must be a non-negative number.');
    if (!isFinite(buyValue) || buyValue < 0) throw new Error('Buying value must be a non-negative number.');

    // Change units based on transaction type
    if (transactionType.toLowerCase() === 'sell') {
      units = -Math.abs(units)
    }

    // Normalize trade date to YYYY-MM-DD
    const tradeDate = normalizeDateString(tradeDateRaw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      throw new Error('Trade date must be a valid date (YYYY-MM-DD).');
    }

    // Fetch current NAV **and** meta in one go (navData stays in scope)
    let currentNav = null;
    let navDate = null;
    let fundHouse = null;
    let fundCategory = null;
    let fundSubCategory = null;
    let navData = null;

    try {
      const navRes = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
      navData = await navRes.json();

      // latest NAV
      if (navData && navData.data && navData.data[0]) {
        currentNav = parseFloat(navData.data[0].nav);
        navDate = normalizeDateString(navData.data[0].date);
      }

      // meta -> fund house / category / sub-category
      if (navData && navData.meta) {
        const rawCat = navData.meta.scheme_category || '';
        const parts = rawCat.split(' - ');
        fundCategory = parts[0] || null;
        fundSubCategory = parts.slice(1).join(' - ') || null;
        fundHouse = navData.meta.fund_house || null;
      }
    } catch (e) {
      console.warn('NAV/meta fetch failed:', e);
    }


    // Calculated fields
    const buyPrice = buyValue / units; // price per unit
    const currentValue = (currentNav != null && isFinite(currentNav)) ? currentNav * units : null;

    // Build payload (DB column names)
    const payload = {
      holder_name: holderName,
      scheme_code: schemeCode,
      scheme_name: schemeName,
      transaction_type: transactionType.toLowerCase(),
      units: units,
      buy_price: buyPrice,
      buy_value: buyValue,
      current_value: currentValue,
      trade_date: tradeDate,
      current_nav: (currentNav != null && isFinite(currentNav)) ? currentNav : null,
      nav_date: navDate,
      fund_house: fundHouse,
      fund_category: fundCategory,
      fund_sub_category: fundSubCategory,
      investment_app: investmentApp,
      nominee_name: nomineeName || null,
      bank_name: bankName || null,
      folio_number: folioNumber || null,
      type_of_investment: 'Lump Sum'
    };

    console.log('Payload to insert:', payload);

    const { data, error } = await sb.from('portfolio').insert([payload]).select();
    if (error) {
      console.error('Supabase insert error:', error);
      throw new Error(error.message || 'Insert failed');
    }

    alert('Entry added ✅');
    uiStatus('Refreshing NAVs…', 'info');
    await refreshAllNAVs();
    uiStatus('Refreshing NAVs… done ✅', 'success');

    // Reset form fields
    $('#holderName').val(null).trigger('change'); // ✅ reset holder dropdown
    $('#mfDropdown').val(null).trigger('change'); // reset fund dropdown
    document.getElementById('transactionType').value = '';
    document.getElementById('investmentApp').value = '';
    document.getElementById('bankName').value = '';
    document.getElementById('nomineeName').value = '';
    document.getElementById('folioNumber').value = '';
    document.getElementById('unitsBought').value = '';
    document.getElementById('buyingValue').value = '';
    document.getElementById('transactionDate').value = '';
    // Put cursor back on first field for fast entry
    document.getElementById('holderName').focus();

  } catch (err) {
    console.error(err);
    alert('Failed to add entry: ' + err.message);
    uiStatus('Failed to refresh NAVs: ' + err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add Entry'; }
  }
}


// ---------------------------------
// Robustly wire up the button
// ---------------------------------

(function wireButton() {
  function tryWire() {
    const btn = document.getElementById('addEntry');
    if (!btn) return false;
    if (!btn.__wired) {
      btn.addEventListener('click', addEntry);
      btn.__wired = true;
      console.log('addEntry listener attached');
    }
    return true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryWire);
  } else {
    tryWire();
  }
  let tries = 0;
  const t = setInterval(() => {
    if (tryWire() || tries++ > 10) clearInterval(t);
  }, 150);
})();

// ----------------------------------------------------------------------------------------------------------------------------
//                                         SIP input form handling
// ----------------------------------------------------------------------------------------------------------------------------

function toISODateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Clamp to last day of month when adding months (safe local time)
function addMonthsClamp(isoDate, n) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);

  const targetMonth = start.getMonth() + n;
  const lastOfTarget = new Date(start.getFullYear(), targetMonth + 1, 0, 0, 0, 0, 0);
  const clampedDay = Math.min(start.getDate(), lastOfTarget.getDate());

  const result = new Date(start.getFullYear(), targetMonth, clampedDay, 0, 0, 0, 0);
  return toISODateLocal(result);
} 
// put this helper once above valReq / valOpt
function valReqAny(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return (el.value ?? '').trim();
  }
  throw new Error('Missing field on page: ' + ids.map(id => '#' + id).join(' or '));
}

// Safe DOM value readers (give clear errors if a required field is missing)
function valReq(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing field on page: #${id}`);
  return (el.value ?? '').trim();
}
function valOpt(id) {
  const el = document.getElementById(id);
  return el ? (el.value ?? '').trim() : '';
}

async function handleAddSipPlan(evt) {
  evt && evt.preventDefault();
  const status = document.getElementById('statusArea');
  status.textContent = 'Adding SIP plan…';

  const holder = valReq('sipHolderName');
  const mfSel = document.getElementById('sipMfDropdown');
  if (!mfSel) throw new Error('Missing field on page: #sipMfDropdown');
  const scheme_code = (mfSel.value || '').trim();
  const scheme_name = getSelectedText(mfSel);
  const sipFolioNumber = valOpt('sipFolioNumber');
  const sipBankName = valOpt('sipBankName');
  const sipNomineeName = valOpt('sipNomineeName');

  // Dates & numbers
  const startISO = valReq('sipStartDate');         // initial deduction date (lump sum)
  // Accept either the intended id or the current HTML id
  const monthlyISO = valReqAny(['sipMonthlyDate', 'sipMontlydate']);
  const monthsStr = valReq('sipMonths');
  const amountStr = valReq('sipAmountPerMonth');
  const months = parseInt(monthsStr, 10);
  const amount = parseFloat(amountStr);
  const sipInvestmentApp = valReq('sipInvestmentApp');

  // New: optional initial lump-sum/first-buy details for the start date
  const initAmountStr = valOpt('sipInitialAmount');
  const initUnitsStr = valOpt('sipInitialUnits');
  const initAmount = initAmountStr ? parseFloat(initAmountStr) : NaN;
  const initUnits = initUnitsStr ? parseFloat(initUnitsStr) : NaN;

  // ---- Basic validation
  if (!monthsStr || !amountStr || !monthlyISO) {
    status.textContent = 'Please enter monthly date, months, and monthly amount.';
    return;
  }
  if (!scheme_code || !scheme_name) {
    status.textContent = 'Please select a mutual fund.';
    return;
  }
  if (!monthsStr || !amountStr) {
    status.textContent = 'Please enter months and monthly amount.';
    return;
  }
  if (months <= 0 || !Number.isFinite(months)) {
    status.textContent = 'Months must be a positive number.';
    return;
  }
  if (amount <= 0 || !Number.isFinite(amount)) {
    status.textContent = 'Amount must be a positive number.';
    return;
  }
  if (!['direct', 'amit', 'rkb', 'fisdom'].includes(sipInvestmentApp)) {
    status.textContent = 'Please choose where you invested from.';
    return;
  }

  // ---- Fund meta (house/category/sub-category)
  let fund_house = null, fund_category = null, fund_sub_category = null;
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${scheme_code}`);
    const json = await res.json();
    const meta = json?.meta || {};
    const rawCat = meta.scheme_category || '';
    const parts = rawCat.split(' - ');
    fund_house = meta.fund_house || null;
    fund_category = parts[0] || null;
    fund_sub_category = parts.slice(1).join(' - ') || null;
  } catch (e) {
    console.warn('[SIP] Could not fetch fund meta for code', scheme_code, e);
  }

  try {
    // 1) If initial details provided, insert an initial BUY into portfolio on startISO
    //    (only if BOTH amount and units are valid numbers)
    if (Number.isFinite(initAmount) && initAmount > 0 && Number.isFinite(initUnits) && initUnits > 0) {
      // Fetch latest NAV just to seed current value (your refreshAllNAVs will update later anyway)
      let current_nav = null, nav_date = null;
      try {
        const navRes = await fetch(`https://api.mfapi.in/mf/${scheme_code}`);
        const navJson = await navRes.json();
        if (navJson?.data?.[0]) {
          current_nav = parseFloat(navJson.data[0].nav);
          nav_date = normalizeDateString(navJson.data[0].date);
        }
      } catch (e) {
        console.warn('[SIP] Initial NAV seed fetch failed:', e);
      }

      const initialPayload = {
        holder_name: holder,
        scheme_code,
        scheme_name,
        transaction_type: 'buy',
        is_sip: true,
        units: initUnits,
        buy_price: initAmount / initUnits,
        buy_value: initAmount,
        current_nav: Number.isFinite(current_nav) ? current_nav : null,
        current_value: (Number.isFinite(current_nav) ? current_nav * initUnits : null),
        nav_date: nav_date,
        trade_date: startISO,
        fund_house,
        fund_category,
        fund_sub_category,
        investment_app: sipInvestmentApp,
        nominee_name: sipNomineeName || null,
        bank_name: sipBankName || null,
        folio_number: sipFolioNumber || null,
        first_sip_date: startISO,
        last_sip_date: startISO
      };

      const { error: initErr } = await sb.from('portfolio').insert([initialPayload]);
      if (initErr) throw initErr;
    }

    // 2) Build & insert SIP queue rows starting from monthlyISO for N months
    const rows = [];
    for (let i = 0; i < months; i++) {
      rows.push({
        holder_name: holder,
        scheme_code,
        scheme_name,
        scheduled_for: addMonthsClamp(monthlyISO, i),
        monthly_amount: amount,
        investment_app: sipInvestmentApp,
        fund_house,
        fund_category,
        fund_sub_category,
        nominee_name: sipNomineeName || null,
        bank_name: sipBankName || null,
        folio_number: sipFolioNumber || null
      });
    }

    const { data, error } = await sb.from('sip_queue').insert(rows).select('id, scheduled_for');
    if (error) throw error;

    status.textContent = `SIP plan added: ${data.length} month(s) scheduled.` + (Number.isFinite(initAmount) && Number.isFinite(initUnits) && initAmount > 0 && initUnits > 0 ? ' Initial purchase recorded.' : '');
    // Reset fields
    $('#sipHolderName').val(null).trigger('change');
    $('#sipMfDropdown').val(null).trigger('change');
    document.getElementById('sipStartDate').value = '';
    if (document.getElementById('sipMonthlyDate')) document.getElementById('sipMonthlyDate').value = '';
    if (document.getElementById('sipMontlydate')) document.getElementById('sipMontlydate').value = '';
    document.getElementById('sipMonths').value = '';
    document.getElementById('sipAmountPerMonth').value = '';
    document.getElementById('sipInvestmentApp').value = '';
    document.getElementById('sipBankName').value = '';
    document.getElementById('sipNomineeName').value = '';
    document.getElementById('sipFolioNumber').value = '';
    if (document.getElementById('sipInitialAmount')) document.getElementById('sipInitialAmount').value = '';
    if (document.getElementById('sipInitialUnits')) document.getElementById('sipInitialUnits').value = '';
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    status.textContent = msg.startsWith('Missing field on page')
      ? msg + '. Please open the SIP form page and try again.'
      : 'Failed to add SIP plan: ' + msg;
  }
}

// Wire button
(function wireSipBtn() {
  function tryWire() {
    const btn = document.getElementById('addSipPlan');
    if (!btn) return false;
    if (!btn.__wired) {
      btn.addEventListener('click', handleAddSipPlan);
      btn.__wired = true;
      console.log('addSipPlan listener attached');
    }
    return true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryWire);
  } else {
    tryWire();
  }
})();

// ----------------------------------------------------------------------------------------------------------------------------

//                                    Graphs for Portfolio page

// -----------------------------------------------------------------------------------------------------------------------------

function showChartContainer(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn('Chart container not found:', id);
    uiStatus('Chart container not found: ' + id, 'danger');
    return false;
  }
  el.style.display = 'block';
  return true;
}

async function backfillFundMeta() {
  uiStatus('Backfilling fund categories…', 'info');

  const { data: rows, error } = await sb
    .from('portfolio')
    .select('id, scheme_code');

  if (error) { uiStatus('Failed to load rows', 'danger'); throw error; }
  if (!rows?.length) { uiStatus('No rows to backfill.', 'warning'); return; }

  const codes = [...new Set(rows.map(r => String(r.scheme_code)))];
  const metaByCode = {};

  // fetch meta once per scheme
  for (const code of codes) {
    try {
      const res = await fetch(`https://api.mfapi.in/mf/${code}`);
      const json = await res.json();
      const meta = json?.meta || {};
      const rawCat = meta.scheme_category || '';
      const parts = rawCat.split(' - ');
      metaByCode[code] = {
        fund_house: meta.fund_house || null,
        fund_category: parts[0] || null,
        fund_sub_category: parts.slice(1).join(' - ') || null
      };
    } catch (e) {
      console.warn('Meta fetch failed for', code, e);
      metaByCode[code] = { fund_house: null, fund_category: null, fund_sub_category: null };
    }
  }

  // update each existing row
  for (const r of rows) {
    const m = metaByCode[String(r.scheme_code)] || {};
    const { error: updErr } = await sb
      .from('portfolio')
      .update({
        fund_house: m.fund_house,
        fund_category: m.fund_category,
        fund_sub_category: m.fund_sub_category
      })
      .eq('id', r.id);

    if (updErr) { uiStatus('Backfill failed on a row', 'danger'); throw updErr; }
  }

  uiStatus('Backfill complete ✅', 'success');
}

async function drawholdingsbyName() {
  refreshAllNAVs(); // async, don't await
  if (!showChartContainer('MF_chart')) return;
  uiStatus('Loading chart…', 'info');

  // Query the VIEW that already sums per holder
  const { data, error } = await sb
    .from('portfolio_by_holder')
    .select('holder_name, total_current_value')
    .order('holder_name', { ascending: true })

  if (error) {
    console.error('Error fetching aggregated data for chart:', error);
    uiStatus('Failed to load chart data', 'danger');
    return;
  }

  const holderNames = data.map(r => r.holder_name || 'Unknown');
  const currentValues = data.map(r => Number(r.total_current_value) || 0);

  const trace = {
    x: holderNames,
    y: currentValues,
    type: 'bar',
    text: currentValues.map(v => `₹${Math.round(v / 1000).toLocaleString('en-IN')}k`), // value labels in thousands
    textposition: 'auto', // places labels automatically (usually on top)
    marker: { color: 'rgb(66, 135, 245)' }
  };

  const layout = {
    title: 'Total Current Value by Holder',
    xaxis: { title: 'Holder' },
    yaxis: { title: 'Current Value (₹)' },
    margin: { t: 60 }
  };

  if (!document.getElementById('MF_chart')) {
    console.error('Missing chart div: #MF_chart');
    uiStatus('Missing chart div: #MF_chart', 'danger');
    return;
  }

  Plotly.newPlot('MF_chart', [trace], applyLegendDefaults(layout, 'holdings-by-name'));
  uiStatus('Chart updated ✅', 'success');
}


async function drawFundGroupByHolderStacked(asPercent = false) {
  refreshAllNAVs(); // async, don't await
  if (!showChartContainer('MF_chart')) return;

  uiStatus(asPercent ? 'Loading MF group % by holder…' : 'Loading MF group value by holder…', 'info');

  const { data, error } = await sb
    .from('portfolio')
    .select('fund_house, holder_name, current_value');

  if (error) {
    console.error('Chart query error:', error);
    uiStatus('Failed to load chart data', 'danger');
    return;
  }

  // Aggregate
  const sums = {};
  const totalsByGroup = {};
  const groupsSet = new Set();
  const holdersSet = new Set();

  for (const row of data) {
    const group = row.fund_house || 'Unknown';
    const holder = row.holder_name || 'Unknown';
    const val = Number(row.current_value) || 0;

    groupsSet.add(group);
    holdersSet.add(holder);

    if (!sums[group]) sums[group] = {};
    sums[group][holder] = (sums[group][holder] || 0) + val;

    totalsByGroup[group] = (totalsByGroup[group] || 0) + val;
  }

  const groups = Array.from(groupsSet);
  const groupTickText = groups.map(g => wrapTick(g, 12));
  const holders = Array.from(holdersSet);

  // Build traces
  const traces = holders.map(holder => {
    const yVals = groups.map(g => (sums[g] && sums[g][holder]) ? sums[g][holder] : 0);
    const percentVals = groups.map(g => {
      const total = totalsByGroup[g] || 0;
      return total ? ((sums[g][holder] || 0) / total * 100) : 0;
    });

    return {
      name: holder,
      x: groups,
      y: asPercent ? percentVals : yVals,
      type: 'bar',
      text: asPercent
        ? percentVals.map(p => `${p.toFixed(1)}%`)
        : yVals.map((v, idx) => `₹${Math.round(v / 1000).toLocaleString('en-IN')}k (${percentVals[idx].toFixed(1)}%)`),
      textposition: 'auto',
      hovertemplate: asPercent
        ? `${holder}<br>% of group: %{y:.2f}%<extra>${holder}</extra>`
        : `${holder}<br>Value: ₹%{y:,.0f}<br>% of group: ${percentVals.map(p => p.toFixed(1)).join('% / ')}%<extra>${holder}</extra>`
    };
  });

  // Layout
  const layout = {
    title: asPercent ? 'Value by MF Group (Stacked by Holder, %)' : 'Value by MF Group (Stacked by Holder, ₹ + %)',
    xaxis: { title: 'MF Group', tickangle: 0, automargin: true, tickmode: 'array', tickvals: groups, ticktext: groupTickText },
    yaxis: asPercent
      ? { title: 'Share of Group (%)', rangemode: 'tozero' }
      : { title: 'Value (₹)', rangemode: 'tozero' },
    barmode: 'stack',
    barnorm: asPercent ? 'percent' : undefined,
    margin: { t: 60, r: 20, b: 140 }
  };

  if (!document.getElementById('MF_chart')) {
    console.error('Missing chart div: #MF_chart');
    uiStatus('Missing chart div: #MF_chart', 'danger');
    return;
  }

  Plotly.newPlot('MF_chart', traces, applyLegendDefaults(layout, 'group-by-house-stacked'));
  uiStatus('Chart updated ✅', 'success');
}


// ------------------------------------------------------------
// Fund House legend grouped under each Holder (collapsible)
// Each legend group = Holder; items inside = Fund Houses
// Bar X-axis = Fund Houses; stacks show contributions by Holder→House
// ------------------------------------------------------------
async function drawFundGroupByHolderAndHouse(asPercent = false) {
  refreshAllNAVs(); // async, don't await
  if (!showChartContainer('MF_chart')) return;
  uiStatus(asPercent
    ? 'Loading MF sub-category % by Holder → Fund House…'
    : 'Loading MF sub-category value by Holder → Fund House…', 'info');

  // Pull required fields (note: include fund_sub_category)
  const { data, error } = await sb
    .from('portfolio')
    .select('fund_sub_category, fund_house, holder_name, current_value');

  if (error) {
    console.error('Chart query error:', error);
    uiStatus('Failed to load chart data', 'danger');
    return;
  }

  // Aggregate: sums[holder][house][sub] = total value
  const sums = {};
  const totalsBySub = {}; // for percent labels per sub-category
  const subsSet = new Set();
  const holdersSet = new Set();
  const housesByHolder = {}; // holder -> Set(house)

  for (const row of (data || [])) {
    const sub = row.fund_sub_category || 'Uncategorized';
    const house = row.fund_house || 'Unknown';
    const holder = row.holder_name || 'Unknown';
    const val = Number(row.current_value) || 0;

    subsSet.add(sub);
    holdersSet.add(holder);
    if (!housesByHolder[holder]) housesByHolder[holder] = new Set();
    housesByHolder[holder].add(house);

    if (!sums[holder]) sums[holder] = {};
    if (!sums[holder][house]) sums[holder][house] = {};
    sums[holder][house][sub] = (sums[holder][house][sub] || 0) + val;

    totalsBySub[sub] = (totalsBySub[sub] || 0) + val;
  }

  const subs = Array.from(subsSet);
  const subTickText = subs.map(s => wrapTick(s, 16));
  const holders = Array.from(holdersSet);

  const traces = [];
  const seenGroup = new Set(); // ensure legendgrouptitle added once per holder

  for (const holder of holders) {
    const houses = Array.from(housesByHolder[holder] || []);
    for (const house of houses) {
      const yVals = subs.map(sub => (sums[holder]?.[house]?.[sub]) ? sums[holder][house][sub] : 0);
      const percents = subs.map((sub, i) => {
        const total = totalsBySub[sub] || 0;
        const v = yVals[i] || 0;
        return total ? (v / total) * 100 : 0;
      });

      traces.push({
        name: house,                 // legend item under the Holder group
        legendgroup: holder,         // collapsible group title = holder
        ...(seenGroup.has(holder) ? {} : { legendgrouptitle: { text: holder } }),
        x: subs,
        y: yVals,                    // always raw; barnorm handles % if enabled
        type: 'bar',
        text: asPercent
          ? percents.map(p => `${p.toFixed(1)}%`)
          : yVals.map((v, i) => v ? `₹${Math.round(v / 1000).toLocaleString('en-IN')}k (${percents[i].toFixed(1)}%)` : ''),
        textposition: 'auto',
        customdata: percents,        // for hover % readout in ₹ mode
        hovertemplate: asPercent
          ? `${holder} → ${house}<br>% of sub-category: %{customdata:.2f}%<extra>${holder}</extra>`
          : `${holder} → ${house}<br>Value: ₹%{y:,.0f}<br>% of sub-category: %{customdata:.2f}%<extra>${holder}</extra>`
      });
    }
    seenGroup.add(holder);
  }

  const layout = {
    title: asPercent
      ? 'Value by MF Sub-Category (Holder → Fund House, %)'
      : 'Value by MF Sub-Category (Holder → Fund House, ₹ + %)',
    xaxis: { title: 'MF Sub-Category', tickangle: 0, automargin: true, tickmode: 'array', tickvals: subs, ticktext: subTickText },
    yaxis: asPercent
      ? { title: 'Share of Sub-Category (%)', rangemode: 'tozero' }
      : { title: 'Value (₹)', rangemode: 'tozero' },
    barmode: 'stack',
    barnorm: asPercent ? 'percent' : undefined,
    margin: { t: 60, r: 20, b: 140 },
    legend: {
      itemclick: 'toggleothers',      // click on a legend item isolates that item
      itemdoubleclick: false,         // disable default double-click behavior
      groupclick: 'toggleitem'        // clicking group title toggles items, not entire group
    },
    uirevision: 'mf-subcat-v1'        // preserve legend selection across re-plots
  };

  if (!document.getElementById('MF_chart')) {
    console.error('Missing chart div: #MF_chart');
    uiStatus('Missing chart div: #MF_chart', 'danger');
    return;
  }

  Plotly.newPlot('MF_chart', traces, applyLegendDefaults(layout, 'subcat-holder-house'));
  uiStatus('Chart updated ✅', 'success');
}

// ==========================================================
// PERFORMANCE TABLE (Plotly.js)
// Fetch rows from Supabase and compute time-window P/L by
// fetching historical NAVs on-the-fly from mfapi.in (no extra DB)
// Renders a Plotly 'table' with the SAME HEADERS you requested
// ==========================================================

// Measure text width in pixels (approximate)
function measureTextPx(text, font = '11px Arial') {
  const canvas = measureTextPx._c || (measureTextPx._c = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(String(text)).width;
}

// Compute Plotly table column widths based on content and SCALE to fit container
function computeTableColumnWidths(headers, columns, containerId) {
  const container = document.getElementById(containerId);
  const available = Math.max(320, (container ? container.clientWidth : 1000) - 24); // px we can use

  // Reasonable, tighter bounds so it can fit without scrolling
  const minW = 90;
  const maxW = 360;
  const pad = 24;
  const scaleUp = 1.15;

  // Measure widest content in each column
  const raw = headers.map((h, i) => {
    const hWidth = measureTextPx(String(h).replace(/<[^>]*>/g, ''), '12px Arial') * scaleUp;
    let maxCell = 0;
    const col = columns[i] || [];
    for (const v of col) {
      const w = measureTextPx(v, '11px Arial') * scaleUp;
      if (w > maxCell) maxCell = w;
    }
    return Math.min(maxW, Math.max(minW, Math.ceil(Math.max(hWidth, maxCell) + pad)));
  });

  // If total > available, scale all columns down proportionally
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= available) return raw;

  const scale = available / total;
  const minClamp = Math.floor(minW * 0.7); // don't get too tiny
  return raw.map(w => Math.max(minClamp, Math.floor(w * scale)));
}

// Helper: parse dd-mm-yyyy -> Date (local)
function parseDMY(dmy) {
  if (!dmy) return null;
  const [dd, mm, yyyy] = String(dmy).split('-').map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, (mm - 1), dd);
}

// Helper: parse ISO yyyy-mm-dd -> Date (local)
function parseISODate(iso) {
  if (!iso) return null;
  const [yyyy, mm, dd] = String(iso).split('-').map(Number);
  if (!yyyy || !mm || !dd) return null;
  return new Date(yyyy, (mm - 1), dd);
}

// Helper: find NAV (number) on or before target date from mfapi history array
// mfHistory: [{date: '14-08-2025', nav: '123.45'}, ...] in DESC order per API
function navOnOrBefore(mfHistory, targetDate) {
  if (!mfHistory || !mfHistory.length || !targetDate) return null;
  for (const row of mfHistory) {
    const d = parseDMY(row.date);
    if (d && d <= targetDate) return Number(row.nav);
  }
  return null;
}

// Compute target dates X months/years back from today
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}
function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Indian-format helper with thousands "k"
function fmtINRk(v) {
  const n = Number(v) || 0;
  return `₹${Math.round(n / 1000).toLocaleString('en-IN')}k`;
}

// Full INR with Indian commas, not rounded (2 decimals)
function fmtINRfull(v) {
  const n = Number(v);
  if (!isFinite(n)) return '-';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format a number as a signed percentage with two decimals
function formatSignedPct(x) {
  if (x == null || !isFinite(x)) return null;
  const v = Number(x);
  const sign = v > 0 ? '+' : (v < 0 ? '' : ''); // toFixed includes '-' automatically for negatives
  return `${sign}${v.toFixed(2)}%`;
}

async function drawPerformanceTable() {
  refreshAllNAVs(); // async, don't await
  uiStatus('Loading performance table…', 'info');

  // 1) Get portfolio rows (one row per transaction)
  const { data: rows, error } = await sb
    .from('portfolio')
    .select('scheme_name, scheme_code, units, buy_price, buy_value, current_nav, current_value, trade_date')
    .order('scheme_name');

  if (error) {
    console.error('Portfolio fetch failed', error);
    uiStatus('Failed to load portfolio', 'danger');
    return;
  }

  // 2) Fetch NAV history once per unique scheme_code
  const codes = [...new Set((rows || []).map(r => String(r.scheme_code)).filter(Boolean))];
  const historyByCode = {};
  for (const code of codes) {
    try {
      const res = await fetch(`https://api.mfapi.in/mf/${code}`);
      const json = await res.json();
      historyByCode[code] = Array.isArray(json?.data) ? json.data : [];
    } catch (e) {
      console.warn('History fetch failed for', code, e);
      historyByCode[code] = [];
    }
  }

  // 3) Precompute target dates
  const targets = {
    '1w': daysAgo(7),
    '2w': daysAgo(14),
    '1m': monthsAgo(1),
    '3m': monthsAgo(3),
    '6m': monthsAgo(6),
    '1y': yearsAgo(1),
    '3y': yearsAgo(3),
    '5y': yearsAgo(5),
    '7y': yearsAgo(7)
  };

  // 4) Build column arrays for Plotly table (expanded columns)
  const fundNames = [];
  const curPriceArr = [];
  const pl1wArr = [];
  const pl2wArr = [];
  const pl1mArr = [];
  const pl3mArr = [];
  const pl6mArr = [];
  const pl1yArr = [];
  const pl3yArr = [];
  const pl5yArr = [];
  const pl7yArr = [];

  // Build a unique map of funds by scheme_code so each fund appears once
  const uniq = new Map();
  for (const r of (rows || [])) {
    const code = String(r.scheme_code || '');
    if (!code) continue;
    if (!uniq.has(code)) {
      uniq.set(code, {
        scheme_code: code,
        scheme_name: r.scheme_name || '',
        current_nav: (r.current_nav != null && isFinite(Number(r.current_nav))) ? Number(r.current_nav) : null
      });
    } else {
      const obj = uniq.get(code);
      // Prefer any non-null name/nav we encounter
      if (!obj.scheme_name && r.scheme_name) obj.scheme_name = r.scheme_name;
      const navNum = (r.current_nav != null && isFinite(Number(r.current_nav))) ? Number(r.current_nav) : null;
      if (obj.current_nav == null && navNum != null) obj.current_nav = navNum;
    }
  }

  // Now iterate unique funds only
  for (const fund of uniq.values()) {
    const code = fund.scheme_code;
    const name = fund.scheme_name || '';
    const hist = historyByCode[code] || [];

    // Prefer the LATEST NAV from MFAPI as “current”
    let curNav = (fund.current_nav != null) ? Number(fund.current_nav) : null;
    if (hist && hist.length && isFinite(Number(hist[0].nav))) {
      curNav = Number(hist[0].nav);
    }
    if (!isFinite(curNav)) curNav = 0;

    // NAVs on/before target dates
    const nav1w = navOnOrBefore(hist, targets['1w']);
    const nav2w = navOnOrBefore(hist, targets['2w']);
    const nav1m = navOnOrBefore(hist, targets['1m']);
    const nav3m = navOnOrBefore(hist, targets['3m']);
    const nav6m = navOnOrBefore(hist, targets['6m']);
    const nav1y = navOnOrBefore(hist, targets['1y']);
    const nav3y = navOnOrBefore(hist, targets['3y']);
    const nav5y = navOnOrBefore(hist, targets['5y']);
    const nav7y = navOnOrBefore(hist, targets['7y']);

    // Rolling % change based on NAV only
    const pct1w = nav1w ? ((curNav - nav1w) / nav1w) * 100 : null;
    const pct2w = nav2w ? ((curNav - nav2w) / nav2w) * 100 : null;
    const pct1m = nav1m ? ((curNav - nav1m) / nav1m) * 100 : null;
    const pct3m = nav3m ? ((curNav - nav3m) / nav3m) * 100 : null;
    const pct6m = nav6m ? ((curNav - nav6m) / nav6m) * 100 : null;
    const pct1y = nav1y ? ((curNav - nav1y) / nav1y) * 100 : null;
    const pct3y = nav3y ? ((curNav - nav3y) / nav3y) * 100 : null;
    const pct5y = nav5y ? ((curNav - nav5y) / nav5y) * 100 : null;
    const pct7y = nav7y ? ((curNav - nav7y) / nav7y) * 100 : null;

    fundNames.push(name);
    curPriceArr.push(isFinite(curNav) ? `₹${curNav.toFixed(2)}` : '');

    pl1wArr.push(pct1w == null ? '-' : formatSignedPct(pct1w));
    pl2wArr.push(pct2w == null ? '-' : formatSignedPct(pct2w));
    pl1mArr.push(pct1m == null ? '-' : formatSignedPct(pct1m));
    pl3mArr.push(pct3m == null ? '-' : formatSignedPct(pct3m));
    pl6mArr.push(pct6m == null ? '-' : formatSignedPct(pct6m));
    pl1yArr.push(pct1y == null ? '-' : formatSignedPct(pct1y));
    pl3yArr.push(pct3y == null ? '-' : formatSignedPct(pct3y));
    pl5yArr.push(pct5y == null ? '-' : formatSignedPct(pct5y));
    pl7yArr.push(pct7y == null ? '-' : formatSignedPct(pct7y));
  }

  const tableTrace = {
    type: 'table',
    header: {
      values: [
        ['<b>Fund name</b>'],
        ['<b>Current NAV</b>'],
        ['1w'],
        ['2w'],
        ['1m'],
        ['3m'],
        ['6m'],
        ['1y'],
        ['3y'],
        ['5y'],
        ['7y']
      ],
      align: 'center',
      line: { width: 1, color: '#444' },
      fill: { color: '#222' },
      font: { family: 'Arial', size: 12, color: '#fff' }
    },
    cells: {
      values: [
        fundNames,
        curPriceArr,
        pl1wArr,
        pl2wArr,
        pl1mArr,
        pl3mArr,
        pl6mArr,
        pl1yArr,
        pl3yArr,
        pl5yArr,
        pl7yArr
      ],
      align: 'center',
      line: { color: '#444', width: 0.5 },
      fill: { color: [['#111', '#151515']] },
      font: { family: 'Arial', size: 11, color: '#eee' },
      height: 30
    }
  };

  const layout = applyLegendDefaults({
    margin: { t: 10, r: 10, b: 10, l: 10 }
  }, 'perf-table');

  if (!document.getElementById('performanceTableDiv')) {
    console.warn('performanceTableDiv not found');
    return;
  }

  // Build a single header label per column: prefer second level when present
  const headerCols = tableTrace.header.values; // array of columns; each column is [level1, level2]
  const headerForWidth = headerCols.map(col => (col[1] && col[1].length ? col[1] : col[0]));
  const cellColumns = tableTrace.cells.values;
  tableTrace.columnorder = headerForWidth.map((_, i) => i);
  tableTrace.columnwidth = computeTableColumnWidths(headerForWidth, cellColumns, 'performanceTableDiv');

  // Set container & layout width to sum of columns so it won't squish
  const totalColumnsPx = (tableTrace.columnwidth || []).reduce((a, b) => a + b, 0) + 120; // padding for borders
  const container = document.getElementById('performanceTableDiv');
  if (container) {
    container.style.width = totalColumnsPx + 'px';
    container.style.minWidth = totalColumnsPx + 'px';
  }
  layout.width = totalColumnsPx + 40;  // give Plotly a wide canvas

  // Dynamic height based on rows (header ~36px, each row = cells.height)
  const nRows = fundNames.length;
  const cellH = (tableTrace.cells && tableTrace.cells.height) ? tableTrace.cells.height : 30;
  const headerH = 36;
  const margins = 30;
  const desiredHeight = headerH + (nRows * cellH) + margins;

  layout.height = Math.max(140, desiredHeight);
  layout.autosize = false;  // explicit height/width

  Plotly.newPlot('performanceTableDiv', [tableTrace], layout, { responsive: true });
  uiStatus('Performance table drawn ✅', 'success');
}

// Auto-run on performance.html if the div exists
if (document.getElementById('performanceTableDiv')) {
  document.addEventListener('DOMContentLoaded', () => {
    drawPerformanceTable().catch(err => {
      console.error(err);
      uiStatus('Failed to draw performance table', 'danger');
    });
  });
}

async function drawMyPerformanceTable() {
  refreshAllNAVs(); // async, don't await
  // 1) Fetch required columns from your portfolio table
  const { data, error } = await sb
    .from('portfolio')
    .select('scheme_name, holder_name, units, buy_price, current_nav, buy_value, current_value, trade_date')
    .order('holder_name', { ascending: true })
    .order('scheme_name', { ascending: true });

  if (error) {
    console.error('Failed to load My Performance table:', error);
    return;
  }

  const rows = data || [];

  // 2) Helpers for formatting
  const fmtNum = (x) => Number(x ?? 0);
  const money = (x) => '₹' + fmtNum(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = (x) => fmtNum(x).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const px = (x) => fmtNum(x).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const date = (d) => (d ? String(d) : '');

  // 3) Build table columns (one array per column, same length)
  const col_scheme = rows.map(r => r.scheme_name || '');
  const col_holder = rows.map(r => r.holder_name || '');
  const col_units = rows.map(r => qty(r.units));
  const col_buyPx = rows.map(r => px(r.buy_price));
  const col_curNav = rows.map(r => px(r.current_nav));
  const col_buyVal = rows.map(r => money(r.buy_value));
  const col_curVal = rows.map(r => money(r.current_value));
  const col_trade = rows.map(r => date(r.trade_date));

  // 4) Per-row Profit and Profit %
  const col_profit = rows.map(r => money((Number(r.current_value) || 0) - (Number(r.buy_value) || 0)));
  const col_profitPct = rows.map(r => {
    const buy = Number(r.buy_value) || 0;
    const cur = Number(r.current_value) || 0;
    if (buy <= 0) return '-';
    const p = ((cur - buy) / buy) * 100;
    const sign = p > 0 ? '+' : (p < 0 ? '' : '');
    return `${sign}${p.toFixed(2)}%`;
  });

  // 5) Draw Plotly table into #MyperformanceTableDiv
  const tableTrace = {
    type: 'table',
    header: {
      values: [
        '<b>Scheme Name</b>',
        '<b>Holder Name</b>',
        '<b>Units</b>',
        '<b>Buy Price</b>',
        '<b>Current NAV</b>',
        '<b>Buy Value</b>',
        '<b>Current Value</b>',
        '<b>Trade Date</b>',
        '<b>Profit / Loss</b>',
        '<b>Profit / Loss %</b>'
      ],
      align: 'center',
      line: { width: 1, color: '#444' },
      fill: { color: '#222' },
      font: { family: 'Arial', size: 12, color: '#fff' }
    },
    cells: {
      values: [
        col_scheme,
        col_holder,
        col_units,
        col_buyPx,
        col_curNav,
        col_buyVal,
        col_curVal,
        col_trade,
        col_profit,
        col_profitPct
      ],
      align: 'center',
      line: { color: '#444', width: 0.5 },
      fill: { color: [['#111', '#151515']] },
      font: { family: 'Arial', size: 11, color: '#eee' },
      height: 30
    }
  };

  // Dynamic sizing like the main performance table
  const containerId = 'MyperformanceTableDiv';
  const container = document.getElementById(containerId);

  const nRows = rows.length;
  const cellH = (tableTrace.cells && tableTrace.cells.height) ? tableTrace.cells.height : 30;
  const headerH = 36; // approx header height
  const margins = 30;
  const desiredHeight = Math.max(160, headerH + (nRows * cellH) + margins);

  if (container) {
    container.style.width = '100%';
    container.style.minHeight = desiredHeight + 'px';
  }

  // Compute column widths and set canvas width like the first table
  const headersForWidth = tableTrace.header.values; // single-level headers
  const cellColumns = tableTrace.cells.values;
  tableTrace.columnorder = headersForWidth.map((_, i) => i);
  tableTrace.columnwidth = computeTableColumnWidths(headersForWidth, cellColumns, containerId);

  const totalColumnsPx = (tableTrace.columnwidth || []).reduce((a, b) => a + b, 0) + 120;

  if (container) {
    container.style.minWidth = totalColumnsPx + 'px';
  }

  const layout = { margin: { t: 16, r: 16, b: 16, l: 16 }, height: desiredHeight, width: totalColumnsPx + 40, autosize: false };

  Plotly.newPlot(containerId, [tableTrace], layout, { responsive: true });
}
// Auto-run on my_performance.html if the div exists
if (document.getElementById('MyperformanceTableDiv')) {
  document.addEventListener('DOMContentLoaded', () => {
    drawMyPerformanceTable().catch(err => {
      console.error(err);
    });
  });
}