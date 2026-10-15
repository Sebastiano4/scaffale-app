export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return false; }
}

export async function storageInfo() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usedMB: usage / 1048576, quotaMB: quota / 1048576, persisted };
  } catch (e) { return null; }
}

export function formatStorageInfo(info) {
  if (!info) return 'Storage: unavailable';
  const fmt = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(mb < 10 ? 1 : 0) + ' MB');
  return 'Storage: ' + fmt(info.usedMB) + ' used of ' + fmt(info.quotaMB) +
    ' · ' + (info.persisted ? 'Protected' : 'Not protected');
}
