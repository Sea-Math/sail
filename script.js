(() => {
  const DEFAULT_WISP = "wss://wisp.rhw.one/";
  const SEARCH_ENGINES = [
    { name: "Brave", url: "https://search.brave.com/search?q=" },
    { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
    { name: "Google", url: "https://www.google.com/search?q=" },
  ];

  const WISP_SERVERS = [
    { name: "RHW (Default)", url: "wss://wisp.rhw.one/", badge: "Stable" },
    { name: "Mercury", url: "wss://wisp.mercurywork.shop/", badge: "Fast" },
    { name: "Wisp 200313", url: "wss://wisp.200313.xyz/", badge: "Backup" },
    { name: "Custom", url: "custom", badge: "Manual" },
  ];

  let scramjet;
  let connection;
  let swRegistration;
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
  const getActiveWisp = () => storageGet("proxServer") || DEFAULT_WISP;
  const getSearchEngine = () => {
    const saved = storageGet("searchEngineUrl");
    return SEARCH_ENGINES.some((e) => e.url === saved) ? saved : SEARCH_ENGINES[0].url;
  };

  const normalizeInput = (value) => {
    const input = (value ?? "").trim();
    if (!input) return "";
    if (input.toLowerCase() === "seabean://newtab") return "seabean://newtab";
    if (!input.startsWith("http")) {
      return input.includes(".") && !input.includes(" ")
        ? `https://${input}`
        : `${getSearchEngine()}${encodeURIComponent(input)}`;
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
          <button id="wisp-settings-btn" title="Settings"><i class="fa-solid fa-sliders"></i></button>
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

  async function pushSettingsToServiceWorker() {
    const payload = { type: "proxySettings" };
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    }
    if (swRegistration?.active) {
      swRegistration.active.postMessage(payload);
    }
  }

  async function initProxy() {
    if (!("serviceWorker" in navigator)) throw new Error("Service worker unsupported");
    swRegistration = await navigator.serviceWorker.register(`${getBasePath()}sw.js`, { scope: getBasePath() });
    await navigator.serviceWorker.ready;

    connection = new BareMux.BareMuxConnection(`${getBasePath()}baremux/worker.js`);
    await connection.setTransport(`${getBasePath()}libcurl/index.mjs`, [{ websocket: getActiveWisp() }]);

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
    await pushSettingsToServiceWorker();
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
    if (!tab) {
      bar.value = "";
      return;
    }
    bar.value = tab.isNewTab ? "seabean://newtab" : (tab.url || "");
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
      url: "seabean://newtab",
      isNewTab: true,
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

    if (normalized.toLowerCase() === "seabean://newtab") {
      tab.url = "seabean://newtab";
      tab.title = "New Tab";
      tab.isNewTab = true;
      tab.frame.src = `${getBasePath()}NT.html`;
      updateTabsUI();
      updateAddressBar();
      return;
    }

    tab.url = normalized;
    tab.isNewTab = false;
    tab.title = (() => {
      try { return new URL(normalized).hostname; } catch { return "Browsing"; }
    })();

    showLoading(true, normalized);
    updateLoadingBar(20);
    tab.frame.src = scramjet.encodeUrl(normalized);
    updateTabsUI();
    updateAddressBar();
  }

  async function applyProxySettings() {
    if (connection) {
      await connection.setTransport(`${getBasePath()}libcurl/index.mjs`, [{ websocket: getActiveWisp() }]);
    }
    await pushSettingsToServiceWorker();
  }

  function openSettings() {
    const modal = document.getElementById("wisp-settings-modal");
    const list = document.getElementById("server-list");
    const current = getActiveWisp();
    const engineSelect = document.getElementById("search-engine-select");

    list.innerHTML = "";
    WISP_SERVERS.forEach((server) => {
      const div = document.createElement("button");
      div.type = "button";
      div.className = `wisp-option ${server.url !== "custom" && current === server.url ? "active" : ""}`;
      div.innerHTML = `<span class="wisp-main"><strong>${server.name}</strong><small>${server.url === "custom" ? "Use custom input below" : server.url}</small></span><span class="wisp-badge">${server.badge}</span>`;
      div.onclick = async () => {
        if (server.url === "custom") return;
        storageSet("proxServer", server.url);
        await applyProxySettings();
        openSettings();
      };
      list.appendChild(div);
    });

    engineSelect.innerHTML = SEARCH_ENGINES
      .map((engine) => `<option value="${engine.url}">${engine.name}</option>`)
      .join("");
    engineSelect.value = getSearchEngine();

    modal.classList.remove("hidden");
  }

  window.addEventListener("message", (event) => {
    if (event?.data?.type === "navigate" && typeof event.data.url === "string") {
      navigate(event.data.url);
      return;
    }

    if (event?.data?.type === "searchEngineChanged") {
      updateAddressBar();
    }
  });

  window.addEventListener("storage", async (event) => {
    if (event.key === "proxServer") {
      await applyProxySettings();
    }
    if (event.key === "searchEngineUrl") {
      updateAddressBar();
    }
  });

  function wireUi() {
    document.getElementById("address-bar").addEventListener("keydown", (e) => {
      if (e.key === "Enter") navigate();
    });
    document.getElementById("reload-btn").onclick = () => getActiveTab()?.frame.contentWindow?.location.reload();
    document.getElementById("home-btn-nav").onclick = () => navigate("seabean://newtab");
    document.getElementById("back-btn").onclick = () => getActiveTab()?.frame.contentWindow?.history.back();
    document.getElementById("fwd-btn").onclick = () => getActiveTab()?.frame.contentWindow?.history.forward();
    document.getElementById("wisp-settings-btn").onclick = openSettings;

    document.getElementById("close-wisp-modal").onclick = () => document.getElementById("wisp-settings-modal").classList.add("hidden");
    document.getElementById("save-custom-wisp").onclick = async () => {
      const val = document.getElementById("custom-wisp-input").value.trim();
      if (!val) return;
      storageSet("proxServer", val);
      await applyProxySettings();
      openSettings();
    };

    document.getElementById("save-search-engine").onclick = () => {
      const selected = document.getElementById("search-engine-select").value;
      storageSet("searchEngineUrl", selected);
      updateAddressBar();
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
