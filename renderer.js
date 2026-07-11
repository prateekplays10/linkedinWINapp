const API_BASE = "https://mbtg3x8u.function2.insforge.app/api";
const WS_BASE = "wss://mbtg3x8u.function2.insforge.app";

// UI DOM Elements
const tabItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

const metricClientStatus = document.getElementById('metric-client-status');
const metricTotalLeads = document.getElementById('metric-total-leads');
const metricActiveCampaigns = document.getElementById('metric-active-campaigns');
const logsContainer = document.getElementById('logs-container');

const leadsTableBody = document.getElementById('leads-table-body');
const leadsSearch = document.getElementById('leads-search');

const campaignNameInput = document.getElementById('campaign-name');
const campaignSequenceSelect = document.getElementById('campaign-sequence');
const campaignNoteInput = document.getElementById('campaign-note');
const campaignMessageInput = document.getElementById('campaign-message');
const btnCreateCampaign = document.getElementById('btn-create-campaign');
const campaignsFeed = document.getElementById('campaigns-feed');
const btnClearDb = document.getElementById('btn-clear-db');

let activeTabId = 'dashboard-tab';
let socket = null;

// 1. Sidebar Tab Switching
tabItems.forEach(item => {
  item.addEventListener('click', () => {
    tabItems.forEach(i => i.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    item.classList.add('active');
    activeTabId = item.getAttribute('data-tab');
    document.getElementById(activeTabId).classList.add('active');

    if (activeTabId === 'leads-tab') loadLeads();
    if (activeTabId === 'campaigns-tab') loadCampaigns();
  });
});

// 2. Fetch and Load Leads Table
async function loadLeads() {
  try {
    const res = await fetch(`${API_BASE}/leads`);
    const leads = await res.json();
    metricTotalLeads.textContent = leads.length;

    if (leads.length === 0) {
      leadsTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No contacts synced yet. Open your Chrome Extension to start scraping.</td></tr>`;
      return;
    }

    renderLeadsTable(leads);
  } catch (err) {
    console.error('Failed to load leads:', err);
  }
}

function renderLeadsTable(leads) {
  const searchTerm = leadsSearch.value.trim().toLowerCase();
  
  const filteredLeads = leads.filter(lead => {
    return (
      lead.name.toLowerCase().includes(searchTerm) ||
      (lead.headline && lead.headline.toLowerCase().includes(searchTerm)) ||
      (lead.company && lead.company.toLowerCase().includes(searchTerm)) ||
      (lead.list_name && lead.list_name.toLowerCase().includes(searchTerm))
    );
  });

  if (filteredLeads.length === 0) {
    leadsTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No matching contacts found.</td></tr>`;
    return;
  }

  leadsTableBody.innerHTML = filteredLeads.map(lead => {
    const statusClass = lead.status.toLowerCase();
    const locationCompanyText = `${lead.location || 'N/A'} <br> <span style="font-size: 10px; color: #94a3b8;">${lead.company || 'Unknown Company'}</span>`;
    const contactInfoText = `${lead.email || 'No Email'} <br> <span style="font-size: 10px; color: #94a3b8;">${lead.phone || 'No Phone'}</span>`;
    
    return `
      <tr>
        <td>
          <div style="font-weight: 700;">${escapeHTML(lead.name)}</div>
          <div style="font-size: 10px; color: #94a3b8; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(lead.headline || '')}</div>
          <a href="${escapeHTML(lead.profile_url)}" target="_blank" style="font-size: 9px; color: var(--accent-cyan); text-decoration: underline;">View Profile</a>
        </td>
        <td><span class="status-badge ${statusClass}">${lead.status}</span></td>
        <td><span class="badge" style="font-size: 9px;">${escapeHTML(lead.list_name)}</span></td>
        <td>${locationCompanyText}</td>
        <td>${contactInfoText}</td>
      </tr>
    `;
  }).join('');
}

leadsSearch.addEventListener('keyup', () => {
  fetch(`${API_BASE}/leads`)
    .then(res => res.json())
    .then(leads => renderLeadsTable(leads));
});

// 3. Campaigns Builder & Feed Manager
async function loadCampaigns() {
  try {
    const res = await fetch(`${API_BASE}/campaigns`);
    const campaigns = await res.json();
    
    const activeCount = campaigns.filter(c => c.status === 'active').length;
    metricActiveCampaigns.textContent = activeCount;

    if (campaigns.length === 0) {
      campaignsFeed.innerHTML = `<div class="empty-state">No campaigns created yet. Create one on the left.</div>`;
      return;
    }

    campaignsFeed.innerHTML = campaigns.map(camp => {
      const isStartable = camp.status === 'draft';
      const badgeClass = camp.status === 'active' ? 'status-badge connected' : 'status-badge imported';
      
      return `
        <div class="campaign-row">
          <div class="camp-info">
            <h4>${escapeHTML(camp.name)}</h4>
            <span>Sequence: ${escapeHTML(camp.sequence_type.replace(/_/g, ' '))}</span>
            <div style="margin-top: 4px;"><span class="${badgeClass}">${camp.status}</span></div>
          </div>
          <div class="camp-status">
            ${isStartable ? `
              <button class="btn btn-primary btn-action-small" onclick="startCampaign('${camp.id}', '${camp.sequence_type}')">
                🚀 Start Campaign
              </button>
            ` : `<span style="font-size: 11px; color: var(--accent-emerald);">Running...</span>`}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load campaigns:', err);
  }
}

window.startCampaign = async (id, seqType) => {
  const listName = prompt('Enter the List Name containing the scraped leads you want to target (e.g. "Post Search List" or "Group List"):', 'Post Search List');
  if (!listName) return;

  const noteText = seqType.includes('invite') ? prompt('Enter connection invitation note (leave blank for no note):') : '';
  const messageText = seqType.includes('message') ? prompt('Enter message text to send after connection acceptance:') : '';

  try {
    const res = await fetch(`${API_BASE}/campaigns/${id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listName,
        messageNote: noteText,
        messageBody: messageText
      })
    });
    const result = await res.json();
    if (result.success) {
      alert(`Campaign successfully launched for ${result.count} leads in list "${listName}"!`);
      loadCampaigns();
    } else {
      alert('Error: ' + result.error);
    }
  } catch (err) {
    alert('Failed to start campaign: ' + err.message);
  }
};

btnCreateCampaign.addEventListener('click', async () => {
  const name = campaignNameInput.value.trim();
  const sequenceType = campaignSequenceSelect.value;

  if (!name) {
    alert('Please enter a campaign name.');
    return;
  }

  const id = 'camp_' + Math.random().toString(36).substr(2, 9);
  try {
    const res = await fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, sequence_type: sequenceType })
    });
    const result = await res.json();
    if (result.success) {
      campaignNameInput.value = '';
      loadCampaigns();
    }
  } catch (err) {
    console.error('Failed to create campaign:', err);
  }
});

// 4. Clear Database CRM Wipes
btnClearDb.addEventListener('click', async () => {
  if (confirm('Warning: This will permanently wipe all cloud database tables including leads, campaigns, queue list, and logs. Proceed?')) {
    try {
      const res = await fetch(`${API_BASE}/clear-data`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        alert('All cloud database storage cleared successfully.');
        loadLeads();
        loadCampaigns();
      }
    } catch (err) {
      console.error(err);
    }
  }
});

// 5. Connect to InsForge Real-Time Updates via WebSockets
function connectWS() {
  if (socket) return;

  socket = new WebSocket(WS_BASE);

  socket.onopen = () => {
    console.log("Connected to InsForge WS");
    socket.send(JSON.stringify({ action: "REGISTER_DESKTOP" }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.action === "NEW_LOG") {
        renderLog(data);
      } else if (data.action === "REGISTERED") {
        updateClientStatus(data.clientStatus);
      } else if (data.action === "CLIENT_CONNECTED") {
        updateClientStatus("connected");
      } else if (data.action === "CLIENT_DISCONNECTED") {
        updateClientStatus("disconnected");
      } else if (data.action === "LEADS_UPDATED") {
        loadLeads();
      }
    } catch (e) {
      console.error("Failed to parse WS message:", e);
    }
  };

  socket.onclose = () => {
    socket = null;
    setTimeout(connectWS, 5000); // Reconnect
  };

  socket.onerror = () => {
    socket.close();
  };
}

function updateClientStatus(status) {
  if (status === "connected") {
    metricClientStatus.textContent = 'Active Link';
    metricClientStatus.className = 'connected';
  } else {
    metricClientStatus.textContent = 'Offline';
    metricClientStatus.className = 'disconnected';
  }
}

function renderLog(log) {
  const logDiv = document.createElement('div');
  logDiv.className = `log-item ${log.level || 'info'}`;
  logDiv.innerHTML = `<span style="color: #64748b;">[${log.timestamp}]</span> ${escapeHTML(log.message)}`;
  logsContainer.appendChild(logDiv);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// Load Initial Logs & Telemetry
fetch(`${API_BASE}/logs`)
  .then(res => res.json())
  .then(logs => {
    logsContainer.innerHTML = '';
    logs.reverse().forEach(log => {
      const logDiv = document.createElement('div');
      logDiv.className = `log-item ${log.level || 'info'}`;
      // Clean timestamp format
      const time = new Date(log.timestamp).toLocaleTimeString();
      logDiv.innerHTML = `<span style="color: #64748b;">[${time}]</span> ${escapeHTML(log.message)}`;
      logsContainer.appendChild(logDiv);
    });
    logsContainer.scrollTop = logsContainer.scrollHeight;
  });

// Poll dashboard counts on load
fetch(`${API_BASE}/leads`)
  .then(res => res.json())
  .then(leads => {
    metricTotalLeads.textContent = leads.length;
  });

fetch(`${API_BASE}/campaigns`)
  .then(res => res.json())
  .then(camps => {
    const activeCount = camps.filter(c => c.status === 'active').length;
    metricActiveCampaigns.textContent = activeCount;
  });

// Start WS connection
connectWS();

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
