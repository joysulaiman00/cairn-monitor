const sitesBody = document.getElementById("sites-body");
const addSiteForm = document.getElementById("add-site-form");
const messageContainer = document.getElementById("message-container");
const footerClock = document.getElementById("footer-clock");
const confirmModal = document.getElementById("confirm-modal");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmConfirm = document.getElementById("confirm-confirm");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showMessage(text, type = "info") {
  messageContainer.innerHTML = `<div class="message-banner ${type}">${escapeHtml(text)}</div>`;
  setTimeout(() => {
    if (messageContainer.firstChild) messageContainer.firstChild.remove();
  }, 4000);
}

async function fetchSites() {
  try {
    const response = await fetch("/api/sites");
    if (!response.ok) throw new Error("Unable to load sites.");
    const sites = await response.json();
    renderSiteRows(sites);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderSiteRows(sites) {
  if (!sites.length) {
    sitesBody.innerHTML = `<tr><td colspan="8" class="empty-state">No monitored sites yet.</td></tr>`;
    return;
  }

  sitesBody.innerHTML = sites.map((site) => `
    <tr data-id="${escapeHtml(site.id)}">
      <td><input type="text" name="name" class="manage-input" value="${escapeHtml(site.name)}" /></td>
      <td><input type="text" name="url" class="manage-input" value="${escapeHtml(site.url)}" /></td>
      <td><input type="text" name="category" class="manage-input" value="${escapeHtml(site.category)}" /></td>
      <td><input type="number" name="expectedStatus" class="manage-input" min="100" max="599" value="${escapeHtml(site.expectedStatus)}" /></td>
      <td><input type="number" name="checkInterval" class="manage-input" min="10" value="${escapeHtml(site.checkInterval)}" /></td>
      <td><input type="number" name="timeout" class="manage-input" min="1000" value="${escapeHtml(site.timeout)}" /></td>
      <td><label class="checkbox-label"><input type="checkbox" name="enabled" ${site.enabled ? "checked" : ""} />Enabled</label></td>
      <td class="action-cell">
        <button type="button" class="primary-btn" data-action="save">Save</button>
        <button type="button" class="danger-btn" data-action="delete">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function submitNewSite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);

  const payload = {
    name: formData.get("name")?.trim(),
    url: formData.get("url")?.trim(),
    category: formData.get("category")?.trim() || "other",
    expectedStatus: Number(formData.get("expectedStatus")) || 200,
    checkInterval: Number(formData.get("checkInterval")) || 60,
    timeout: Number(formData.get("timeout")) || 10000,
    enabled: formData.get("enabled") === "on",
  };

  if (!payload.name || !payload.url) {
    showMessage("Name and URL are required.", "error");
    return;
  }

  try {
    const response = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || "Unable to add site.");
    }
    showMessage("Site added successfully.");
    form.reset();
    fetchSites();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function saveRowSite(row) {
  const id = row.dataset.id;
  const inputs = row.querySelectorAll("input[name], select[name]");
  const payload = {};
  for (const input of inputs) {
    if (input.type === "checkbox") {
      payload[input.name] = input.checked;
      continue;
    }
    if (input.type === "number") {
      payload[input.name] = Number(input.value);
      continue;
    }
    payload[input.name] = input.value.trim();
  }

  if (!payload.name || !payload.url) {
    showMessage("Name and URL are required.", "error");
    return;
  }

  const confirmed = await showConfirmModal("Are you sure all information is correct?");
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/sites/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || "Unable to save changes.");
    }
    showMessage("Site updated successfully.");
    fetchSites();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function deleteRowSite(row) {
  const id = row.dataset.id;
  const confirmed = await showConfirmModal("Are you sure you want to delete this site?");
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/sites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || "Unable to delete site.");
    }
    showMessage("Site deleted successfully.");
    fetchSites();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function handleTableClick(event) {
  const action = event.target.dataset.action;
  if (!action) return;
  const row = event.target.closest("tr[data-id]");
  if (!row) return;

  if (action === "save") {
    saveRowSite(row);
  }
  if (action === "delete") {
    deleteRowSite(row);
  }
}

function updateClock() {
  footerClock.textContent = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function showConfirmModal(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmModal.classList.remove("hidden");
    confirmModal.setAttribute("aria-hidden", "false");

    const cleanUp = () => {
      confirmModal.classList.add("hidden");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmCancel.removeEventListener("click", onCancel);
      confirmConfirm.removeEventListener("click", onConfirm);
    };

    const onCancel = () => {
      cleanUp();
      resolve(false);
    };

    const onConfirm = () => {
      cleanUp();
      resolve(true);
    };

    confirmCancel.addEventListener("click", onCancel);
    confirmConfirm.addEventListener("click", onConfirm);
  });
}

addSiteForm.addEventListener("submit", submitNewSite);
sitesBody.addEventListener("click", handleTableClick);
setInterval(updateClock, 1000);
updateClock();
fetchSites();
