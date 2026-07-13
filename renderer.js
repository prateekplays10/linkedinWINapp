// Windows Companion App Renderer Controller
const API_BASE = "https://mbtg3x8u.function2.insforge.app/api";
let socket = null;

// Page Navigation Bindings
const menuItems = document.querySelectorAll('.menu-item');
const tabPanels = document.querySelectorAll('.tab-panel');

menuItems.forEach(item => {
  item.addEventListener('click', () => {
    const target = item.getAttribute('data-tab');
    
    menuItems.forEach(i => i.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    item.classList.add('active');
    document.getElementById(target).classList.add('active');
    
    // Lazy load panels
    if (target === 'prospects-tab') loadLeads();
    if (target === 'campaigns-tab') loadCampaigns();
  });
});

// ==========================================
// WebSocket Synchronization (Automatic Pulse)
// ==========================================
const consoleBadge = document.getElementById('console-connection-badge');
const syncCheck = document.getElementById('sync-check');
const profileSyncText = document.getElementById('profile-sync-text');
const logsContainer = document.getElementById('logs-container');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userConnections = document.getElementById('user-connections-count');
const userPending = document.getElementById('user-pending-count');
const userViews = document.getElementById('user-views-count');

function connectWS() {
  if (socket) return;
  
  socket = new WebSocket('wss://mbtg3x8u.function2.insforge.app/api');

  socket.onopen = () => {
    console.log('Linked to Deno WS host.');
    updateSyncUI('connected');
    
    // Register desktop client
    socket.send(JSON.stringify({
      action: 'REGISTER_DESKTOP'
    }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Desktop received action:', data.action);

      switch (data.action) {
        case 'REGISTERED':
          updateSyncUI(data.clientStatus);
          break;

        case 'CLIENT_CONNECTED':
          updateSyncUI('connected');
          break;

        case 'CLIENT_DISCONNECTED':
          updateSyncUI('disconnected');
          break;

        case 'NEW_LOG':
          renderLog(data);
          break;

        case 'SYNC_PROFILE_DATA':
          renderSyncedProfile(data.profile);
          break;

        case 'LEADS_UPDATED':
          loadLeads();
          loadQueueStats();
          break;
      }
    } catch (e) {
      console.error(e);
    }
  };

  socket.onclose = () => {
    socket = null;
    updateSyncUI('offline');
    setTimeout(connectWS, 5000); // Auto reconnect
  };

  socket.onerror = () => {
    if (socket) socket.close();
  };
}

function updateSyncUI(status) {
  if (status === 'connected') {
    consoleBadge.className = 'badge-status connected';
    consoleBadge.textContent = 'CONNECTED & SYNCED';
    syncCheck.style.display = 'inline-flex';
    profileSyncText.textContent = 'Active Sync';
    profileSyncText.style.color = '#10b981';
  } else if (status === 'disconnected') {
    consoleBadge.className = 'badge-status awaiting';
    consoleBadge.textContent = 'AWAITING EXTENSION';
    syncCheck.style.display = 'none';
    profileSyncText.textContent = 'Out of Sync';
    profileSyncText.style.color = '#64748b';
  } else {
    consoleBadge.className = 'badge-status inactive';
    consoleBadge.textContent = 'OFFLINE';
    syncCheck.style.display = 'none';
    profileSyncText.textContent = 'Offline';
    profileSyncText.style.color = '#ef4444';
  }
}

function renderSyncedProfile(profile) {
  if (!profile) return;
  
  if (profile.name) userName.textContent = profile.name;
  if (profile.avatar) userAvatar.src = profile.avatar;
  if (profile.connections) userConnections.textContent = profile.connections;
  if (profile.pending) userPending.textContent = profile.pending;
  if (profile.views) userViews.textContent = profile.views;

  // Personal greeting matching Waalaxy
  const shortName = profile.name.split(' ')[0];
  document.getElementById('home-greeting').textContent = `Hello ${shortName},`;
}

function renderLog(log) {
  const div = document.createElement('div');
  div.className = `log-item ${log.level || 'info'}`;
  div.innerHTML = `<span style="color: #64748b;">[${log.timestamp}]</span> ${escapeHTML(log.message)}`;
  logsContainer.appendChild(div);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// ==========================================
// REST API Integrations (CRM)
// ==========================================
const leadsTableBody = document.getElementById('leads-table-body');
const prospectSearch = document.getElementById('prospect-search');

async function loadLeads() {
  const query = prospectSearch.value.trim();
  try {
    const res = await fetch(`${API_BASE}/leads?search=${encodeURIComponent(query)}`);
    const data = await res.json();
    const leads = data.leads || data;

    if (!leads || leads.length === 0) {
      leadsTableBody.innerHTML = `<tr><td colspan="4" class="empty-cell">No prospects found in CRM.</td></tr>`;
      return;
    }

    leadsTableBody.innerHTML = leads.map(lead => {
      let statusColor = 'var(--text-muted)';
      if (lead.status === 'invite_sent') statusColor = 'var(--primary-color)';
      if (lead.status === 'connected') statusColor = 'var(--success-color)';
      if (lead.status === 'replied') statusColor = '#f59e0b';
      if (lead.status === 'failed') statusColor = 'var(--danger-color)';

      return `
        <tr>
          <td>
            <div style="font-weight: 700;">${escapeHTML(lead.name)}</div>
            <a href="${escapeHTML(lead.profile_url)}" target="_blank" style="font-size: 11px; color: var(--primary-color);">View LinkedIn</a>
          </td>
          <td style="color: var(--text-muted); max-width: 250px;">${escapeHTML(lead.headline)}</td>
          <td><span style="font-weight: 800; text-transform: uppercase; font-size: 10px; color: ${statusColor};">${lead.status || 'captured'}</span></td>
          <td><span class="plan-badge">${escapeHTML(lead.list_name)}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

prospectSearch.addEventListener('input', loadLeads);

// Campaigns Creator
const btnSubmitCampaign = document.getElementById('btn-submit-campaign');
const campaignNameInput = document.getElementById('campaign-name-input');
const sequenceSelect = document.getElementById('sequence-select');
const campaignsList = document.getElementById('campaigns-list');

async function loadCampaigns() {
  try {
    const res = await fetch(`${API_BASE}/campaigns`);
    const campaigns = await res.json();

    if (!campaigns || campaigns.length === 0) {
      campaignsList.innerHTML = `<div class="empty-camp">No active campaigns configured.</div>`;
      return;
    }

    campaignsList.innerHTML = campaigns.map(c => `
      <div class="camp-item">
        <div class="camp-info">
          <h4>${escapeHTML(c.name)}</h4>
          <span>Type: ${c.sequence_type}</span>
        </div>
        <span class="camp-status-badge">Active</span>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

btnSubmitCampaign.addEventListener('click', async () => {
  const name = campaignNameInput.value.trim();
  const sequence = sequenceSelect.value;

  if (!name) {
    alert('Please enter a campaign name!');
    return;
  }

  const payload = {
    id: 'camp_' + Math.random().toString(36).substr(2, 9),
    name,
    sequence_type: sequence
  };

  try {
    await fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    campaignNameInput.value = '';
    loadCampaigns();
    loadQueueStats();
  } catch (err) {
    console.error(err);
  }
});

async function loadQueueStats() {
  try {
    const res = await fetch(`${API_BASE}/queue-count`);
    const data = await res.json();
    document.getElementById('queued-actions-count').textContent = data.count || 0;
  } catch (err) {
    console.error(err);
  }
}

// Clear CRM Data
document.getElementById('btn-clear-crm').addEventListener('click', async () => {
  if (confirm('Are you sure you want to permanently clear the CRM database?')) {
    await fetch(`${API_BASE}/clear-data`, { method: 'POST' });
    location.reload();
  }
});

// Load Logs
fetch(`${API_BASE}/logs`)
  .then(res => res.json())
  .then(logs => {
    logsContainer.innerHTML = '';
    logs.reverse().forEach(log => {
      const div = document.createElement('div');
      div.className = `log-item ${log.level || 'info'}`;
      const time = new Date(log.timestamp).toLocaleTimeString();
      div.innerHTML = `<span style="color: #64748b;">[${time}]</span> ${escapeHTML(log.message)}`;
      logsContainer.appendChild(div);
    });
    logsContainer.scrollTop = logsContainer.scrollHeight;
  });

// Setup Shortcut redirect
const shortcutBtn = document.getElementById('btn-create-campaign-shortcut');
if (shortcutBtn) {
  shortcutBtn.addEventListener('click', () => {
    document.querySelector('[data-tab="campaigns-tab"]').click();
  });
}

// XSS Sanitizer
function escapeHTML(str) {
  return (str || '').replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Init WS
connectWS();
loadQueueStats();
setInterval(loadQueueStats, 10000);
