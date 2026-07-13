// renderer.js — Link Lead Desktop v2.0.0
'use strict';

const API_BASE = 'https://mbtg3x8u.function2.insforge.app/api';
let socket = null;
let currentPage = 0;
const PAGE_SIZE = 50;

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
document.querySelectorAll('.menu-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.tab;
    document.getElementById(target).classList.add('active');
    if (target === 'prospects-tab')   { currentPage = 0; loadLeads(); }
    if (target === 'campaigns-tab')   loadCampaigns();
    if (target === 'scraper-tab')     loadStats();
    if (target === 'outreach-tab')    loadOutreachStats();
  });
});

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
const badge    = document.getElementById('console-connection-badge');
const syncText = document.getElementById('profile-sync-text');
const logsBox  = document.getElementById('logs-container');

function connectWS() {
  if (socket) return;
  socket = new WebSocket('wss://mbtg3x8u.function2.insforge.app/api');

  socket.onopen = () => {
    socket.send(JSON.stringify({ action: 'REGISTER_DESKTOP' }));
  };

  socket.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      switch (d.action) {
        case 'REGISTERED':
          setSyncUI(d.clientStatus === 'connected' ? 'connected' : 'awaiting');
          break;
        case 'CLIENT_CONNECTED':
          setSyncUI('connected');
          break;
        case 'CLIENT_DISCONNECTED':
          setSyncUI('awaiting');
          break;
        case 'SYNC_PROFILE_DATA':
          renderProfile(d.profile);
          break;
        case 'DATABASE_EVENT':
          onDatabaseEvent(d.event);
          break;

        // ── Real-time scraping progress from Extension ─────────────────────
        case 'SCRAPE_PROGRESS': {
          const { count, limit, type, latest } = d;
          const pct = limit > 0 ? Math.round((count / limit) * 100) : 0;
          showProgress(`Scraping ${type}… (${count}/${limit}) — Last: ${latest || ''}`);
          // Update the progress fill bar
          const bar = document.getElementById('scrape-fill-bar');
          if (bar) bar.style.width = `${pct}%`;
          break;
        }

        // ── A lead was captured — refresh the prospects table ──────────────
        case 'LEAD_SCRAPED':
          loadLeads();
          loadStats();
          break;

        // ── Scraping stopped (from Extension or Win App) ─────────────────
        case 'SCRAPE_STOPPED':
          hideProgress();
          loadStats();
          break;

        // ── Task completed by Extension ─────────────────────────────
        case 'TASK_COMPLETED':
          loadStats();
          loadRemoteLogs();
          break;

        // ── Safety blocked ────────────────────────────────────────
        case 'TASK_BLOCKED':
          showToast(`⚠️ Safety: ${d.reason}`);
          break;
      }
    } catch (_) {}
  };

  socket.onclose = () => {
    socket = null;
    setSyncUI('offline');
    setTimeout(connectWS, 5000);
  };

  socket.onerror = () => { if (socket) socket.close(); };
}

function setSyncUI(status) {
  if (status === 'connected') {
    badge.className = 'badge-status connected';
    badge.textContent = 'CONNECTED & SYNCED';
    syncText.textContent = '● Active Sync';
    syncText.style.color = '#22c55e';
    document.getElementById('sync-check').style.display = 'inline-flex';
  } else if (status === 'awaiting') {
    badge.className = 'badge-status awaiting';
    badge.textContent = 'AWAITING EXTENSION';
    syncText.textContent = '● Extension Offline';
    syncText.style.color = '#f59e0b';
    document.getElementById('sync-check').style.display = 'none';
  } else {
    badge.className = 'badge-status inactive';
    badge.textContent = 'DISCONNECTED';
    syncText.textContent = '● Offline';
    syncText.style.color = '#ef4444';
    document.getElementById('sync-check').style.display = 'none';
  }
}

function onDatabaseEvent(evt) {
  if (!evt) return;
  if (evt.table_name === 'leads')     { loadLeads(); loadStats(); }
  if (evt.table_name === 'queue')     { loadStats(); loadOutreachStats(); }
  if (evt.table_name === 'campaigns') loadCampaigns();
  if (evt.table_name === 'logs')      loadRemoteLogs();
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function renderProfile(p) {
  if (!p || !p.name) return;
  document.getElementById('user-name').textContent          = p.name;
  document.getElementById('user-headline').textContent      = p.headline || '';
  document.getElementById('user-connections-count').textContent = p.connections || '–';
  document.getElementById('user-pending-count').textContent     = p.pending    || '–';
  document.getElementById('user-views-count').textContent       = p.views      || '–';

  const firstName = p.name.split(' ')[0];
  document.getElementById('home-greeting').textContent = `Hello ${firstName},`;

  if (p.avatar) {
    const img = document.getElementById('user-avatar');
    img.src = p.avatar;
    img.onerror = () => {
      img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=0a66c2&color=fff&size=120`;
    };
  }
}

// ─── STATS ────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    const s = await res.json();
    document.getElementById('stat-total-leads').textContent   = s.leads     || 0;
    document.getElementById('stat-invites-sent').textContent  = s.invites   || 0;
    document.getElementById('stat-messages-sent').textContent = s.messages  || 0;
    document.getElementById('stat-campaigns').textContent     = s.campaigns || 0;
    document.getElementById('active-campaigns-count').textContent = s.campaigns || 0;
    document.getElementById('queued-actions-count').textContent   = s.pending   || 0;
    document.getElementById('stat-queued').textContent            = s.pending   || 0;

    const invites = s.invites || 0;
    const total   = s.leads   || 1;
    const pct     = Math.min(100, Math.round((invites / total) * 100));
    document.getElementById('invite-percent-ring').setAttribute('stroke-dasharray', `${pct},100`);
    document.getElementById('invite-pct-label').textContent    = `${pct}%`;
    document.getElementById('stat-accepted-invites').textContent = invites;

    // Prospecting badge
    const prosBadge = document.getElementById('prospecting-status-badge');
    if (s.pending > 0) {
      prosBadge.textContent = 'ACTIVE';
      prosBadge.className = 'badge-status connected';
    } else {
      prosBadge.textContent = 'INACTIVE';
      prosBadge.className = 'badge-status inactive';
    }
  } catch (_) {}
}

// ─── LEADS TABLE ──────────────────────────────────────────────────────────────
const leadsBody    = document.getElementById('leads-table-body');
const searchInput  = document.getElementById('prospect-search');
const filterSource = document.getElementById('filter-source');
const filterStatus = document.getElementById('filter-status');

async function loadLeads() {
  const search = searchInput.value.trim();
  const source = filterSource.value;
  const status = filterStatus.value;
  const offset = currentPage * PAGE_SIZE;

  try {
    const res = await fetch(`${API_BASE}/leads?search=${encodeURIComponent(search)}&source=${source}&status=${status}&limit=${PAGE_SIZE}&offset=${offset}`);
    const data = await res.json();
    const leads = data.leads || [];
    const total = data.total || 0;

    document.getElementById('pagination-info').textContent = `Page ${currentPage + 1} • ${total} total`;
    document.getElementById('btn-prev-page').disabled = currentPage === 0;
    document.getElementById('btn-next-page').disabled = (offset + PAGE_SIZE) >= total;

    if (!leads.length) {
      leadsBody.innerHTML = `<tr><td colspan="5" class="empty-cell">No prospects found. Use Scraper or Chrome Extension to capture leads.</td></tr>`;
      return;
    }

    const statusConfig = {
      captured:    { color: '#64748b', label: 'Captured' },
      visited:     { color: '#6366f1', label: 'Visited'  },
      invite_sent: { color: '#0a66c2', label: 'Invited'  },
      messaged:    { color: '#0891b2', label: 'Messaged' },
      connected:   { color: '#22c55e', label: 'Connected'},
      replied:     { color: '#f59e0b', label: 'Replied'  },
      failed:      { color: '#ef4444', label: 'Failed'   },
    };

    leadsBody.innerHTML = leads.map(l => {
      const sc = statusConfig[l.status] || { color: '#64748b', label: l.status };
      const initials = (l.name || 'LL').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      const avatarHtml = l.avatar
        ? `<img src="${safe(l.avatar)}" class="lead-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      return `
        <tr>
          <td>
            <div class="lead-name-cell">
              <div class="lead-avatar-wrap">
                ${avatarHtml}
                <div class="lead-avatar-initials" style="${l.avatar ? 'display:none' : ''}">${initials}</div>
              </div>
              <div>
                <div class="lead-name">${safe(l.name)}</div>
                <a href="${safe(l.profile_url)}" target="_blank" class="lead-url">View Profile ↗</a>
              </div>
            </div>
          </td>
          <td class="lead-headline">${safe(l.headline || '—')}</td>
          <td><span class="source-badge ${l.source || 'search'}">${l.source === 'group' ? '👥 Group' : '🔍 Search'}</span></td>
          <td><span class="status-pill" style="color:${sc.color};border-color:${sc.color}">${sc.label}</span></td>
          <td>
            <div class="lead-actions">
              <button class="btn-action" onclick="visitLead('${safe(l.id)}','${safe(l.profile_url)}')" title="Visit Profile">👁</button>
              <button class="btn-action" onclick="inviteLead('${safe(l.id)}','${safe(l.profile_url)}')" title="Send Invite">🤝</button>
              <button class="btn-action" onclick="messageLead('${safe(l.id)}','${safe(l.profile_url)}')" title="Send DM">💬</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    leadsBody.innerHTML = `<tr><td colspan="5" class="empty-cell">Error loading leads: ${safe(e.message)}</td></tr>`;
  }
}

// Per-lead action buttons
window.visitLead = async (id, url) => {
  await queueSingleTask(id, url, 'visit_profile');
  showToast('Visit task queued for Extension!');
};
window.inviteLead = async (id, url) => {
  await queueSingleTask(id, url, 'send_invite');
  showToast('Invite task queued for Extension!');
};
window.messageLead = async (id, url) => {
  const msg = prompt('Enter your message for this lead:');
  if (!msg) return;
  await queueSingleTask(id, url, 'send_message', msg);
  showToast('Message task queued for Extension!');
};

async function queueSingleTask(leadId, profileUrl, actionType, message = null) {
  await fetch(`${API_BASE}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead_id: leadId, profile_url: profileUrl, action_type: actionType, message_body: message })
  }).catch(() => {});
  loadStats();
}

// Pagination
document.getElementById('btn-prev-page').addEventListener('click', () => { currentPage = Math.max(0, currentPage - 1); loadLeads(); });
document.getElementById('btn-next-page').addEventListener('click', () => { currentPage++; loadLeads(); });
searchInput.addEventListener('input', () => { currentPage = 0; loadLeads(); });
filterSource.addEventListener('change', () => { currentPage = 0; loadLeads(); });
filterStatus.addEventListener('change', () => { currentPage = 0; loadLeads(); });

// ─── SCRAPER CONTROLS ─────────────────────────────────────────────────────────
function getScraperConfig() {
  return {
    minDelay:    parseInt(document.getElementById('inp-min-delay').value) || 12,
    maxDelay:    parseInt(document.getElementById('inp-max-delay').value) || 35,
    humanScroll: document.getElementById('tog-scroll').checked
  };
}

function showProgress(text) {
  document.getElementById('scrape-progress-text').textContent = text;
  document.getElementById('scrape-progress-bar').classList.remove('hidden');
  document.getElementById('scraper-status-badge').textContent = 'RUNNING';
  document.getElementById('scraper-status-badge').className = 'badge-status connected';
}
function hideProgress() {
  document.getElementById('scrape-progress-bar').classList.add('hidden');
  document.getElementById('scraper-status-badge').textContent = 'IDLE';
  document.getElementById('scraper-status-badge').className = 'badge-status inactive';
}

document.getElementById('btn-start-group').addEventListener('click', async () => {
  const url   = document.getElementById('inp-group-url').value.trim();
  const limit = parseInt(document.getElementById('inp-group-limit').value) || 50;
  if (!url || !url.includes('linkedin.com')) { alert('Enter a valid LinkedIn Group URL.'); return; }
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ action: 'REQUEST_SCRAPE', type: 'group', targetUrl: url, limit, config: getScraperConfig() }));
  }
  showProgress(`Scraping group members… (0/${limit})`);
});

document.getElementById('btn-start-search').addEventListener('click', async () => {
  const keyword   = document.getElementById('inp-keyword').value.trim();
  const manualUrl = document.getElementById('inp-search-url').value.trim();
  const limit     = parseInt(document.getElementById('inp-search-limit').value) || 50;
  let targetUrl = manualUrl || (keyword ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}` : '');
  if (!targetUrl) { alert('Enter a keyword or search URL.'); return; }
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ action: 'REQUEST_SCRAPE', type: 'search', targetUrl, limit, config: getScraperConfig() }));
  }
  showProgress(`Scraping search results… (0/${limit})`);
});

document.getElementById('btn-start-post').addEventListener('click', async () => {
  const keyword = document.getElementById('inp-post-keyword').value.trim();
  const limit   = parseInt(document.getElementById('inp-post-limit').value) || 30;
  if (!keyword) { alert('Enter a keyword to search posts.'); return; }
  const targetUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}`;
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ action: 'REQUEST_SCRAPE', type: 'search', targetUrl, limit, config: getScraperConfig() }));
  }
  showProgress(`Scraping post engagers for "${keyword}"… (0/${limit})`);
});

document.getElementById('btn-stop-all').addEventListener('click', async () => {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify({ action: 'STOP_SCRAPING' }));
  hideProgress();
});

document.getElementById('btn-stop-scrape-bar').addEventListener('click', () => {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify({ action: 'STOP_SCRAPING' }));
  hideProgress();
});

// ─── CAMPAIGNS ────────────────────────────────────────────────────────────────
async function loadCampaigns() {
  try {
    const res = await fetch(`${API_BASE}/campaigns`);
    const camps = await res.json();
    const el = document.getElementById('campaigns-list');
    if (!camps.length) { el.innerHTML = '<div class="empty-camp">No campaigns yet.</div>'; return; }
    el.innerHTML = camps.map(c => `
      <div class="camp-item">
        <div class="camp-info">
          <h4>${safe(c.name)}</h4>
          <span>${c.sequence_type}</span>
        </div>
        <span class="camp-status-badge">${c.status}</span>
      </div>`).join('');
  } catch (_) {}
}

document.getElementById('btn-submit-campaign').addEventListener('click', async () => {
  const name    = document.getElementById('campaign-name-input').value.trim();
  const seq     = document.getElementById('sequence-select').value;
  const message = document.getElementById('campaign-message-input').value.trim();
  const filter  = document.getElementById('campaign-lead-filter').value;
  const fb      = document.getElementById('campaign-feedback');

  if (!name) { showFeedback(fb, 'Enter a campaign name.', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/launch-campaign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sequence_type: seq, message_body: message, lead_filter: filter })
    });
    const j = await res.json();
    if (j.queued !== undefined) {
      showFeedback(fb, `✓ Launched! ${j.queued} leads × ${j.tasks / j.queued | 0} steps = ${j.tasks} tasks queued.`, 'success');
      loadCampaigns(); loadStats();
    } else showFeedback(fb, j.error || 'Failed.', 'error');
  } catch (e) { showFeedback(fb, e.message, 'error'); }
});

// ─── OUTREACH ─────────────────────────────────────────────────────────────────
async function loadOutreachStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    const s = await res.json();
    document.getElementById('qm-pending').textContent  = s.pending  ?? '–';
    document.getElementById('qm-executed').textContent = s.executed ?? '–';
    document.getElementById('qm-failed').textContent   = '–';
  } catch (_) {}
  loadRemoteLogs();
}

async function loadRemoteLogs() {
  try {
    const res = await fetch(`${API_BASE}/logs`);
    const logs = await res.json();
    const box = document.getElementById('outreach-log');
    if (!logs.length) { box.textContent = 'No activity yet.'; return; }
    box.innerHTML = logs.slice(0, 20).map(l => {
      const t = new Date(l.created_at).toLocaleTimeString();
      const cls = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#94a3b8' }[l.level] || '#94a3b8';
      return `<div style="color:${cls};font-size:11px;margin-bottom:2px">[${t}] ${safe(l.message)}</div>`;
    }).join('');
  } catch (_) {}

  // Also update logs console on home tab
  try {
    const res = await fetch(`${API_BASE}/logs`);
    const logs = await res.json();
    logsBox.innerHTML = logs.slice(0, 30).map(l => {
      const t = new Date(l.created_at).toLocaleTimeString();
      const cls = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#94a3b8' }[l.level] || '#94a3b8';
      return `<div style="color:${cls};font-size:11px;margin-bottom:2px">[${t}] ${safe(l.message)}</div>`;
    }).join('');
    logsBox.scrollTop = logsBox.scrollHeight;
  } catch (_) {}
}

document.getElementById('btn-launch-outreach').addEventListener('click', async () => {
  const name    = document.getElementById('out-camp-name').value.trim();
  const seq     = document.getElementById('out-sequence').value;
  const message = document.getElementById('out-message').value.trim();
  const filter  = document.getElementById('out-lead-filter').value;
  const fb      = document.getElementById('outreach-feedback');

  if (!name)    { showFeedback(fb, 'Enter a campaign name.', 'error'); return; }
  if (!message && seq !== 'visit-invite') { showFeedback(fb, 'Enter a message template.', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/launch-campaign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sequence_type: seq, message_body: message, lead_filter: filter })
    });
    const j = await res.json();
    if (j.queued !== undefined) {
      showFeedback(fb, `✓ Outreach launched! ${j.tasks} tasks queued across ${j.queued} leads.`, 'success');
      loadOutreachStats();
    } else showFeedback(fb, j.error || 'Failed.', 'error');
  } catch (e) { showFeedback(fb, e.message, 'error'); }
});

// ─── CLEAR CRM ────────────────────────────────────────────────────────────────
document.getElementById('btn-clear-crm').addEventListener('click', async () => {
  if (!confirm('Permanently clear all CRM data from the cloud database?')) return;
  await fetch(`${API_BASE}/clear-data`, { method: 'POST' });
  location.reload();
});

// ─── SHORTCUT ─────────────────────────────────────────────────────────────────
document.getElementById('btn-create-campaign-shortcut').addEventListener('click', () => {
  document.querySelector('[data-tab="campaigns-tab"]').click();
});

// ─── UTILS ────────────────────────────────────────────────────────────────────
function safe(str) {
  return (str || '').replace(/[&<>"']/g, t => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[t]));
}

function showFeedback(el, msg, type) {
  el.textContent = msg;
  el.className = `feedback-msg ${type}`;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity = '1', 10);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}

// ─── API: direct queue POST for per-lead buttons ──────────────────────────────
// Add the missing /queue REST endpoint support via backend by sending via WS
async function queueSingleTask(leadId, profileUrl, actionType, message = null) {
  // Use a direct POST if the backend supports it, else log it
  try {
    await fetch(`${API_BASE}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, profile_url: profileUrl, action_type: actionType, message_body: message })
    });
  } catch (_) {}
  loadStats();
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
connectWS();
loadStats();
loadRemoteLogs();
setInterval(loadStats, 15000);
setInterval(loadRemoteLogs, 20000);
