// src/content/marker.ts — patch_ext_check (extension 0.1.4)
// Runs only on the Verisphere app's own pages: marks the document so the app can hide its "Install the extension"
// button once the extension is there. Nothing else — no reads, no messages.
document.documentElement.dataset.verisphereExt = chrome.runtime.getManifest().version;
