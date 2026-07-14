const { app, BrowserWindow } = require('electron');
const path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./database/db.js');

let hostSocket = null;
let rendererSocket = null;

// Start local broker WebSocket server on port 9292
const wss = new WebSocketServer({ port: 9292 });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'REGISTER_DESKTOP') {
        rendererSocket = ws;
        console.log('[LL] Renderer (Win App UI) connected.');
        ws.send(JSON.stringify({
          action: 'REGISTERED',
          clientStatus: hostSocket ? 'connected' : 'disconnected'
        }));
      } else if (msg.action === 'REGISTER_EXTENSION') {
        hostSocket = ws;
        console.log('[LL] Native Host (Chrome Extension) connected.');
        if (rendererSocket) {
          rendererSocket.send(JSON.stringify({ action: 'CLIENT_CONNECTED' }));
        }
      } else {
        // Intercept and persist data locally in SQLite before relaying
        handleIncomingMessage(msg);

        // Relay other messages
        if (ws === rendererSocket) {
          if (hostSocket && hostSocket.readyState === 1) {
            hostSocket.send(data);
          }
        } else if (ws === hostSocket) {
          if (rendererSocket && rendererSocket.readyState === 1) {
            rendererSocket.send(data);
          }
        }
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    if (ws === hostSocket) {
      hostSocket = null;
      console.log('[LL] Native Host disconnected.');
      if (rendererSocket) {
        rendererSocket.send(JSON.stringify({ action: 'CLIENT_DISCONNECTED' }));
      }
    } else if (ws === rendererSocket) {
      rendererSocket = null;
      console.log('[LL] Renderer disconnected.');
    }
  });
});

// SQLite Data Persistence Handlers
function handleIncomingMessage(msg) {
  if (msg.action === 'LEAD_SCRAPED' || msg.action === 'SYNC_LEADS') {
    const it = msg.item || {};
    const lid = "lead_" + Math.random().toString(36).substring(2, 11);
    const profileUrl = it.profileUrl || it.postUrl || "";
    const name = it.name || it.authorName || "Unknown";
    
    if (profileUrl) {
      try {
        const stmt = db.prepare(`
          INSERT INTO prospects (id, name, profile_url, headline, company, location, avatar, source, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured')
          ON CONFLICT(profile_url) DO UPDATE SET
            name = excluded.name,
            headline = excluded.headline,
            avatar = excluded.avatar
        `);
        stmt.run(
          lid, 
          name, 
          profileUrl, 
          it.headline || it.authorHeadline || "", 
          it.company || "", 
          it.location || "", 
          it.avatar || "", 
          it.source || msg.type || "search"
        );
        
        // Notify renderer to refresh UI
        if (rendererSocket && rendererSocket.readyState === 1) {
          rendererSocket.send(JSON.stringify({ action: 'DATABASE_UPDATED', table: 'prospects' }));
        }
      } catch (err) {
        console.error('Error writing lead to SQLite:', err.message);
      }
    }
  }

  if (msg.action === 'TASK_COMPLETED') {
    const st = msg.success ? 'executed' : 'failed';
    const now = new Date().toISOString();
    
    try {
      // Update queue task
      const qStmt = db.prepare('UPDATE queue SET status = ?, error = ?, executed_at = ? WHERE id = ?');
      qStmt.run(st, msg.error || null, now, parseInt(msg.task_id));
      
      // Update prospect status based on completed action
      if (msg.success) {
        const map = { visit_profile: 'visited', send_invite: 'invite_sent', send_message: 'messaged' };
        const newStatus = map[msg.action_type] || 'visited';
        
        const pStmt = db.prepare('UPDATE prospects SET status = ? WHERE profile_url = (SELECT profile_url FROM queue WHERE id = ?)');
        pStmt.run(newStatus, parseInt(msg.task_id));
      }
      
      // Notify renderer
      if (rendererSocket && rendererSocket.readyState === 1) {
        rendererSocket.send(JSON.stringify({ action: 'DATABASE_UPDATED', table: 'queue' }));
      }
    } catch (err) {
      console.error('Error updating task in SQLite:', err.message);
    }
  }

  if (msg.action === 'LOG_MESSAGE') {
    try {
      const stmt = db.prepare('INSERT INTO logs (message, level) VALUES (?, ?)');
      stmt.run(msg.text, msg.level || 'info');
      
      if (rendererSocket && rendererSocket.readyState === 1) {
        rendererSocket.send(JSON.stringify({ action: 'DATABASE_UPDATED', table: 'logs' }));
      }
    } catch (err) {
      console.error('Error writing log to SQLite:', err.message);
    }
  }
}

// ─── TASK EXECUTION SCHEDULER ────────────────────────────────────────────────
// Poll SQLite local database queue for pending outreach actions and dispatch to extension
setInterval(() => {
  if (!hostSocket || hostSocket.readyState !== 1) return; // Wait for active extension connection
  
  try {
    // Limit to one active task processing at a time
    const activeCheck = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'processing'").get();
    if (activeCheck.count > 0) return;
    
    const task = db.prepare(`
      SELECT q.*, p.profile_url as lead_url FROM queue q
      LEFT JOIN prospects p ON p.id = q.lead_id
      WHERE q.status = 'pending'
      ORDER BY q.created_at ASC
      LIMIT 1
    `).get();
    
    if (task) {
      task.profile_url = task.profile_url || task.lead_url;
      console.log(`[LL] Dispatching task ${task.id} (${task.action_type}) to extension`);
      
      // Mark processing locally
      db.prepare("UPDATE queue SET status = 'processing' WHERE id = ?").run(task.id);
      
      // Dispatch task payload to Chrome extension Native Host
      hostSocket.send(JSON.stringify({
        action: 'EXECUTE_TASK',
        task: {
          id: task.id,
          action_type: task.action_type,
          profile_url: task.profile_url,
          message_body: task.message_body
        }
      }));
      
      if (rendererSocket && rendererSocket.readyState === 1) {
        rendererSocket.send(JSON.stringify({ action: 'DATABASE_UPDATED', table: 'queue' }));
      }
    }
  } catch (err) {
    console.error('Error in task queue scheduler:', err.message);
  }
}, 30000);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: "Link Lead Desktop Dashboard",
    icon: path.join(__dirname, 'icon.png')
  });

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
