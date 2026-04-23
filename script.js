(() => {
  const DEFAULT_WISP = "wss://wisp.rhw.one/";

  let scramjet;
  let tabs = [];
  let activeTabId = null;
  let nextTabId = 1;

  const storageGet = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const storageSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
  };

  const getBasePath = () => "/sail/";

  const normalizeInput = (value) => {
    const input = (value ?? "").trim();
    if (!input) return "";
    if (!input.startsWith("http")) {
      return input.includes(".") && !input.includes(" ")
        ? `https://${input}`
        : `https://search.brave.com/search?q=${encodeURIComponent(input)}`;
    }
    return input;
  };

  function renderBrowserShell() {
    const root = document.getElementById("app");
    root.innerHTML = `
      <div class="browser-container">
        <div class="tabs" id="tabs-container"></div>
        <div class="nav">
          <button id="back-btn" title="Back"><i class="fa-solid fa-arrow-left"></i></button>
          <button id="fwd-btn" title="Forward"><i class="fa-solid fa-arrow-right"></i></button>
          <button id="reload-btn" title="Reload"><i class="fa-solid fa-rotate-right"></i></button>
          <div class="address-wrapper">
            <input id="address-bar" class="bar" placeholder="Search or enter URL" autocomplete="off" />
            <button id="home-btn-nav" title="New tab"><i class="fa-solid fa-house"></i></button>
          </div>
          <button id="wisp-settings-btn" title="Proxy settings"><i class="fa-solid fa-server"></i></button>
        </div>
        <div class="loading-bar-container"><div id="loading-bar" class="loading-bar"></div></div>
        <div class="iframe-container" id="iframe-container">
          <div id="loading" class="message-container">
            <div class="message-content">
              <div class="spinner"></div>
              <h1 id="loading-title">Connecting</h1>
              <p id="loading-url">Initializing proxy...</p>
              <button id="skip-btn">Skip</button>
            </div>
          </div>
          <div id="error" class="message-container">
            <div class="message-content">
              <h1>Connection Error</h1>
              <p id="error-message">An error occurred.</p>
              <button id="retry-error-btn">Retry</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function initProxy() {
    if (!("serviceWorker" in navigator)) throw new Error("Service worker unsupported");
    await navigator.serviceWorker.register(`${getBasePath()}sw.js`, { scope: getBasePath() });
    await navigator.serviceWorker.ready;

    const connection = new BareMux.BareMuxConnection(`${getBasePath()}baremux/worker.js`);
    await connection.setTransport(`${getBasePath()}libcurl/index.mjs`, [{ websocket: storageGet("proxServer") || DEFAULT_WISP }]);

    const { ScramjetController } = $scramjetLoadController();
    scramjet = new ScramjetController({
      prefix: `${getBasePath()}go/`,
      files: {
        wasm: `${getBasePath()}scram/scramjet.wasm.wasm`,
        all: `${getBasePath()}scram/scramjet.all.js`,
        sync: `${getBasePath()}scram/scramjet.sync.js`,
      },
    });
    await scramjet.init();
  }

  const getActiveTab = () => tabs.find((t) => t.id === activeTabId);

  function showLoading(show, url = "") {
    const loading = document.getElementById("loading");
    loading.style.display = show ? "flex" : "none";
    document.getElementById("loading-url").textContent = url || "Initializing proxy...";
    document.getElementById("skip-btn").style.display = show ? "inline-block" : "none";
  }

  function updateLoadingBar(percent) {
    const bar = document.getElementById("loading-bar");
    bar.style.width = `${percent}%`;
    bar.style.opacity = percent === 100 ? "0" : "1";
    if (percent === 100) setTimeout(() => { bar.style.width = "0%"; }, 180);
  }

  function updateTabsUI() {
    const container = document.getElementById("tabs-container");
    container.innerHTML = "";

    tabs.forEach((tab) => {
      const el = document.createElement("div");
      el.className = `tab ${tab.id === activeTabId ? "active" : ""}`;
      el.innerHTML = `<div class="tab-title">${tab.title}</div><div class="tab-close">×</div>`;
      el.onclick = () => switchTab(tab.id);
      el.querySelector(".tab-close").onclick = (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      };
      container.appendChild(el);
    });

    const add = document.createElement("button");
    add.className = "new-tab";
    add.innerHTML = '<i class="fa-solid fa-plus"></i>';
    add.onclick = () => createTab(true);
    container.appendChild(add);
  }

  function updateAddressBar() {
    const tab = getActiveTab();
    const bar = document.getElementById("address-bar");
    bar.value = tab?.url?.includes("NT.html") ? "" : (tab?.url || "");
  }

  function switchTab(id) {
    activeTabId = id;
    tabs.forEach((t) => t.frame.classList.toggle("hidden", t.id !== id));
    document.getElementById("error").style.display = "none";
    updateTabsUI();
    updateAddressBar();
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [tab] = tabs.splice(idx, 1);
    tab.frame.remove();
    if (!tabs.length) {
      createTab(true);
      return;
    }
    if (id === activeTabId) switchTab(tabs[Math.max(0, idx - 1)].id);
    else updateTabsUI();
  }

  function createTab(makeActive = true) {
    const frame = document.createElement("iframe");
    frame.src = `${getBasePath()}NT.html`;
    frame.className = "hidden";

    const tab = {
      id: nextTabId++,
      title: "New Tab",
      url: `${getBasePath()}NT.html`,
      frame,
    };

    frame.addEventListener("load", () => {
      showLoading(false);
      updateLoadingBar(100);
    });

    document.getElementById("iframe-container").appendChild(frame);
    tabs.push(tab);
    if (makeActive) switchTab(tab.id);
    updateTabsUI();
    return tab;
  }

  function navigate(inputValue) {
    const tab = getActiveTab();
    if (!tab || !scramjet) return;
    const normalized = normalizeInput(inputValue ?? document.getElementById("address-bar").value);
    if (!normalized) return;

    tab.url = normalized;
    tab.title = (() => {
      try { return new URL(normalized).hostname; } catch { return "Browsing"; }
    })();

    showLoading(true, normalized);
    updateLoadingBar(20);
    tab.frame.src = scramjet.encodeUrl(normalized);
    updateTabsUI();
    updateAddressBar();
  }

  function openSettings() {
    const modal = document.getElementById("wisp-settings-modal");
    const list = document.getElementById("server-list");
    const current = storageGet("proxServer") || DEFAULT_WISP;
    list.innerHTML = `<div class="wisp-option active"><strong>Current</strong><div>${current}</div></div>`;
    modal.classList.remove("hidden");
  }

  window.addEventListener("message", (event) => {
    if (event?.data?.type === "navigate" && typeof event.data.url === "string") {
      navigate(event.data.url);
    }
  });

  function wireUi() {
    document.getElementById("address-bar").addEventListener("keydown", (e) => {
      if (e.key === "Enter") navigate();
    });
    document.getElementById("reload-btn").onclick = () => getActiveTab()?.frame.contentWindow?.location.reload();
    document.getElementById("home-btn-nav").onclick = () => {
      const tab = getActiveTab();
      if (!tab) return;
      tab.url = `${getBasePath()}NT.html`;
      tab.title = "New Tab";
      tab.frame.src = tab.url;
      updateTabsUI();
      updateAddressBar();
    };
    document.getElementById("back-btn").onclick = () => getActiveTab()?.frame.contentWindow?.history.back();
    document.getElementById("fwd-btn").onclick = () => getActiveTab()?.frame.contentWindow?.history.forward();
    document.getElementById("wisp-settings-btn").onclick = openSettings;

    document.getElementById("close-wisp-modal").onclick = () => document.getElementById("wisp-settings-modal").classList.add("hidden");
    document.getElementById("save-custom-wisp").onclick = () => {
      const val = document.getElementById("custom-wisp-input").value.trim();
      if (!val) return;
      storageSet("proxServer", val);
      openSettings();
    };

    document.getElementById("skip-btn").onclick = () => showLoading(false);
    document.getElementById("retry-error-btn").onclick = () => {
      document.getElementById("error").style.display = "none";
      navigate(getActiveTab()?.url);
    };
  }

  (async () => {
    renderBrowserShell();
    wireUi();
    createTab(true);

    try {
      showLoading(true);
      await initProxy();
      showLoading(false);
    } catch (err) {
      console.error(err);
      document.getElementById("error-message").textContent = "The proxy failed to initialize.";
      document.getElementById("error").style.display = "flex";
    }
  })();
})();
