const API_BASE = window.location.origin;

const state = {
  jobs: [],
  counts: { all: 0, queued: 0, active: 0, failed: 0, succeeded: 0 },
  workflows: [],
  view: "board",
};

const elements = {
  statusLine: document.querySelector("#statusLine"),
  navRunCount: document.querySelector("#navRunCount"),
  countAll: document.querySelector("#countAll"),
  countActive: document.querySelector("#countActive"),
  countFailed: document.querySelector("#countFailed"),
  countSucceeded: document.querySelector("#countSucceeded"),
  queuedCount: document.querySelector("#queuedCount"),
  runningCount: document.querySelector("#runningCount"),
  finishedCount: document.querySelector("#finishedCount"),
  queuedList: document.querySelector("#queuedList"),
  runningList: document.querySelector("#runningList"),
  finishedList: document.querySelector("#finishedList"),
  boardView: document.querySelector("#boardView"),
  tableView: document.querySelector("#tableView"),
  jobsTableBody: document.querySelector("#jobsTableBody"),
  detailDrawer: document.querySelector("#detailDrawer"),
  detailTitle: document.querySelector("#detailTitle"),
  detailBody: document.querySelector("#detailBody"),
  newRunDialog: document.querySelector("#newRunDialog"),
  workflowSelect: document.querySelector("#workflowSelect"),
  newRunForm: document.querySelector("#newRunForm"),
};

document.querySelector("#newRunButton").addEventListener("click", () => {
  elements.newRunDialog.showModal();
});

document.querySelector("#closeDialogButton").addEventListener("click", () => {
  elements.newRunDialog.close();
});

document.querySelector("#cancelRunButton").addEventListener("click", () => {
  elements.newRunDialog.close();
});

document.querySelector("#closeDrawerButton").addEventListener("click", closeDrawer);

document.querySelectorAll(".view-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll(".view-button").forEach((item) => item.classList.toggle("active", item === button));
    elements.boardView.classList.toggle("hidden", state.view !== "board");
    elements.tableView.classList.toggle("hidden", state.view !== "table");
  });
});

elements.newRunForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(elements.newRunForm);
  const payload = {
    workflowId: formData.get("workflowId"),
    title: formData.get("title"),
    description: formData.get("description"),
  };

  await apiFetch("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  elements.newRunForm.reset();
  elements.newRunDialog.close();
  await refreshJobs();
  setTimeout(refreshJobs, 1500);
});

async function init() {
  await Promise.all([loadWorkflows(), refreshJobs()]);
  setInterval(refreshJobs, 10000);
}

async function loadWorkflows() {
  const data = await apiFetch("/workflows");
  state.workflows = data.workflows || [];

  elements.workflowSelect.innerHTML = state.workflows
    .map((workflow) => `<option value="${escapeHtml(workflow.workflowId)}">${escapeHtml(workflow.name)}</option>`)
    .join("");
}

async function refreshJobs() {
  elements.statusLine.textContent = "Refreshing runs";
  const data = await apiFetch("/jobs");
  state.jobs = data.jobs || [];
  state.counts = data.counts || state.counts;
  render();
  elements.statusLine.textContent = `${state.jobs.length} runs`;
}

function render() {
  renderCounts();
  renderBoard();
  renderTable();
}

function renderCounts() {
  elements.navRunCount.textContent = state.counts.all;
  elements.countAll.textContent = state.counts.all;
  elements.countActive.textContent = state.counts.active;
  elements.countFailed.textContent = state.counts.failed;
  elements.countSucceeded.textContent = state.counts.succeeded;

  elements.queuedCount.textContent = countByLane("queued");
  elements.runningCount.textContent = countByLane("running");
  elements.finishedCount.textContent = countByLane("finished");
}

function renderBoard() {
  const lanes = {
    queued: elements.queuedList,
    running: elements.runningList,
    finished: elements.finishedList,
  };

  Object.values(lanes).forEach((lane) => {
    lane.innerHTML = "";
  });

  state.jobs.forEach((job) => {
    lanes[laneForStatus(job.status)].appendChild(createRunCard(job));
  });

  Object.entries(lanes).forEach(([laneName, lane]) => {
    if (!lane.children.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = laneName === "queued" ? "No runs" : "No active runs";
      lane.appendChild(empty);
    }
  });
}

function renderTable() {
  elements.jobsTableBody.innerHTML = "";

  state.jobs.forEach((job) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${escapeHtml(job.title || "Untitled run")}</strong><div class="meta">${shortId(job.jobId)}</div></td>
      <td>${escapeHtml(job.workflowId || "")}</td>
      <td>${statusBadge(job.status)}</td>
      <td>${relativeTime(job.updatedAt)}</td>
      <td>${escapeHtml(job.latestEventMessage || "")}</td>
    `;
    row.addEventListener("click", () => openDetails(job.jobId));
    elements.jobsTableBody.appendChild(row);
  });
}

function createRunCard(job) {
  const card = document.createElement("button");
  card.className = "run-card";
  card.type = "button";
  card.innerHTML = `
    <div class="card-top">
      <h3>${escapeHtml(job.title || "Untitled run")}</h3>
      ${statusBadge(job.status)}
    </div>
    <div class="meta">${shortId(job.jobId)} · ${escapeHtml(job.workflowId || "")}</div>
    <div class="meta">${escapeHtml(job.latestEventMessage || "")}</div>
    <div class="meta-row">
      <span>▤ Lambda worker</span>
      <span>${relativeTime(job.updatedAt)}</span>
    </div>
  `;
  card.addEventListener("click", () => openDetails(job.jobId));
  return card;
}

async function openDetails(jobId) {
  elements.detailDrawer.classList.add("open");
  elements.detailDrawer.setAttribute("aria-hidden", "false");
  elements.detailTitle.textContent = "Loading run";
  elements.detailBody.innerHTML = "";

  const job = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`);
  const events = await apiFetch(`/jobs/${encodeURIComponent(jobId)}/events`);

  elements.detailTitle.textContent = job.title || "Untitled run";
  elements.detailBody.innerHTML = `
    <div class="detail-block">
      <div class="meta">Status</div>
      ${statusBadge(job.status)}
    </div>
    <div class="detail-block">
      <div class="meta">Description</div>
      <p>${escapeHtml(job.description || "")}</p>
    </div>
    <div class="detail-block">
      <div class="meta">Workflow</div>
      <p>${escapeHtml(job.workflowId || "")}</p>
    </div>
    <div class="detail-block">
      <div class="meta">Timeline</div>
      <div class="timeline">
        ${(events.events || []).map(renderTimelineItem).join("")}
      </div>
    </div>
  `;
}

function closeDrawer() {
  elements.detailDrawer.classList.remove("open");
  elements.detailDrawer.setAttribute("aria-hidden", "true");
}

function renderTimelineItem(event) {
  return `
    <div class="timeline-item">
      <strong>${escapeHtml(event.type || "")}</strong>
      <span>${escapeHtml(event.timestamp || "")}</span>
      <p>${escapeHtml(event.message || "")}</p>
    </div>
  `;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.message || `Request failed with ${response.status}`);
  }

  return data;
}

function laneForStatus(status) {
  if (status === "PICKED_UP") {
    return "running";
  }
  if (status === "ACKNOWLEDGED" || status === "FAILED") {
    return "finished";
  }
  return "queued";
}

function countByLane(lane) {
  return state.jobs.filter((job) => laneForStatus(job.status) === lane).length;
}

function statusBadge(status) {
  const normalized = (status || "UNKNOWN").toLowerCase();
  const className = normalized === "picked_up" ? "running" : normalized;
  const label = statusLabel(status);
  return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
}

function statusLabel(status) {
  const labels = {
    SUBMITTED: "Submitted",
    QUEUED: "Queued",
    PICKED_UP: "Running",
    ACKNOWLEDGED: "Succeeded",
    FAILED: "Failed",
  };
  return labels[status] || status || "Unknown";
}

function shortId(id) {
  return id ? `#${id.slice(0, 8)}` : "";
}

function relativeTime(value) {
  if (!value) {
    return "";
  }

  const timestamp = new Date(value).getTime();
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m ago`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)}h ago`;
  }
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  elements.statusLine.textContent = error.message;
});
