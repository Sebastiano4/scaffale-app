import { initTheme } from './js/theme.js';
import { initReadingTimeTracking } from './js/stats.js';
import { initLibrary, loadLibrary } from './js/library.js';
import { initMetadataModal } from './js/metadata-modal.js';
import { initBackup } from './js/backup.js';
import { initStatsView } from './js/stats-view.js';
import { initReader } from './js/reader.js';
import { initReaderSelection } from './js/reader-selection.js';
import { initReaderPanel } from './js/reader-panel.js';
import { initReaderSearch } from './js/reader-search.js';
import { initTouchSelect } from './js/reader-touch-select.js';
import { initImmersive } from './js/immersive.js';
import { initDictionary } from './js/dictionary-view.js';

initTheme();
initReadingTimeTracking();
initLibrary();
initMetadataModal();
initBackup();
initStatsView();
initReader();
initReaderSelection();
initReaderPanel();
initReaderSearch();
initTouchSelect();
initImmersive();
initDictionary();
loadLibrary();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
