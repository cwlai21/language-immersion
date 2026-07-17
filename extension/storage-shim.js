// Lets the dashboard run outside the extension (e.g. GitHub Pages): if the
// chrome.storage API is missing, emulate chrome.storage.sync on localStorage.
// Inside the extension this is a no-op.
if (typeof chrome === 'undefined' || !chrome.storage) {
  const area = (KEY) => {
    const read = () => {
      try {
        return JSON.parse(localStorage.getItem(KEY)) || {};
      } catch {
        return {};
      }
    };
    return {
      get: async () => read(),
      set: async (obj) => {
        localStorage.setItem(KEY, JSON.stringify({ ...read(), ...obj }));
      },
    };
  };
  window.chrome = {
    ...(window.chrome || {}),
    storage: {
      sync: area('ecoute.settings'),
      local: area('ecoute.local'),
    },
  };
}
