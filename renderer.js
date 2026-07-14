// renderer.js — Link Lead Desktop Client with Local SQLite Data Engine
'use strict';

const db = require('./database/db.js');
let socket = null;
let currentPage = 0;
const PAGE_SIZE = 50;

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
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

// ─── WEBSOCKET (to Local Broker) ─────────────────────────────────────────────
const badge    = document.getElementById('console-connection-badge');
const syncText = document.getElementById('profile-sync-text');
const logsBox  = document.getElementById('logs-container');

function connectWS() {
  if (socket) return;
  socket = new WebSocket('ws://localhost:9292');

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
        case 'DATABASE_UPDATED':
          // Reload matching views when SQLite data updates
          if (d.table === 'prospects') { loadLeads(); loadStats(); }
          if (d.table === 'queue')     { loadStats(); loadOutreachStats(); }
          if (d.table === 'campaigns') loadCampaigns();
          if (d.table === 'logs')      loadRemoteLogs();
          break;

        // Real-time scraping progress from Extension
        case 'SCRAPE_PROGRESS': {
          const { count, limit, type, latest } = d;
          const pct = limit > 0 ? Math.round((count / limit) * 100) : 0;
          showProgress(`Scraping ${type}… (${count}/${limit}) — Last: ${latest || ''}`);
          const bar = document.getElementById('scrape-fill-bar');
          if (bar) bar.style.width = `${pct}%`;
          break;
        }

        case 'LEAD_SCRAPED':
          loadLeads();
          loadStats();
          break;

        case 'SCRAPE_STOPPED':
          hideProgress();
          loadStats();
          break;

        case 'TASK_COMPLETED':
          loadStats();
          loadRemoteLogs();
          break;

        case 'TASK_BLOCKED':
          showToast(`⚠️ Safety: ${d.reason}`);
          break;
      }
    } catch (_) {}
  };

  socket.onclose = () => {
    socket = null;
    setSyncUI('awaiting');
    const delay = Math.min(30000, 5000 * (1 + Math.random()));
    setTimeout(connectWS, delay);
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

// ─── PROFILE ─────────────────────────────────────────────────────────────────
function renderProfile(p) {
  if (!p || !p.name) return;

  try { localStorage.setItem('ll_cached_profile', JSON.stringify(p)); } catch (_) {}

  document.getElementById('user-name').textContent              = p.name;
  document.getElementById('user-headline').textContent          = p.headline || '';
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

  if (p.name !== 'Prospector' && p.name !== 'Guest Profile') {
    document.getElementById('sync-check').style.display = 'inline-flex';
  }
}

function loadCachedProfile() {
  try {
    const cached = localStorage.getItem('ll_cached_profile');
    if (cached) renderProfile(JSON.parse(cached));
  } catch (_) {}
}

// ─── STATS (NATIVE SQL QUERIES) ──────────────────────────────────────────────
async function loadStats() {
  try {
    const totalLeads = db.prepare("SELECT COUNT(*) as count FROM prospects").get().count;
    const invitesSent = db.prepare("SELECT COUNT(*) as count FROM queue WHERE action_type = 'send_invite' AND status = 'executed'").get().count;
    const messagesSent = db.prepare("SELECT COUNT(*) as count FROM queue WHERE action_type = 'send_message' AND status = 'executed'").get().count;
    const campaignsCount = db.prepare("SELECT COUNT(*) as count FROM campaigns").get().count;
    const queuedCount = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'pending'").get().count;
    const executedCount = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'executed'").get().count;

    document.getElementById('stat-total-leads').textContent   = totalLeads;
    document.getElementById('stat-invites-sent').textContent  = invitesSent;
    document.getElementById('stat-messages-sent').textContent = messagesSent;
    document.getElementById('stat-campaigns').textContent     = campaignsCount;
    document.getElementById('active-campaigns-count').textContent = campaignsCount;
    document.getElementById('queued-actions-count').textContent   = queuedCount;
    document.getElementById('stat-queued').textContent            = queuedCount;

    const pct = totalLeads > 0 ? Math.min(100, Math.round((invitesSent / totalLeads) * 100)) : 0;
    document.getElementById('invite-percent-ring').setAttribute('stroke-dasharray', `${pct},100`);
    document.getElementById('invite-pct-label').textContent    = `${pct}%`;
    document.getElementById('stat-accepted-invites').textContent = invitesSent;

    // Safety panel counters
    document.getElementById('sl-invites').textContent = `${invitesSent} / 40`;
    document.getElementById('sl-messages').textContent = `${messagesSent} / 80`;
    document.getElementById('sl-total').textContent = `${executedCount} / 120`;

    const prosBadge = document.getElementById('prospecting-status-badge');
    if (queuedCount > 0) {
      prosBadge.textContent = 'ACTIVE';
      prosBadge.className = 'badge-status connected';
    } else {
      prosBadge.textContent = 'INACTIVE';
      prosBadge.className = 'badge-status inactive';
    }
  } catch (err) {
    console.error('Error loading stats:', err.message);
  }
}

// ─── LEADS TABLE (NATIVE SQL SEARCH/FILTER) ──────────────────────────────────
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
    let query = 'SELECT * FROM prospects WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR headline LIKE ? OR company LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (source !== 'all') {
      query += ' AND source = ?';
      params.push(source);
    }
    if (status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    // Get total count for pagination
    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const total = db.prepare(countQuery).get(params).count;

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(PAGE_SIZE, offset);

    const leads = db.prepare(query).all(params);

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
              <button class="btn-action" onclick="visitLead('${safe(l.id)}','${safe(l.profile_url)}')" title="Visit Profile">👁️</button>
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

// Per-lead action triggers
window.visitLead = async (id, url) => {
  await queueSingleTask(id, url, 'visit_profile');
  showToast('Visit task queued locally!');
};
window.inviteLead = async (id, url) => {
  await queueSingleTask(id, url, 'send_invite');
  showToast('Invite task queued locally!');
};
window.messageLead = async (id, url) => {
  const msg = prompt('Enter your message for this lead:');
  if (!msg) return;
  await queueSingleTask(id, url, 'send_message', msg);
  showToast('Message task queued locally!');
};

async function queueSingleTask(leadId, profileUrl, actionType, message = null) {
  try {
    const stmt = db.prepare(`
      INSERT INTO queue (lead_id, profile_url, action_type, message_body, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    stmt.run(leadId, profileUrl, actionType, message);
    loadStats();
  } catch (err) {
    console.error('Failed to queue task:', err.message);
  }
}

// Pagination
document.getElementById('btn-prev-page').addEventListener('click', () => { currentPage = Math.max(0, currentPage - 1); loadLeads(); });
document.getElementById('btn-next-page').addEventListener('click', () => { currentPage++; loadLeads(); });
searchInput.addEventListener('input', () => { currentPage = 0; loadLeads(); });
filterSource.addEventListener('change', () => { currentPage = 0; loadLeads(); });
filterStatus.addEventListener('change', () => { currentPage = 0; loadLeads(); });

// ─── SCRAPER CONTROLS ────────────────────────────────────────────────────────
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

// ─── CAMPAIGNS (NATIVE VISUAL BUILDER INTEGRATION) ───────────────────────────
async function loadCampaigns() {
  try {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
    const el = document.getElementById('campaigns-list');
    if (!campaigns.length) { el.innerHTML = '<div class="empty-camp">No active campaigns.</div>'; return; }
    
    el.innerHTML = campaigns.map(c => {
      const total = db.prepare("SELECT COUNT(*) as count FROM queue WHERE campaign_id = ?").get(c.id).count;
      const completed = db.prepare("SELECT COUNT(*) as count FROM queue WHERE campaign_id = ? AND status = 'executed'").get(c.id).count;
      const pending = db.prepare("SELECT COUNT(*) as count FROM queue WHERE campaign_id = ? AND status = 'pending'").get(c.id).count;
      return `
      <div class="camp-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>${safe(c.name)}</h4>
          <span class="camp-status-badge">${c.status}</span>
        </div>
        <div style="font-size:11px; color:#64748b;">Sequence: <strong>${c.sequence_type}</strong></div>
        <div style="display:flex; gap:12px; font-size:11px; background:#f1f5f9; padding:4px 8px; border-radius:4px;">
          <div>Pending: <strong>${pending}</strong></div>
          <div>Success: <strong style="color:#22c55e;">${completed}</strong></div>
          <div>Total: <strong>${total}</strong></div>
        </div>
      </div>`;
    }).join('');
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
    const campaignId = 'camp_' + Math.random().toString(36).substring(2, 11);
    
    // 1. Insert Campaign into campaigns table
    db.prepare('INSERT INTO campaigns (id, name, sequence_type, message_body) VALUES (?, ?, ?, ?)').run(
      campaignId, name, seq, message
    );

    // 2. Select target leads based on lead filter
    let leadQuery = "SELECT * FROM prospects WHERE status = 'captured'";
    const params = [];
    if (filter === 'group') {
      leadQuery += " AND source = 'group'";
    } else if (filter === 'search') {
      leadQuery += " AND source = 'search'";
    }
    
    const targetLeads = db.prepare(leadQuery).all();

    // 3. Populate outreach tasks in the queue table
    let actionSequence = [];
    if (seq === 'visit-invite') {
      actionSequence = ['visit_profile', 'send_invite'];
    } else if (seq === 'visit-invite-message') {
      actionSequence = ['visit_profile', 'send_invite', 'send_message'];
    } else if (seq === 'invite-only') {
      actionSequence = ['send_invite'];
    } else if (seq === 'message-only') {
      actionSequence = ['send_message'];
    }

    let queuedCount = 0;
    targetLeads.forEach(lead => {
      // Add first action in the sequence to the queue
      const initialAction = actionSequence[0];
      
      // Personalize message variables {{name}}, {{company}}
      let personalizedMsg = message;
      if (personalizedMsg) {
        personalizedMsg = personalizedMsg
          .replace(/\{\{name\}\}/gi, lead.name)
          .replace(/\{\{company\}\}/gi, lead.company || 'your company')
          .replace(/\{\{headline\}\}/gi, lead.headline || '');
      }

      db.prepare(`
        INSERT INTO queue (lead_id, campaign_id, profile_url, action_type, message_body, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(lead.id, campaignId, lead.profile_url, initialAction, personalizedMsg || null);
      
      queuedCount++;
    });

    showFeedback(fb, `✓ Launched! Queued ${queuedCount} tasks for processing.`, 'success');
    
    // Reset forms
    document.getElementById('campaign-name-input').value = '';
    document.getElementById('campaign-message-input').value = '';
    
    loadCampaigns();
    loadStats();
  } catch (e) { 
    showFeedback(fb, e.message, 'error'); 
  }
});

// ─── OUTREACH ────────────────────────────────────────────────────────────────
async function loadOutreachStats() {
  try {
    const pending = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'pending'").get().count;
    const executed = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'executed'").get().count;
    const failed = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'failed'").get().count;

    document.getElementById('qm-pending').textContent  = pending;
    document.getElementById('qm-executed').textContent = executed;
    document.getElementById('qm-failed').textContent   = failed;
  } catch (_) {}
  loadRemoteLogs();
}

async function loadRemoteLogs() {
  try {
    const logs = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 30').all();
    
    // Outreach page logs
    const outreachBox = document.getElementById('outreach-log');
    if (!logs.length) { 
      outreachBox.textContent = 'No activity yet.'; 
    } else {
      outreachBox.innerHTML = logs.slice(0, 20).map(l => {
        const t = new Date(l.created_at).toLocaleTimeString();
        const cls = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#94a3b8' }[l.level] || '#94a3b8';
        return `<div style="color:${cls};font-size:11px;margin-bottom:2px">[${t}] ${safe(l.message)}</div>`;
      }).join('');
    }

    // Home page telemetry box
    logsBox.innerHTML = logs.map(l => {
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
    const campaignId = 'camp_' + Math.random().toString(36).substring(2, 11);
    
    // Insert Campaign
    db.prepare('INSERT INTO campaigns (id, name, sequence_type, message_body) VALUES (?, ?, ?, ?)').run(
      campaignId, name, seq, message
    );

    // Get target prospects
    let leadQuery = "SELECT * FROM prospects WHERE status = 'captured'";
    if (filter === 'group') {
      leadQuery += " AND source = 'group'";
    } else if (filter === 'search') {
      leadQuery += " AND source = 'search'";
    }
    const targetLeads = db.prepare(leadQuery).all();

    let queuedCount = 0;
    targetLeads.forEach(lead => {
      let personalizedMsg = message;
      if (personalizedMsg) {
        personalizedMsg = personalizedMsg
          .replace(/\{\{name\}\}/gi, lead.name)
          .replace(/\{\{company\}\}/gi, lead.company || 'your company')
          .replace(/\{\{headline\}\}/gi, lead.headline || '');
      }

      db.prepare(`
        INSERT INTO queue (lead_id, campaign_id, profile_url, action_type, message_body, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(lead.id, campaignId, lead.profile_url, seq.startsWith('visit') ? 'visit_profile' : 'send_message', personalizedMsg || null);
      
      queuedCount++;
    });

    showFeedback(fb, `✓ Outreach launched! Queued ${queuedCount} tasks.`, 'success');
    loadOutreachStats();
  } catch (e) { 
    showFeedback(fb, e.message, 'error'); 
  }
});

// ─── CLEAR CRM ───────────────────────────────────────────────────────────────
document.getElementById('btn-clear-crm').addEventListener('click', async () => {
  if (!confirm('Permanently clear all local CRM data?')) return;
  try {
    db.exec('DELETE FROM prospects; DELETE FROM campaigns; DELETE FROM queue; DELETE FROM logs;');
    location.reload();
  } catch (err) {
    alert('Failed to clear database: ' + err.message);
  }
});

document.getElementById('btn-create-campaign-shortcut').addEventListener('click', () => {
  document.querySelector('[data-tab="campaigns-tab"]').click();
});

// ─── UTILS ───────────────────────────────────────────────────────────────────
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

// ─── BOOT ────────────────────────────────────────────────────────────────────
loadCachedProfile();
connectWS();
loadStats();
loadRemoteLogs();
setInterval(loadStats, 15000);
setInterval(loadRemoteLogs, 20000);
