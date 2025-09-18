const state = {
  nodeDefinitions: {},
  nodeOptions: [],
  workflow: {},
  nodeOrder: [],
  nextNodeId: 1,
};

const elements = {
  nodeSelect: document.getElementById("node-select"),
  nodeSearch: document.getElementById("node-search"),
  addNode: document.getElementById("add-node"),
  nodesContainer: document.getElementById("nodes-container"),
  status: document.getElementById("status"),
  execute: document.getElementById("execute-workflow"),
  workflowJson: document.getElementById("workflow-json"),
  loadJson: document.getElementById("load-json"),
  downloadJson: document.getElementById("download-json"),
};

const nodeTemplate = document.getElementById("node-template");

async function init() {
  await loadDefinitions();
  wireEvents();
  updateSelectOptions();
  renderNodes();
  updateWorkflowJson();
  setStatus("Bereit.");
}

async function loadDefinitions() {
  try {
    const response = await fetch("/object_info");
    if (!response.ok) {
      throw new Error(`Konnte Node-Beschreibungen nicht laden (${response.status}).`);
    }
    const data = await response.json();
    state.nodeDefinitions = data;
    state.nodeOptions = Object.entries(data)
      .map(([key, info]) => ({
        value: key,
        display: info.display_name || key,
        category: info.category || "Sonstige",
      }))
      .sort((a, b) =>
        a.display.localeCompare(b.display, "de", { sensitivity: "base" })
      );
  } catch (error) {
    console.error(error);
    setStatus(
      "Node-Definitionen konnten nicht geladen werden. Prüfe die Server-Konsole.",
      "error"
    );
  }
}

function wireEvents() {
  elements.addNode.addEventListener("click", () => {
    const nodeType = elements.nodeSelect.value;
    if (!nodeType) {
      setStatus("Bitte zuerst einen Node-Typ auswählen.", "error");
      return;
    }
    addNode(nodeType);
  });

  elements.nodeSearch.addEventListener("input", (event) => {
    updateSelectOptions(event.target.value);
  });

  elements.execute.addEventListener("click", executeWorkflow);
  elements.loadJson.addEventListener("click", loadWorkflowFromJson);
  elements.downloadJson.addEventListener("click", downloadCurrentWorkflow);
}

function updateSelectOptions(filterText = "") {
  const normalized = filterText.trim().toLowerCase();
  elements.nodeSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Node auswählen";
  placeholder.disabled = true;
  placeholder.selected = true;
  elements.nodeSelect.appendChild(placeholder);

  const filtered = state.nodeOptions.filter((option) => {
    if (!normalized) return true;
    return (
      option.display.toLowerCase().includes(normalized) ||
      option.value.toLowerCase().includes(normalized) ||
      option.category.toLowerCase().includes(normalized)
    );
  });

  if (filtered.length === 0) {
    const empty = document.createElement("option");
    empty.textContent = "Keine Nodes gefunden";
    empty.disabled = true;
    elements.nodeSelect.appendChild(empty);
    return;
  }

  filtered.forEach((option) => {
    const entry = document.createElement("option");
    entry.value = option.value;
    entry.textContent = `${option.display} · ${option.category}`;
    elements.nodeSelect.appendChild(entry);
  });
}

function addNode(nodeType) {
  if (!state.nodeDefinitions[nodeType]) {
    setStatus(`Unbekannter Node-Typ: ${nodeType}`, "error");
    return;
  }

  const nodeId = generateNodeId();
  const newNode = {
    class_type: nodeType,
    inputs: {},
  };

  state.workflow[nodeId] = newNode;
  state.nodeOrder.push(nodeId);
  applyDefaults(nodeId, nodeType);
  renderNodes();
  updateWorkflowJson();
  setStatus(`Node ${nodeType} (${nodeId}) hinzugefügt.`, "success");
}

function generateNodeId() {
  while (state.workflow[String(state.nextNodeId)]) {
    state.nextNodeId += 1;
  }
  const id = String(state.nextNodeId);
  state.nextNodeId += 1;
  return id;
}

function applyDefaults(nodeId, nodeType) {
  const definition = state.nodeDefinitions[nodeType];
  if (!definition?.input) return;
  const node = state.workflow[nodeId];
  const required = definition.input.required || {};
  Object.entries(required).forEach(([field, schema]) => {
    const value = defaultValueForSchema(schema);
    if (value !== undefined) {
      node.inputs[field] = value;
    }
  });
}

function defaultValueForSchema(schema) {
  if (!Array.isArray(schema) || schema.length === 0) {
    return undefined;
  }
  const typeInfo = schema[0];
  const config = typeof schema[1] === "object" && !Array.isArray(schema[1]) ? schema[1] : {};

  if (Array.isArray(typeInfo)) {
    return config.default ?? typeInfo[0];
  }

  switch (typeInfo) {
    case "INT":
    case "FLOAT":
    case "STRING":
      return config.default ?? (typeInfo === "STRING" ? "" : undefined);
    default:
      return undefined;
  }
}

function renderNodes() {
  elements.nodesContainer.innerHTML = "";
  if (state.nodeOrder.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.textContent = "Noch keine Nodes im Workflow.";
    placeholder.style.opacity = "0.7";
    elements.nodesContainer.appendChild(placeholder);
    return;
  }

  state.nodeOrder.forEach((nodeId) => {
    const node = state.workflow[nodeId];
    if (!node) return;
    const definition = state.nodeDefinitions[node.class_type];
    const card = createNodeCard(nodeId, node, definition);
    elements.nodesContainer.appendChild(card);
  });
}

function createNodeCard(nodeId, node, definition) {
  const fragment = nodeTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".node-card");
  const title = fragment.querySelector(".node-card__title");
  const subtitle = fragment.querySelector(".node-card__subtitle");
  const body = fragment.querySelector(".node-card__body");
  const removeButton = fragment.querySelector(".node-card__remove");

  title.textContent = definition?.display_name || node.class_type;
  const categoryLabel = definition?.category ? ` · ${definition.category}` : "";
  subtitle.textContent = `ID ${nodeId}${categoryLabel}`;

  removeButton.addEventListener("click", () => {
    removeNode(nodeId);
  });

  if (!definition) {
    const fallback = document.createElement("p");
    fallback.textContent =
      "Für diesen Node liegt keine Definition vor. Bearbeite ihn im JSON-Editor.";
    fallback.style.opacity = "0.75";
    body.appendChild(fallback);
    return card;
  }

  const inputs = definition.input || {};
  if (inputs.required && Object.keys(inputs.required).length > 0) {
    const group = document.createElement("div");
    group.className = "group";
    const heading = document.createElement("div");
    heading.className = "group-heading";
    heading.textContent = "Benötigte Eingaben";
    group.appendChild(heading);
    group.appendChild(
      renderFields(nodeId, node, inputs.required, definition, "required")
    );
    body.appendChild(group);
  }

  if (inputs.optional && Object.keys(inputs.optional).length > 0) {
    const details = document.createElement("details");
    details.className = "optional-group";
    details.open = hasValues(node.inputs, inputs.optional);
    const summary = document.createElement("summary");
    summary.textContent = "Optionale Eingaben";
    details.appendChild(summary);
    details.appendChild(
      renderFields(nodeId, node, inputs.optional, definition, "optional")
    );
    body.appendChild(details);
  }

  return card;
}

function renderFields(nodeId, node, fields, definition, groupName) {
  const container = document.createElement("div");
  container.className = "group-fields";
  container.style.display = "grid";
  container.style.gap = "1rem";
  const order = definition.input_order?.[groupName] ?? Object.keys(fields);

  order.forEach((fieldName) => {
    const schema = fields[fieldName];
    if (!schema) return;
    container.appendChild(
      buildField(nodeId, node, fieldName, schema, groupName)
    );
  });

  return container;
}

function buildField(nodeId, node, fieldName, schema, groupName) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const [typeInfo, configRaw] = Array.isArray(schema)
    ? schema
    : [schema, undefined];
  const config =
    typeof configRaw === "object" && !Array.isArray(configRaw) ? configRaw : {};
  const fieldId = `node-${nodeId}-${fieldName}`;
  const label = document.createElement("label");
  label.htmlFor = fieldId;
  label.textContent = `${fieldName}${groupName === "optional" ? " (optional)" : ""}`;
  wrapper.appendChild(label);

  const control = createControl(
    fieldId,
    nodeId,
    fieldName,
    typeInfo,
    config,
    node.inputs[fieldName]
  );
  wrapper.appendChild(control);

  if (config.tooltip) {
    const hint = document.createElement("small");
    hint.textContent = config.tooltip;
    wrapper.appendChild(hint);
  }

  return wrapper;
}

function createControl(id, nodeId, fieldName, typeInfo, config, storedValue) {
  if (Array.isArray(typeInfo)) {
    const select = document.createElement("select");
    select.id = id;
    typeInfo.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      select.appendChild(opt);
    });
    select.value = storedValue ?? config.default ?? typeInfo[0];
    select.addEventListener("change", (event) => {
      updateInputValue(nodeId, fieldName, event.target.value, typeInfo, config);
    });
    return select;
  }

  if (typeInfo === "STRING") {
    if (config.multiline) {
      const textarea = document.createElement("textarea");
      textarea.id = id;
      textarea.value = storedValue ?? config.default ?? "";
      if (config.placeholder) {
        textarea.placeholder = config.placeholder;
      }
      textarea.addEventListener("input", (event) => {
        updateInputValue(nodeId, fieldName, event.target.value, typeInfo, config);
      });
      return textarea;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.value = storedValue ?? config.default ?? "";
    if (config.placeholder) {
      input.placeholder = config.placeholder;
    }
    input.addEventListener("input", (event) => {
      updateInputValue(nodeId, fieldName, event.target.value, typeInfo, config);
    });
    return input;
  }

  if (typeInfo === "INT" || typeInfo === "FLOAT") {
    const input = document.createElement("input");
    input.type = "number";
    input.id = id;
    if (config.min !== undefined) input.min = config.min;
    if (config.max !== undefined) input.max = config.max;
    if (config.step !== undefined) input.step = config.step;
    input.value = storedValue ?? config.default ?? "";
    input.addEventListener("input", (event) => {
      updateInputValue(nodeId, fieldName, event.target.value, typeInfo, config);
    });
    return input;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.placeholder = config.placeholder || "Verbindung (z.B. 5:0)";
  input.value = formatConnection(storedValue);
  input.addEventListener("input", (event) => {
    updateInputValue(nodeId, fieldName, event.target.value, typeInfo, config);
  });
  return input;
}

function updateInputValue(nodeId, fieldName, rawValue, typeInfo, config) {
  const node = state.workflow[nodeId];
  if (!node) return;
  let value;

  if (Array.isArray(typeInfo)) {
    value = rawValue;
  } else if (typeInfo === "INT") {
    value = rawValue === "" ? undefined : Number.parseInt(rawValue, 10);
    if (Number.isNaN(value)) value = undefined;
  } else if (typeInfo === "FLOAT") {
    value = rawValue === "" ? undefined : Number.parseFloat(rawValue);
    if (Number.isNaN(value)) value = undefined;
  } else if (typeInfo === "STRING") {
    value = rawValue;
  } else {
    value = parseConnection(rawValue);
  }

  if (value === undefined || value === null || value === "") {
    delete node.inputs[fieldName];
  } else {
    node.inputs[fieldName] = value;
  }
  updateWorkflowJson();
}

function parseConnection(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const [target, index] = trimmed.split(":");
  if (!target) return trimmed;
  if (index === undefined) return target.trim();
  const numberIndex = Number.parseInt(index, 10);
  if (Number.isNaN(numberIndex)) {
    return [target.trim(), index.trim()];
  }
  return [target.trim(), numberIndex];
}

function formatConnection(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return `${value[0]}:${value[1]}`;
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function hasValues(currentInputs, fields) {
  return Object.keys(fields).some((field) => currentInputs[field] !== undefined);
}

function removeNode(nodeId) {
  delete state.workflow[nodeId];
  state.nodeOrder = state.nodeOrder.filter((id) => id !== nodeId);
  renderNodes();
  updateWorkflowJson();
  setStatus(`Node ${nodeId} entfernt.`, "success");
}

function buildPromptFromState() {
  const prompt = {};
  state.nodeOrder.forEach((nodeId) => {
    const node = state.workflow[nodeId];
    if (!node) return;
    const inputs = {};
    Object.entries(node.inputs || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        inputs[key] = value;
      }
    });
    prompt[nodeId] = {
      class_type: node.class_type,
      inputs,
    };
  });
  return prompt;
}

function updateWorkflowJson() {
  const prompt = buildPromptFromState();
  elements.workflowJson.value = JSON.stringify(prompt, null, 2);
}

async function executeWorkflow() {
  const prompt = buildPromptFromState();
  if (Object.keys(prompt).length === 0) {
    setStatus("Der Workflow ist leer.", "error");
    return;
  }

  try {
    setStatus("Sende Workflow...");
    const response = await fetch("/prompt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Server meldete ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    if (data.prompt_id) {
      setStatus(`Workflow gestartet (Prompt ID: ${data.prompt_id}).`, "success");
    } else {
      setStatus("Workflow an Warteschlange übergeben.", "success");
    }
  } catch (error) {
    console.error(error);
    setStatus(`Ausführung fehlgeschlagen: ${error.message}`, "error");
  }
}

function loadWorkflowFromJson() {
  const raw = elements.workflowJson.value.trim();
  if (!raw) {
    setStatus("JSON-Feld ist leer.", "error");
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    setStatus(`JSON konnte nicht geparst werden: ${error.message}`, "error");
    return;
  }

  if (typeof data !== "object" || data === null) {
    setStatus("Ungültiges Workflow-Format.", "error");
    return;
  }

  state.workflow = {};
  state.nodeOrder = Object.keys(data);
  state.nodeOrder.forEach((nodeId) => {
    const node = data[nodeId] || {};
    state.workflow[nodeId] = {
      class_type: node.class_type || "",
      inputs: { ...(node.inputs || {}) },
    };
  });
  state.nextNodeId = determineNextNodeId(state.workflow);
  renderNodes();
  updateWorkflowJson();
  setStatus("Workflow aus JSON geladen.", "success");
}

function determineNextNodeId(workflow) {
  let maxNumeric = 0;
  Object.keys(workflow).forEach((key) => {
    const numeric = Number.parseInt(key, 10);
    if (!Number.isNaN(numeric)) {
      maxNumeric = Math.max(maxNumeric, numeric);
    }
  });
  return Math.max(maxNumeric + 1, Object.keys(workflow).length + 1);
}

function downloadCurrentWorkflow() {
  const blob = new Blob([elements.workflowJson.value], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workflow.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus("Workflow exportiert.", "success");
}

function setStatus(message, type = "info") {
  elements.status.textContent = message;
  if (type === "info") {
    delete elements.status.dataset.state;
  } else {
    elements.status.dataset.state = type;
  }
}

init();
