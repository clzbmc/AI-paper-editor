import { state } from './state.js?v=20260625-codemirror-editor';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('papercraft-ai', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheProject(serializeProjectFiles) {
  const db = await openDatabase();
  const files = await serializeProjectFiles();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({
      name: state.projectName,
      currentPath: state.currentPath,
      files,
      updatedAt: Date.now(),
    }, 'active');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function getCachedProject() {
  const db = await openDatabase();
  const project = await new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get('active');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return project;
}
