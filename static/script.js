// script.js - needs the variable initialReport, which dashboard.html creates before loading this file.
  var HISTORY_LENGTH = 30;

  // Bootstrap class names for each level (65% and 85% rules from the project document)
  var LEVEL_BAR = { ok: "bg-success", warn: "bg-warning", danger: "bg-danger" };
  var LEVEL_TEXT = { ok: "text-success", warn: "text-warning", danger: "text-danger" };
  var LEVEL_BADGE = { ok: "text-bg-success", warn: "text-bg-warning", danger: "text-bg-danger" };
  var STATUS_BADGE = { live: "text-bg-success", paused: "text-bg-warning", offline: "text-bg-danger" };

  // One object that remembers everything the page needs between updates
  var state = {
    lastReport: initialReport,
    paused: false,
    isFetching: false,
    intervalMs: 3000,
    timerId: null,
    topCount: 5,
    sortKey: "memory_percent",
    sortDescending: true,
    searchText: "",
    cpuHistory: [],
    memoryHistory: [],
    downloadHistory: [],
    uploadHistory: [],
    previousNetwork: null
  };

  /* ---------------- Small helpers ---------------- */

  function byId(elementId) {
    return document.getElementById(elementId);
  }

  function setText(elementId, text) {
    byId(elementId).textContent = text;
  }

  function getLevel(percent) {
    if (percent > 85) {
      return "danger";
    }
    if (percent > 65) {
      return "warn";
    }
    return "ok";
  }

  function getLevelWord(percent) {
    var level = getLevel(percent);
    if (level === "danger") {
      return "Critical";
    }
    if (level === "warn") {
      return "Busy";
    }
    return "Healthy";
  }

  // Changes the width AND the colour of a Bootstrap progress bar
  function setBar(barElement, percent) {
    barElement.style.width = percent + "%";
    barElement.className = "progress-bar " + LEVEL_BAR[getLevel(percent)];
  }

  function setBadge(elementId, text, percent) {
    var badge = byId(elementId);
    badge.textContent = text;
    if (percent === null) {
      badge.className = "badge text-bg-secondary";
    } else {
      badge.className = "badge " + LEVEL_BADGE[getLevel(percent)];
    }
  }

  function setBigNumber(elementId, percent) {
    var big = byId(elementId);
    big.className = "display-4 fw-bold " + LEVEL_TEXT[getLevel(percent)];
    big.innerHTML = "";
    big.appendChild(document.createTextNode(percent));
    var unit = document.createElement("small");
    unit.className = "fs-4 text-body-secondary fw-normal";
    unit.textContent = "%";
    big.appendChild(unit);
  }

  function makeElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  // Builds a Bootstrap progress bar and returns the outer element
  function makeProgress(percent, height) {
    var track = makeElement("div", "progress");
    track.style.height = height + "px";
    track.setAttribute("role", "progressbar");
    var fill = makeElement("div", "progress-bar");
    setBar(fill, percent);
    track.appendChild(fill);
    return track;
  }

  function addToHistory(historyList, newValue) {
    historyList.push(newValue);
    if (historyList.length > HISTORY_LENGTH) {
      historyList.shift();
    }
  }

  function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond >= 1024 * 1024) {
      return (bytesPerSecond / (1024 * 1024)).toFixed(2) + " MB/s";
    }
    if (bytesPerSecond >= 1024) {
      return (bytesPerSecond / 1024).toFixed(1) + " KB/s";
    }
    return Math.round(bytesPerSecond) + " B/s";
  }

  function showToast(message) {
    setText("toast-text", message);
    bootstrap.Toast.getOrCreateInstance(byId("toast"), { delay: 2000 }).show();
  }

  // localStorage can be blocked in some browsers, so every use is wrapped
  function saveSetting(name, value) {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      // Not important, the setting just won't be remembered.
    }
  }

  function loadSetting(name, fallback) {
    try {
      var value = localStorage.getItem(name);
      if (value !== null) {
        return value;
      }
    } catch (error) {
      // Ignore and use the fallback.
    }
    return fallback;
  }

  /* ---------------- History graphs (drawn on <canvas>) ---------------- */

  function getCssColor(variableName) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  }

  // seriesList: [{values: [...], color: "--bs-info"}], fixedMax: 100 for percent graphs, 0 = automatic
  function drawChart(canvas, seriesList, fixedMax) {
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }

    var ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    var context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    // Work out the top of the graph
    var maxValue = fixedMax;
    if (!maxValue) {
      maxValue = 1024;
      for (var s = 0; s < seriesList.length; s++) {
        for (var v = 0; v < seriesList[s].values.length; v++) {
          if (seriesList[s].values[v] > maxValue) {
            maxValue = seriesList[s].values[v];
          }
        }
      }
      maxValue = maxValue * 1.15;
    }

    // Light horizontal guide lines
    context.strokeStyle = getCssColor("--bs-border-color");
    context.lineWidth = 1;
    for (var line = 1; line < 4; line++) {
      var lineY = Math.round((height / 4) * line) + 0.5;
      context.beginPath();
      context.moveTo(0, lineY);
      context.lineTo(width, lineY);
      context.stroke();
    }

    var padding = 6;
    var drawHeight = height - padding * 2;

    for (var i = 0; i < seriesList.length; i++) {
      var values = seriesList[i].values;
      if (values.length < 2) {
        continue;
      }
      var color = getCssColor(seriesList[i].color);
      var startSlot = HISTORY_LENGTH - values.length;

      context.beginPath();
      for (var j = 0; j < values.length; j++) {
        var x = ((startSlot + j) / (HISTORY_LENGTH - 1)) * width;
        var y = padding + drawHeight - (values[j] / maxValue) * drawHeight;
        if (j === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.lineJoin = "round";
      context.stroke();

      // Soft fill under the line
      context.lineTo(width, height);
      context.lineTo((startSlot / (HISTORY_LENGTH - 1)) * width, height);
      context.closePath();
      context.globalAlpha = 0.15;
      context.fillStyle = color;
      context.fill();
      context.globalAlpha = 1;
    }
    return maxValue;
  }

  function drawAllCharts() {
    drawChart(byId("cpu-chart"), [{ values: state.cpuHistory, color: "--bs-info" }], 100);
    drawChart(byId("mem-chart"), [{ values: state.memoryHistory, color: "--bs-purple" }], 100);
    var top = drawChart(byId("net-chart"), [
      { values: state.downloadHistory, color: "--bs-info" },
      { values: state.uploadHistory, color: "--bs-purple" }
    ], 0);
    if (top) {
      setText("net-scale", "max " + formatSpeed(top));
    }
  }

  /* ---------------- One update function per card ---------------- */

  function updateHeader(system, generatedAt) {
    setText("header-info", system.hostname + " · " + system.os_name + " " + system.os_version + " · Python " + system.python_version);
    setText("last-update", generatedAt);
    document.title = system.hostname + " · System Health";
  }

  function updateCpu(cpu) {
    setBigNumber("cpu-percent", cpu.usage_percent);
    setBar(byId("cpu-bar"), cpu.usage_percent);
    setBadge("cpu-badge", getLevelWord(cpu.usage_percent), cpu.usage_percent);
    setText("cpu-physical", cpu.physical_cores);
    setText("cpu-logical", cpu.logical_cores);

    var coreList = byId("core-list");
    coreList.innerHTML = "";
    for (var i = 0; i < cpu.per_core_usage.length; i++) {
      var usage = cpu.per_core_usage[i];
      var column = makeElement("div", "col");

      var label = makeElement("div", "d-flex justify-content-between small text-body-secondary");
      label.appendChild(makeElement("span", "", "Core " + i));
      label.appendChild(makeElement("span", "", usage + "%"));

      column.appendChild(label);
      column.appendChild(makeProgress(usage, 6));
      coreList.appendChild(column);
    }
  }

  function updateMemory(memory) {
    setBigNumber("mem-percent", memory.percent_used);
    setBar(byId("mem-bar"), memory.percent_used);
    setBadge("mem-badge", getLevelWord(memory.percent_used), memory.percent_used);
    setText("mem-total", memory.total_gb + " GB");
    setText("mem-used", memory.used_gb + " GB");
    setText("mem-available", memory.available_gb + " GB");
    if (memory.swap.total_gb === 0) {
      setText("mem-swap", "No swap configured");
    } else {
      setText("mem-swap", memory.swap.used_gb + " / " + memory.swap.total_gb + " GB (" + memory.swap.percent_used + "%)");
    }
  }

  function updateSystem(system, battery) {
    setText("sys-user", system.current_user);
    setText("sys-os", system.os_name + " " + system.os_version);
    setText("sys-arch", system.architecture);
    setText("sys-boot", system.boot_time);
    setText("sys-uptime", system.uptime);

    var barWrap = byId("battery-bar-wrap");
    if (battery.has_battery) {
      setText("sys-battery", battery.percent + "% · " + battery.message);
      setBadge("battery-badge", "Battery " + battery.percent + "%", null);
      barWrap.classList.remove("d-none");

      // For a battery, LOW is bad, so the colour logic is flipped
      var batteryBar = byId("battery-bar");
      batteryBar.style.width = battery.percent + "%";
      var batteryLevel = "ok";
      if (battery.percent < 15) {
        batteryLevel = "danger";
      } else if (battery.percent < 35) {
        batteryLevel = "warn";
      }
      batteryBar.className = "progress-bar " + LEVEL_BAR[batteryLevel];
    } else {
      setText("sys-battery", battery.message);
      setBadge("battery-badge", "Desktop", null);
      barWrap.classList.add("d-none");
    }
  }

  function updateDisks(diskInfo) {
    var diskList = byId("disk-list");
    diskList.innerHTML = "";

    var worstPercent = 0;
    for (var i = 0; i < diskInfo.disks.length; i++) {
      var disk = diskInfo.disks[i];
      if (disk.percent_used > worstPercent) {
        worstPercent = disk.percent_used;
      }

      var item = makeElement("div", "mb-3");
      var title = makeElement("div", "d-flex justify-content-between gap-2 small mb-1");
      title.appendChild(makeElement("span", "fw-semibold text-break", disk.mount_point));
      title.appendChild(makeElement("span", "text-body-secondary text-end", disk.used_gb + " / " + disk.total_gb + " GB · " + disk.free_gb + " GB free (" + disk.percent_used + "%)"));

      item.appendChild(title);
      item.appendChild(makeProgress(disk.percent_used, 12));
      diskList.appendChild(item);
    }

    if (diskInfo.disks.length === 0) {
      diskList.appendChild(makeElement("div", "text-center text-body-secondary py-3", "No readable disks found"));
    }
    setBadge("disk-badge", diskInfo.disks.length + " disk(s)", diskInfo.disks.length > 0 ? worstPercent : null);

    if (diskInfo.unreadable_disks.length > 0) {
      setText("disk-note", "Could not read: " + diskInfo.unreadable_disks.join(", "));
    } else {
      setText("disk-note", "");
    }
  }

  function updateNetwork(network) {
    if (!network.available) {
      setBadge("net-badge", "Unavailable", null);
      setText("net-down", "–");
      setText("net-up", "–");
      return;
    }

    setText("net-received", network.received_gb + " GB");
    setText("net-sent", network.sent_gb + " GB");
    setText("net-errors", network.errors);

    // Speed = how many bytes arrived since the last reading, divided by the seconds that passed
    var now = performance.now();
    if (state.previousNetwork !== null) {
      var seconds = (now - state.previousNetwork.time) / 1000;
      if (seconds > 0) {
        var downloadSpeed = (network.bytes_received - state.previousNetwork.received) / seconds;
        var uploadSpeed = (network.bytes_sent - state.previousNetwork.sent) / seconds;
        if (downloadSpeed < 0) { downloadSpeed = 0; }
        if (uploadSpeed < 0) { uploadSpeed = 0; }
        setText("net-down", formatSpeed(downloadSpeed));
        setText("net-up", formatSpeed(uploadSpeed));
        addToHistory(state.downloadHistory, downloadSpeed);
        addToHistory(state.uploadHistory, uploadSpeed);
        byId("net-badge").className = "badge text-bg-success";
        byId("net-badge").textContent = "Online";
      }
    } else {
      setText("net-down", "measuring…");
      setText("net-up", "measuring…");
    }
    state.previousNetwork = { time: now, received: network.bytes_received, sent: network.bytes_sent };
  }

  /* ---------------- Process table (search + sort) ---------------- */

  function compareProcesses(firstProcess, secondProcess) {
    var firstValue = firstProcess[state.sortKey];
    var secondValue = secondProcess[state.sortKey];
    if (state.sortKey === "name") {
      firstValue = firstValue.toLowerCase();
      secondValue = secondValue.toLowerCase();
    }
    var result = 0;
    if (firstValue < secondValue) {
      result = -1;
    } else if (firstValue > secondValue) {
      result = 1;
    }
    if (state.sortDescending) {
      result = -result;
    }
    return result;
  }

  function updateSortArrows() {
    var headers = document.querySelectorAll("th[data-sort]");
    for (var i = 0; i < headers.length; i++) {
      var arrow = headers[i].querySelector(".arrow");
      if (headers[i].getAttribute("data-sort") === state.sortKey) {
        arrow.textContent = state.sortDescending ? "▼" : "▲";
      } else {
        arrow.textContent = "";
      }
    }
  }

  function renderProcesses() {
    var allProcesses = state.lastReport.processes.top_processes;
    var search = state.searchText.toLowerCase();

    var shown = [];
    for (var i = 0; i < allProcesses.length; i++) {
      var process = allProcesses[i];
      var matches = search === "" ||
        process.name.toLowerCase().indexOf(search) !== -1 ||
        String(process.pid).indexOf(search) !== -1;
      if (matches) {
        shown.push(process);
      }
    }
    shown.sort(compareProcesses);

    // The bar is scaled against the biggest memory user so differences are easy to see
    var biggest = 0;
    for (var b = 0; b < allProcesses.length; b++) {
      if (allProcesses[b].memory_percent > biggest) {
        biggest = allProcesses[b].memory_percent;
      }
    }

    var body = byId("process-body");
    body.innerHTML = "";

    if (shown.length === 0) {
      var emptyRow = makeElement("tr");
      var emptyCell = makeElement("td", "text-center text-body-secondary py-4", "No processes match your search");
      emptyCell.colSpan = 3;
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
    }

    for (var j = 0; j < shown.length; j++) {
      var row = makeElement("tr");
      row.appendChild(makeElement("td", "", shown[j].pid));
      // textContent (not innerHTML) so odd process names can never inject HTML
      row.appendChild(makeElement("td", "name-cell", shown[j].name));

      var relative = 0;
      if (biggest > 0) {
        relative = (shown[j].memory_percent / biggest) * 100;
      }
      var memoryCell = makeElement("td", "mem-cell");
      var inner = makeElement("div", "d-flex align-items-center gap-2");
      var track = makeElement("div", "progress flex-grow-1");
      track.style.height = "8px";
      var fill = makeElement("div", "progress-bar");
      fill.style.width = relative + "%";
      fill.className = "progress-bar " + LEVEL_BAR[getLevel(shown[j].memory_percent * 10)];
      track.appendChild(fill);
      inner.appendChild(track);
      inner.appendChild(makeElement("span", "mem-percent-text", shown[j].memory_percent + "%"));
      memoryCell.appendChild(inner);
      row.appendChild(memoryCell);

      body.appendChild(row);
    }

    setBadge("proc-badge", shown.length + " shown", null);
    updateSortArrows();
  }

  /* ---------------- Alerts ---------------- */

  function updateAlerts(report) {
    var problems = [];
    if (report.memory.percent_used > 90) {
      problems.push("Memory is above 90% (" + report.memory.percent_used + "%). Close some programs.");
    }
    if (report.cpu.usage_percent > 90) {
      problems.push("CPU is above 90% (" + report.cpu.usage_percent + "%).");
    }
    for (var i = 0; i < report.disks.disks.length; i++) {
      if (report.disks.disks[i].percent_used > 90 && report.disks.disks[i].total_gb >= 1) {
        problems.push("Disk " + report.disks.disks[i].mount_point + " is almost full (" + report.disks.disks[i].percent_used + "%).");
      }
    }

    var banner = byId("alert-banner");
    if (problems.length === 0) {
      banner.classList.add("d-none");
      return;
    }
    banner.innerHTML = "";
    banner.appendChild(makeElement("strong", "", "Warning: "));
    banner.appendChild(document.createTextNode(problems.join("  ·  ")));
    banner.classList.remove("d-none");
  }

  /* ---------------- Put one report on the page ---------------- */

  function showReport(report) {
    state.lastReport = report;
    addToHistory(state.cpuHistory, report.cpu.usage_percent);
    addToHistory(state.memoryHistory, report.memory.percent_used);

    updateHeader(report.system, report.generated_at);
    updateCpu(report.cpu);
    updateMemory(report.memory);
    updateSystem(report.system, report.battery);
    updateDisks(report.disks);
    updateNetwork(report.network);
    renderProcesses();
    updateAlerts(report);
    drawAllCharts();
  }

  /* ---------------- Talking to the server ---------------- */

  function setStatus(kind, text) {
    byId("status-pill").className = "badge rounded-pill fs-6 fw-normal " + STATUS_BADGE[kind];
    setText("status-text", text);
  }

  // Restarts the thin progress bar at the top of the page
  function restartTickBar() {
    var tickBar = byId("tick-bar");
    tickBar.className = "";
    void tickBar.offsetWidth;   // forces the browser to restart the animation
    if (!state.paused) {
      tickBar.style.animationDuration = state.intervalMs + "ms";
      tickBar.className = "running";
    }
  }

  function refreshData() {
    // No need to ask for data while paused, hidden, or when the last request is still running
    if (state.paused || document.hidden || state.isFetching) {
      return;
    }
    state.isFetching = true;

    fetch("/api/health?top=" + state.topCount)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Server answered " + response.status);
        }
        return response.json();
      })
      .then(function (report) {
        showReport(report);
        setStatus("live", "Live");
        restartTickBar();
      })
      .catch(function (error) {
        // Keep the old numbers on screen and show that the server is not answering
        setStatus("offline", "Offline – retrying");
      })
      .then(function () {
        state.isFetching = false;
      });
  }

  function startTimer() {
    if (state.timerId !== null) {
      clearInterval(state.timerId);
    }
    state.timerId = setInterval(refreshData, state.intervalMs);
    restartTickBar();
  }

  /* ---------------- Buttons and inputs ---------------- */

  function togglePause() {
    state.paused = !state.paused;
    byId("pause-button").textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) {
      setStatus("paused", "Paused");
      restartTickBar();
    } else {
      setStatus("live", "Live");
      refreshData();
      restartTickBar();
    }
  }

  function downloadReport() {
    var text = JSON.stringify(state.lastReport, null, 2);
    var blob = new Blob([text], { type: "application/json" });
    var link = document.createElement("a");
    var stamp = state.lastReport.generated_at.replace(/[: ]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = "health-report-" + stamp + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showToast("Report downloaded");
  }

  // Bootstrap 5.3 switches colours automatically when data-bs-theme changes
  function applyTheme(themeName) {
    document.documentElement.setAttribute("data-bs-theme", themeName);
    byId("theme-button").textContent = themeName === "dark" ? "Light mode" : "Dark mode";
    saveSetting("theme", themeName);
    drawAllCharts();
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-bs-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function changeSort(event) {
    var header = event.target.closest("th[data-sort]");
    if (header === null) {
      return;
    }
    var newKey = header.getAttribute("data-sort");
    if (newKey === state.sortKey) {
      state.sortDescending = !state.sortDescending;
    } else {
      state.sortKey = newKey;
      // Names read best A to Z, numbers read best biggest first
      state.sortDescending = newKey !== "name";
    }
    renderProcesses();
  }

  function setupControls() {
    byId("pause-button").addEventListener("click", togglePause);
    byId("download-button").addEventListener("click", downloadReport);
    byId("theme-button").addEventListener("click", toggleTheme);
    document.querySelector("thead").addEventListener("click", changeSort);

    byId("interval-select").addEventListener("change", function (event) {
      state.intervalMs = parseInt(event.target.value, 10);
      saveSetting("interval", state.intervalMs);
      startTimer();
    });

    byId("top-select").addEventListener("change", function (event) {
      state.topCount = parseInt(event.target.value, 10);
      saveSetting("topCount", state.topCount);
      refreshData();
    });

    byId("process-search").addEventListener("input", function (event) {
      state.searchText = event.target.value.trim();
      renderProcesses();
    });

    window.addEventListener("resize", drawAllCharts);

    // When the user comes back to the tab, update straight away
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        refreshData();
      }
    });
  }

  /* ---------------- Start ---------------- */

  function startPage() {
    // Restore the user's saved choices
    var savedTheme = loadSetting("theme", "dark");
    applyTheme(savedTheme === "light" ? "light" : "dark");

    var savedInterval = parseInt(loadSetting("interval", "3000"), 10);
    var savedTop = parseInt(loadSetting("topCount", "5"), 10);
    if ([1000, 2000, 3000, 5000, 10000].indexOf(savedInterval) !== -1) {
      state.intervalMs = savedInterval;
    }
    if ([5, 10, 15, 20].indexOf(savedTop) !== -1) {
      state.topCount = savedTop;
    }
    byId("interval-select").value = String(state.intervalMs);
    byId("top-select").value = String(state.topCount);

    setupControls();
    showReport(initialReport);
    startTimer();

    // If the saved list size is bigger than what Flask rendered, fetch straight away
    if (state.topCount !== 5) {
      refreshData();
    }
  }

  startPage();
