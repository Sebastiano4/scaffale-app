/* Sync UI: the cloud status button (sidebar + library menu) and Disconnect in settings. */
import { $, showToast } from './dom.js';
import { syncConfigured } from './drive-auth.js';
import { initSync, syncNow, onSyncStatus, syncStatus, disconnect, setOnLocalChange } from './sync.js';
import { loadLibrary } from './library.js';
import { loadSyncState } from './sync-state.js';

const LABELS = {
  off: 'Connect Google Drive',
  'needs-auth': 'Tap to sync',
  syncing: 'Syncing…',
  ok: 'Synced',
  offline: 'Offline',
  error: 'Sync error — tap to retry',
};

function timeAgo(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const h = Math.round(min / 60);
  return h < 24 ? h + ' h ago' : new Date(ts).toLocaleDateString();
}

function render(s, err) {
  const label = LABELS[s] || LABELS.off;
  for (const btn of [$('#sync-btn'), $('#menu-sync')]) {
    if (!btn) continue;
    btn.dataset.status = s;
    const text = btn.querySelector('.sync-label') || btn;
    text.textContent = label;
    btn.title = s === 'ok' ? 'Synced with Google Drive ' + timeAgo(syncStatus().lastSync) + ' — tap to sync now'
      : s === 'error' && err ? 'Sync error: ' + err : label;
  }
  $('#sync-disconnect').hidden = !loadSyncState().connected;
}

function tapSync() {
  const wasConnected = loadSyncState().connected;
  // no await before syncNow: Google's sign-in popup must open inside this tap
  syncNow({ interactive: true }).then(() => {
    const { status, error } = syncStatus();
    if (!wasConnected && status === 'ok') showToast('Connected to Google Drive');
    else if (status === 'error') showToast('Sync error: ' + error, 5000);
    else if (status === 'offline') showToast('Offline: will sync when back online');
  });
}

export function initSyncView() {
  if (!syncConfigured()) return; // no client ID: the feature stays hidden
  $('#sync-btn').hidden = false;
  $('#menu-sync').hidden = false;
  $('#sync-btn').addEventListener('click', tapSync);
  $('#menu-sync').addEventListener('click', () => { $('#library-menu').hidden = true; tapSync(); });
  $('#sync-disconnect').addEventListener('click', () => {
    $('#sidebar-settings-panel').hidden = true;
    disconnect();
    showToast('Disconnected from Google Drive (books stay on this device)');
  });
  setOnLocalChange(() => { if ($('#library-view').classList.contains('view--active')) loadLibrary(); });
  onSyncStatus(render);
  initSync();
}
