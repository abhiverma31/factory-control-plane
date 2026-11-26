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
  needsInputCount: document.querySelector("#needsInputCount"),
  finishedCount: document.querySelector("#finishedCount"),
  queuedList: document.querySelector("#queuedList"),
  runningList: document.querySelector("#runningList"),
  needsInputList: document.querySelector("#needsInputList"),
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
  refreshButton: document.querySelector("#refreshButton"),
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

elements.refreshButton.addEventListener("click", refreshJobs);

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
  elements.needsInputCount.textContent = countByLane("needs-input");
  elements.finishedCount.textContent = countByLane("finished");
}

function renderBoard() {
  const lanes = {
    queued: elements.queuedList,
    running: elements.runningList,
    "needs-input": elements.needsInputList,
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
      <td>${summaryMessage(job)}${prLink(job)}</td>
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
    <div class="meta">${summaryMessage(job)}</div>
    <div class="meta-row">
      <span>▤ Lambda worker</span>
      <span>${relativeTime(job.updatedAt)}</span>
    </div>
    ${prLink(job)}
  `;
  card.addEventListener("click", () => openDetails(job.jobId));
  card.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
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
      <div class="meta">Job ID</div>
      <p>${escapeHtml(job.jobId || "")}</p>
    </div>
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
    ${renderClarificationPanel(job)}
    ${renderPrdOutput(events.events || [])}
    <div class="detail-block">
      <div class="meta">Timeline</div>
      <div class="timeline">
        ${(events.events || []).map(renderTimelineItem).join("")}
      </div>
    </div>
  `;
  bindClarificationForm(job);
}

function renderClarificationPanel(job) {
  if (job.status !== "NEEDS_CLARIFICATION") {
    return "";
  }

  const clarification = latestClarificationRequest(job.messages || []);
  if (!clarification) {
    return "";
  }

  const questions = Array.isArray(clarification.questions) ? clarification.questions : [];

  // If we have structured questions, render individual answer fields
  if (questions.length > 0) {
    return `
      <div class="detail-block clarification-panel">
        <div class="meta">Factory Questions</div>
        <p>${escapeHtml(clarification.content || "Factory needs clarification before continuing.")}</p>
        <div class="questions-form" id="questionsForm">
          ${questions.map((question, index) => `
            <div class="question-item">
              <label for="answer-${index}">
                <strong>${index + 1}.</strong> ${escapeHtml(question)}
              </label>
              <textarea 
                id="answer-${index}" 
                data-question="${escapeHtml(question)}" 
                rows="3" 
                placeholder="Your answer..."
                class="question-answer"
              ></textarea>
            </div>
          `).join("")}
        </div>
        <button class="primary-button" id="submitAnswersButton" type="button">Submit answers</button>
      </div>
    `;
  }

  // Fallback to free-form textarea if no structured questions
  return `
    <div class="detail-block clarification-panel">
      <div class="meta">Factory Questions</div>
      <p>${escapeHtml(clarification.content || "Factory needs clarification before continuing.")}</p>
      <label>
        Your clarification
        <textarea id="clarificationText" rows="6" placeholder="Answer the factory questions here"></textarea>
      </label>
      <button class="primary-button" id="submitClarificationButton" type="button">Submit clarification</button>
    </div>
  `;
}

function renderPrdOutput(events) {
  for (const event of [...events].reverse()) {
    if (event.type === "HARNESS_COMPLETED" && event.details?.output) {
      return `
        <div class="detail-block prd-output">
          <div class="meta">Generated PRD</div>
          <pre class="prd-content">${escapeHtml(event.details.output)}</pre>
        </div>
      `;
    }
  }
  return "";
}

function bindClarificationForm(job) {
  if (job.status !== "NEEDS_CLARIFICATION") {
    return;
  }

  // Handle structured answers (new flow)
  const answersButton = document.querySelector("#submitAnswersButton");
  if (answersButton) {
    answersButton.addEventListener("click", async () => {
      const answerFields = document.querySelectorAll(".question-answer");
      const answers = {};
      let allFilled = true;

      answerFields.forEach((field) => {
        const question = field.dataset.question;
        const answer = field.value.trim();
        if (!answer) {
          allFilled = false;
          field.focus();
        }
        answers[question] = answer;
      });

      if (!allFilled) {
        return;
      }

      answersButton.disabled = true;
      answersButton.textContent = "Submitting...";

      await apiFetch(`/jobs/${encodeURIComponent(job.jobId)}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });

      await refreshJobs();
      await openDetails(job.jobId);
    });
    return;
  }

  // Handle free-form clarification (legacy flow)
  const textarea = document.querySelector("#clarificationText");
  const button = document.querySelector("#submitClarificationButton");
  if (!textarea || !button) {
    return;
  }

  button.addEventListener("click", async () => {
    const content = textarea.value.trim();
    if (!content) {
      textarea.focus();
      return;
    }

    button.disabled = true;
    button.textContent = "Submitting";

    await apiFetch(`/jobs/${encodeURIComponent(job.jobId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });

    await refreshJobs();
    await openDetails(job.jobId);
  });
}

function latestClarificationRequest(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role === "factory" && message.type === "clarification_request") {
      return message;
    }
  }
  return null;
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
  if (status === "NEEDS_CLARIFICATION") {
    return "needs-input";
  }
  if (status === "HARNESS_COMPLETED" || status === "FAILED") {
    return "finished";
  }
  return "queued";
}

function countByLane(lane) {
  return state.jobs.filter((job) => laneForStatus(job.status) === lane).length;
}

function statusBadge(status) {
  const normalized = (status || "UNKNOWN").toLowerCase();
  const className = normalized === "picked_up" ? "running" : normalized === "harness_completed" ? "succeeded" : normalized;
  const label = statusLabel(status);
  return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
}

function statusLabel(status) {
  const labels = {
    SUBMITTED: "Submitted",
    QUEUED: "Queued",
    PICKED_UP: "Running",
    NEEDS_CLARIFICATION: "Needs Input",
    HARNESS_COMPLETED: "Succeeded",
    FAILED: "Failed",
  };
  return labels[status] || status || "Unknown";
}

function prLink(job) {
  if (!job.pullRequestUrl) {
    return "";
  }

  return `<a class="pr-link" href="${escapeHtml(job.pullRequestUrl)}" target="_blank" rel="noopener noreferrer">Open PR</a>`;
}

function summaryMessage(job) {
  if (job.status === "FAILED" && job.failureReason) {
    return `<span class="failure-reason">${escapeHtml(job.failureReason)}</span>`;
  }

  return escapeHtml(job.latestEventMessage || "");
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
