const state = {
  nodeDefinitions: {},
  nodeOptions: [],
  workflow: {},
  nodeOrder: [],
  nextNodeId: 1,
  nodePositions: {},
  view: "simple",
  pipeline: {
    selectedOutput: null,
    selectedElement: null,
    connectionUpdateQueued: false,
    portElements: { inputs: new Map(), outputs: new Map() },
  },
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
  toggleView: document.getElementById("toggle-view"),
  views: Array.from(document.querySelectorAll(".view[data-view]")),
  pipelineCanvas: document.getElementById("pipeline-canvas"),
  pipelineConnections: document.getElementById("pipeline-connections"),
  pipelineEmpty: document.getElementById("pipeline-empty"),
  resetLayout: document.getElementById("reset-layout"),
  loadingOverlay: document.getElementById("loading-overlay"),
};

const nodeTemplate = document.getElementById("node-template");

async function init() {
  showLoading();
  try {
    await loadDefinitions();
    wireEvents();
    updateSelectOptions();
    renderNodes();
    updateWorkflowJson();
    setView(state.view);
    setStatus("Bereit.");
  } finally {
    hideLoading();
  }
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

  if (elements.toggleView) {
    elements.toggleView.addEventListener("click", () => {
      const nextView = state.view === "simple" ? "pipeline" : "simple";
      setView(nextView);
    });
  }

  if (elements.resetLayout) {
    elements.resetLayout.addEventListener("click", () => {
      resetLayout();
      setStatus("Pipeline-Layout zurückgesetzt.", "info");
    });
  }

  if (elements.pipelineCanvas) {
    elements.pipelineCanvas.addEventListener("scroll", scheduleConnectionUpdate);
  }

  window.addEventListener("resize", scheduleConnectionUpdate);
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
  assignDefaultPosition(nodeId);
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
    renderPipeline();
    return;
  }

  state.nodeOrder.forEach((nodeId) => {
    const node = state.workflow[nodeId];
    if (!node) return;
    const definition = state.nodeDefinitions[node.class_type];
    const card = createNodeCard(nodeId, node, definition);
    elements.nodesContainer.appendChild(card);
  });

  renderPipeline();
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

  const outputs = renderOutputs(definition);
  if (outputs) {
    body.appendChild(outputs);
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

function renderOutputs(definition) {
  const outputs = Array.isArray(definition?.output) ? definition.output : [];
  if (outputs.length === 0) {
    return null;
  }

  const names = Array.isArray(definition.output_name)
    ? definition.output_name
    : [];
  const listFlags = Array.isArray(definition.output_is_list)
    ? definition.output_is_list
    : [];
  const tooltips = Array.isArray(definition.output_tooltips)
    ? definition.output_tooltips
    : [];

  const container = document.createElement("div");
  container.className = "group outputs-group";
  if (definition.output_node) {
    container.dataset.terminal = "true";
  }

  const heading = document.createElement("div");
  heading.className = "group-heading";
  const headingText = definition.output_node
    ? "Workflow-Ausgang"
    : outputs.length > 1
    ? "Ausgänge"
    : "Ausgang";
  heading.textContent = headingText;
  container.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "outputs-list";

  outputs.forEach((type, index) => {
    const item = document.createElement("li");
    item.className = "outputs-list__item";

    const topRow = document.createElement("div");
    topRow.className = "outputs-list__row";

    const name = document.createElement("span");
    name.className = "outputs-list__name";
    name.textContent = names[index] || `Ausgang ${index + 1}`;
    topRow.appendChild(name);

    const typeBadge = document.createElement("span");
    typeBadge.className = "outputs-list__type";
    typeBadge.textContent = type;
    topRow.appendChild(typeBadge);

    if (listFlags[index]) {
      const listBadge = document.createElement("span");
      listBadge.className = "outputs-list__flag";
      listBadge.textContent = "Liste";
      topRow.appendChild(listBadge);
    }

    item.appendChild(topRow);

    const tooltip = tooltips[index];
    if (tooltip) {
      const hint = document.createElement("small");
      hint.textContent = tooltip;
      item.appendChild(hint);
    }

    list.appendChild(item);
  });

  container.appendChild(list);
  return container;
}

function setView(viewName) {
  state.view = viewName;
  if (document.body) {
    document.body.dataset.view = viewName;
  }

  elements.views.forEach((viewElement) => {
    const isActive = viewElement.dataset.view === viewName;
    viewElement.hidden = !isActive;
  });

  if (elements.toggleView) {
    elements.toggleView.textContent =
      viewName === "pipeline" ? "Simple UI anzeigen" : "Pipeline UI anzeigen";
  }

  if (viewName === "pipeline") {
    renderPipeline();
    scheduleConnectionUpdate();
  } else {
    clearSelectedOutput();
  }
}

function assignDefaultPosition(nodeId) {
  if (state.nodePositions[nodeId]) {
    return;
  }

  const index = Math.max(state.nodeOrder.indexOf(nodeId), 0);
  const column = Math.floor(index / 3);
  const row = index % 3;
  const x = 80 + column * 320;
  const y = 80 + row * 220;
  state.nodePositions[nodeId] = { x, y };
}

function resetLayout() {
  state.nodePositions = {};
  state.nodeOrder.forEach((nodeId) => assignDefaultPosition(nodeId));
  clearSelectedOutput();
  renderPipeline();
  scheduleConnectionUpdate();
}

function renderPipeline() {
  const canvas = elements.pipelineCanvas;
  const svg = elements.pipelineConnections;
  if (!canvas || !svg) {
    return;
  }

  canvas.querySelectorAll(".pipeline-node").forEach((node) => node.remove());
  state.pipeline.portElements = { inputs: new Map(), outputs: new Map() };

  if (elements.pipelineEmpty) {
    elements.pipelineEmpty.style.display =
      state.nodeOrder.length === 0 ? "grid" : "none";
  }

  svg.innerHTML = "";

  if (state.nodeOrder.length === 0) {
    return;
  }

  state.nodeOrder.forEach((nodeId) => {
    if (!state.nodePositions[nodeId]) {
      assignDefaultPosition(nodeId);
    }
    const node = state.workflow[nodeId];
    if (!node) return;
    const definition = state.nodeDefinitions[node.class_type];
    const pipelineNode = createPipelineNode(
      nodeId,
      node,
      definition,
      state.pipeline.portElements
    );
    if (pipelineNode) {
      canvas.appendChild(pipelineNode);
    }
  });

  scheduleConnectionUpdate();
}

function createPipelineNode(nodeId, node, definition, portElements) {
  const position = state.nodePositions[nodeId] || { x: 80, y: 80 };
  const article = document.createElement("article");
  article.className = "pipeline-node";
  article.dataset.nodeId = nodeId;
  article.style.left = `${position.x}px`;
  article.style.top = `${position.y}px`;

  const header = document.createElement("header");
  header.className = "pipeline-node__header";

  const headingWrapper = document.createElement("div");

  const title = document.createElement("h3");
  title.className = "pipeline-node__title";
  title.textContent = definition?.display_name || node.class_type || "Node";
  headingWrapper.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "pipeline-node__subtitle";
  const categoryLabel = definition?.category ? ` · ${definition.category}` : "";
  subtitle.textContent = `ID ${nodeId}${categoryLabel}`;
  headingWrapper.appendChild(subtitle);

  header.appendChild(headingWrapper);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "pipeline-node__remove";
  removeButton.innerHTML = "&times;";
  removeButton.title = "Node entfernen";
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    removeNode(nodeId);
  });
  header.appendChild(removeButton);

  article.appendChild(header);

  const body = document.createElement("div");
  body.className = "pipeline-node__body";

  const inputsSection = buildPipelineInputs(nodeId, node, definition, portElements);
  if (inputsSection) {
    body.appendChild(inputsSection);
  }

  const outputsSection = buildPipelineOutputs(nodeId, definition, portElements);
  if (outputsSection) {
    body.appendChild(outputsSection);
  }

  article.appendChild(body);
  enableNodeDragging(article, nodeId);
  return article;
}

function buildPipelineInputs(nodeId, node, definition, portElements) {
  const inputs = definition?.input;
  if (!inputs) {
    return null;
  }

  const container = document.createElement("div");
  container.className = "pipeline-section";

  const buildGroup = (fields, order, label) => {
    if (!fields || Object.keys(fields).length === 0) return null;

    const group = document.createElement("div");
    group.className = "pipeline-section";

    const heading = document.createElement("div");
    heading.className = "pipeline-section__title";
    heading.textContent = label;
    group.appendChild(heading);

    const list = document.createElement("div");
    list.className = "pipeline-fields";

    (order ?? Object.keys(fields)).forEach((fieldName) => {
      const schema = fields[fieldName];
      if (!schema) return;
      const field = document.createElement("div");
      field.className = "pipeline-field";

      const labelEl = document.createElement("span");
      labelEl.className = "pipeline-field__label";
      labelEl.textContent =
        label === "Optionale Eingänge" ? `${fieldName} (optional)` : fieldName;
      field.appendChild(labelEl);

      const port = document.createElement("button");
      port.type = "button";
      port.className = "pipeline-port";
      port.dataset.nodeId = nodeId;
      port.dataset.fieldName = fieldName;
      port.setAttribute("aria-label", `Eingang ${fieldName} von Node ${nodeId}`);
      port.addEventListener("click", () => handleInputClick(nodeId, fieldName, port));

      const currentValue = node.inputs?.[fieldName];
      if (Array.isArray(currentValue)) {
        port.classList.add("is-linked");
      }

      field.appendChild(port);
      list.appendChild(field);

      portElements.inputs.set(`${nodeId}:${fieldName}`, port);
    });

    group.appendChild(list);
    return group;
  };

  const requiredGroup = buildGroup(
    inputs.required,
    definition?.input_order?.required,
    "Eingänge"
  );
  const optionalGroup = buildGroup(
    inputs.optional,
    definition?.input_order?.optional,
    "Optionale Eingänge"
  );

  if (requiredGroup) container.appendChild(requiredGroup);
  if (optionalGroup) container.appendChild(optionalGroup);

  return container.childElementCount > 0 ? container : null;
}

function buildPipelineOutputs(nodeId, definition, portElements) {
  const outputs = Array.isArray(definition?.output) ? definition.output : [];
  if (outputs.length === 0) {
    return null;
  }

  const names = Array.isArray(definition?.output_name)
    ? definition.output_name
    : [];
  const listFlags = Array.isArray(definition?.output_is_list)
    ? definition.output_is_list
    : [];
  const tooltips = Array.isArray(definition?.output_tooltips)
    ? definition.output_tooltips
    : [];

  const container = document.createElement("div");
  container.className = "pipeline-section";

  const heading = document.createElement("div");
  heading.className = "pipeline-section__title";
  heading.textContent = outputs.length > 1 ? "Ausgänge" : "Ausgang";
  container.appendChild(heading);

  const list = document.createElement("div");
  list.className = "pipeline-output-list";

  outputs.forEach((type, index) => {
    const item = document.createElement("div");
    item.className = "pipeline-output";
    if (tooltips[index]) {
      item.title = tooltips[index];
    }

    const labels = document.createElement("div");
    labels.className = "pipeline-output__labels";

    const nameBadge = document.createElement("span");
    nameBadge.className = "pipeline-output__badge";
    nameBadge.textContent = names[index] || `Ausgang ${index + 1}`;
    labels.appendChild(nameBadge);

    const typeBadge = document.createElement("span");
    typeBadge.className = "pipeline-output__badge";
    typeBadge.textContent = type;
    labels.appendChild(typeBadge);

    if (listFlags[index]) {
      const listBadge = document.createElement("span");
      listBadge.className = "pipeline-output__badge";
      listBadge.textContent = "Liste";
      labels.appendChild(listBadge);
    }

    item.appendChild(labels);

    const port = document.createElement("button");
    port.type = "button";
    port.className = "pipeline-port pipeline-port--output";
    port.dataset.nodeId = nodeId;
    port.dataset.outputIndex = String(index);
    port.setAttribute(
      "aria-label",
      `Ausgang ${names[index] || index + 1} von Node ${nodeId}`
    );
    port.addEventListener("click", () => handleOutputClick(nodeId, index, port));

    const selected = state.pipeline.selectedOutput;
    if (selected && selected.nodeId === nodeId && selected.index === index) {
      state.pipeline.selectedElement = port;
      port.classList.add("is-selected");
    }

    item.appendChild(port);
    list.appendChild(item);

    portElements.outputs.set(`${nodeId}:${index}`, port);
  });

  container.appendChild(list);
  return container;
}

function handleOutputClick(nodeId, index, element) {
  const selected = state.pipeline.selectedOutput;
  if (selected && selected.nodeId === nodeId && selected.index === index) {
    clearSelectedOutput();
    return;
  }

  clearSelectedOutput();
  state.pipeline.selectedOutput = { nodeId, index };
  state.pipeline.selectedElement = element;
  element.classList.add("is-selected");
}

function clearSelectedOutput() {
  if (state.pipeline.selectedElement) {
    state.pipeline.selectedElement.classList.remove("is-selected");
  }
  state.pipeline.selectedOutput = null;
  state.pipeline.selectedElement = null;
}

function handleInputClick(nodeId, fieldName, element) {
  const node = state.workflow[nodeId];
  if (!node) return;

  const selected = state.pipeline.selectedOutput;
  const currentValue = node.inputs?.[fieldName];

  if (!selected) {
    if (Array.isArray(currentValue)) {
      delete node.inputs[fieldName];
      renderNodes();
      updateWorkflowJson();
      setStatus(
        `Verbindung ${nodeId}.${fieldName} entfernt.`,
        "info"
      );
    }
    return;
  }

  node.inputs[fieldName] = [selected.nodeId, selected.index];
  clearSelectedOutput();
  renderNodes();
  updateWorkflowJson();
  setStatus(
    `Verbunden: ${selected.nodeId}:${selected.index} → ${nodeId}.${fieldName}`,
    "success"
  );
}

function enableNodeDragging(nodeElement, nodeId) {
  const header = nodeElement.querySelector(".pipeline-node__header");
  if (!header) return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  header.addEventListener("pointerdown", (event) => {
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    const position = state.nodePositions[nodeId] || { x: 0, y: 0 };
    originX = position.x;
    originY = position.y;
    nodeElement.classList.add("is-dragging");
    header.setPointerCapture(pointerId);
    event.preventDefault();
  });

  header.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const nextX = originX + deltaX;
    const nextY = originY + deltaY;
    state.nodePositions[nodeId] = { x: nextX, y: nextY };
    nodeElement.style.left = `${nextX}px`;
    nodeElement.style.top = `${nextY}px`;
    scheduleConnectionUpdate();
  });

  const endDrag = (event) => {
    if (pointerId !== event.pointerId) return;
    header.releasePointerCapture(pointerId);
    pointerId = null;
    nodeElement.classList.remove("is-dragging");
    scheduleConnectionUpdate();
  };

  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);
}

function scheduleConnectionUpdate() {
  if (state.pipeline.connectionUpdateQueued) {
    return;
  }
  state.pipeline.connectionUpdateQueued = true;
  requestAnimationFrame(() => {
    state.pipeline.connectionUpdateQueued = false;
    updatePipelineConnections();
  });
}

function updatePipelineConnections() {
  const canvas = elements.pipelineCanvas;
  const svg = elements.pipelineConnections;
  if (!canvas || !svg) return;

  svg.innerHTML = "";

  const { inputs, outputs } = state.pipeline.portElements;
  if (!inputs || !outputs) return;

  inputs.forEach((port) => port.classList.remove("is-linked"));
  outputs.forEach((port) => port.classList.remove("is-linked"));

  const canvasRect = canvas.getBoundingClientRect();
  const scrollLeft = canvas.scrollLeft;
  const scrollTop = canvas.scrollTop;
  const width = Math.max(canvas.scrollWidth, canvas.clientWidth);
  const height = Math.max(canvas.scrollHeight, canvas.clientHeight);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  state.nodeOrder.forEach((nodeId) => {
    const node = state.workflow[nodeId];
    if (!node) return;
    Object.entries(node.inputs || {}).forEach(([field, value]) => {
      if (!Array.isArray(value) || value.length < 2) return;
      const sourceKey = `${value[0]}:${value[1]}`;
      const targetKey = `${nodeId}:${field}`;
      const outputPort = outputs.get(sourceKey);
      const inputPort = inputs.get(targetKey);
      if (!outputPort || !inputPort) return;

      inputPort.classList.add("is-linked");
      outputPort.classList.add("is-linked");

      const startRect = outputPort.getBoundingClientRect();
      const endRect = inputPort.getBoundingClientRect();
      const startX = startRect.left + startRect.width / 2 + scrollLeft - canvasRect.left;
      const startY = startRect.top + startRect.height / 2 + scrollTop - canvasRect.top;
      const endX = endRect.left + endRect.width / 2 + scrollLeft - canvasRect.left;
      const endY = endRect.top + endRect.height / 2 + scrollTop - canvasRect.top;
      const delta = Math.max(Math.abs(endX - startX) * 0.5, 60);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        `M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`
      );
      path.setAttribute("class", "pipeline-connection");
      svg.appendChild(path);
    });
  });
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
  delete state.nodePositions[nodeId];

  Object.values(state.workflow).forEach((node) => {
    if (!node?.inputs) return;
    Object.entries(node.inputs).forEach(([field, value]) => {
      if (Array.isArray(value) && value[0] === nodeId) {
        delete node.inputs[field];
      }
    });
  });

  if (state.pipeline.selectedOutput?.nodeId === nodeId) {
    clearSelectedOutput();
  }

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
  scheduleConnectionUpdate();
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
  state.nodePositions = {};
  state.nodeOrder.forEach((nodeId) => {
    const node = data[nodeId] || {};
    state.workflow[nodeId] = {
      class_type: node.class_type || "",
      inputs: { ...(node.inputs || {}) },
    };
    assignDefaultPosition(nodeId);
  });
  state.nextNodeId = determineNextNodeId(state.workflow);
  clearSelectedOutput();
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

function showLoading() {
  if (elements.loadingOverlay) {
    elements.loadingOverlay.classList.remove("hidden");
  }
}

function hideLoading() {
  if (elements.loadingOverlay) {
    elements.loadingOverlay.classList.add("hidden");
  }
}

init();
