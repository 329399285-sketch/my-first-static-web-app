const STORAGE_KEY = "word-card-studio-theme-v4";
const DATA_KEY = "word-card-studio-files-v4";

const state = {
  files: [],
  selectedFileId: null,
  cards: [],
  currentCardIndex: 0,
  theme: "light",
};

const els = {
  fileInput: document.getElementById("fileInput"),
  downloadDataBtn: document.getElementById("downloadDataBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  themeToggleText: document.getElementById("themeToggleText"),
  fileList: document.getElementById("fileList"),
  fileCount: document.getElementById("fileCount"),
  currentDocTitle: document.getElementById("currentDocTitle"),
  currentDocMeta: document.getElementById("currentDocMeta"),
  emptyState: document.getElementById("emptyState"),
  cardsArea: document.getElementById("cardsArea"),
  cardsViewport: document.getElementById("cardsViewport"),
  cardIndex: document.getElementById("cardIndex"),
  cardMiniMeta: document.getElementById("cardMiniMeta"),
  prevCardBtn: document.getElementById("prevCardBtn"),
  nextCardBtn: document.getElementById("nextCardBtn"),
  prevOverlayBtn: document.getElementById("prevOverlayBtn"),
  nextOverlayBtn: document.getElementById("nextOverlayBtn"),
  fileItemTemplate: document.getElementById("fileItemTemplate"),
  cardTemplate: document.getElementById("cardTemplate"),
};

init();

function init() {
  loadTheme();
  loadData();
  bindEvents();
  applyTheme();
  renderFileList();
  renderCurrentView();
}

function bindEvents() {
  els.fileInput.addEventListener("change", handleFilesSelected);
  els.downloadDataBtn.addEventListener("click", exportData);
  els.themeToggleBtn.addEventListener("click", toggleTheme);
  els.prevCardBtn.addEventListener("click", () => moveCard(-1));
  els.nextCardBtn.addEventListener("click", () => moveCard(1));
  els.prevOverlayBtn.addEventListener("click", () => moveCard(-1));
  els.nextOverlayBtn.addEventListener("click", () => moveCard(1));

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") moveCard(-1);
    if (e.key === "ArrowRight") moveCard(1);
  });
}

function loadTheme() {
  state.theme = localStorage.getItem(STORAGE_KEY) || "light";
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  els.themeToggleText.textContent = state.theme === "light" ? "切换深色" : "切换浅色";
  const icon = els.themeToggleBtn.querySelector(".theme-icon");
  if (icon) icon.textContent = state.theme === "light" ? "☀️" : "🌙";
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem(STORAGE_KEY, state.theme);
  applyTheme();
}

function loadData() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.files = Array.isArray(data.files) ? data.files : [];
    state.selectedFileId = data.selectedFileId || state.files[0]?.id || null;
  } catch (e) {
    console.warn("读取数据失败", e);
  }
}

function saveData() {
  localStorage.setItem(DATA_KEY, JSON.stringify({
    files: state.files,
    selectedFileId: state.selectedFileId,
  }));
}

async function handleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    try {
      const rawText = await readFileAsText(file);
      state.files.unshift({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        createdAt: new Date().toISOString(),
        rawText: normalizeText(rawText),
        parsedCards: [],
        parsedAt: null,
      });
    } catch (err) {
      alert(`读取失败：${file.name}\n${err.message}`);
    }
  }
  event.target.value = "";
  if (!state.selectedFileId && state.files[0]) state.selectedFileId = state.files[0].id;
  saveData();
  renderFileList();
  renderCurrentView();
}

async function readFileAsText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  }
  return await file.text();
}

function normalizeText(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/[\u00A0\t]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderFileList() {
  els.fileList.innerHTML = "";
  els.fileCount.textContent = String(state.files.length);

  if (!state.files.length) {
    const div = document.createElement("div");
    div.className = "panel-soft";
    div.style.padding = "16px";
    div.style.color = "var(--muted)";
    div.textContent = "还没有文件，先上传一个。";
    els.fileList.appendChild(div);
    return;
  }

  for (const file of state.files) {
    const node = els.fileItemTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("active", file.id === state.selectedFileId);

    node.querySelector(".file-name").textContent = file.name;
    node.querySelector(".file-meta").textContent = `${formatSize(file.size)} · ${file.parsedCards?.length || 0} 张卡片`;

    node.querySelector(".file-item-head").addEventListener("click", () => {
      state.selectedFileId = file.id;
      state.cards = [];
      renderFileList();
      renderCurrentView();
      saveData();
    });

    node.querySelector(".parse-btn").addEventListener("click", () => parseDocument(file.id));
    node.querySelector(".delete-btn").addEventListener("click", () => deleteFile(file.id));

    els.fileList.appendChild(node);
  }
}

function parseDocument(fileId) {
  const file = state.files.find(x => x.id === fileId);
  if (!file) return;

  const cards = parseVocabularyText(file.rawText);
  file.parsedCards = cards;
  file.parsedAt = new Date().toISOString();

  state.selectedFileId = file.id;
  state.cards = cards;
  state.currentCardIndex = 0;

  saveData();
  renderFileList();
  renderCurrentView();

  if (!cards.length) {
    alert("本次没有识别到单词，请把文档发我，我再继续强化解析逻辑。");
  }
}

function deleteFile(fileId) {
  if (!confirm("确定删除这个文件吗？")) return;
  state.files = state.files.filter(x => x.id !== fileId);
  if (state.selectedFileId === fileId) {
    state.selectedFileId = state.files[0]?.id || null;
    state.cards = [];
    state.currentCardIndex = 0;
  }
  saveData();
  renderFileList();
  renderCurrentView();
}

function renderCurrentView() {
  const file = getSelectedFile();
  if (!file) {
    els.currentDocTitle.textContent = "请选择左侧文件并点击“解析”";
    els.currentDocMeta.textContent = "解析后会在中间生成卡片，支持左右切换、发音和更优排版。";
    els.emptyState.classList.remove("hidden");
    els.cardsArea.classList.add("hidden");
    return;
  }

  els.currentDocTitle.textContent = file.name;
  els.currentDocMeta.textContent = file.parsedAt
    ? `最近解析：${new Date(file.parsedAt).toLocaleString("zh-CN")}，共 ${file.parsedCards.length} 张卡片`
    : "尚未解析，点击左侧解析按钮。";

  if (!file.parsedCards?.length) {
    els.emptyState.classList.remove("hidden");
    els.cardsArea.classList.add("hidden");
    return;
  }

  state.cards = file.parsedCards;
  if (state.currentCardIndex >= state.cards.length) state.currentCardIndex = 0;

  els.emptyState.classList.add("hidden");
  els.cardsArea.classList.remove("hidden");
  renderCard();
}

function renderCard() {
  const card = state.cards[state.currentCardIndex];
  if (!card) return;

  els.cardsViewport.innerHTML = "";
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);

  node.querySelector(".serial-badge").textContent = `第 ${card.serial || state.currentCardIndex + 1} 个单词`;
  node.querySelector(".headword").textContent = card.word || "未识别单词";
  node.querySelector(".phonetic").textContent = card.phonetic || "";

  const score = card.fields?.["重点程度"] || card.fields?.["评分"] || card.fields?.["分数"] || "";
  node.querySelector(".score-chip").textContent = score ? `${score}` : "待评分";
  node.querySelector(".speak-word-btn").addEventListener("click", () => speakWord(card.word));

  const posRow = node.querySelector(".pos-row");
  for (const pos of normalizePos(card.pos || "")) {
    const span = document.createElement("span");
    span.className = "pos-chip";
    span.textContent = pos;
    posRow.appendChild(span);
  }
  if (!posRow.children.length) {
    const span = document.createElement("span");
    span.className = "pos-chip";
    span.textContent = "词性待识别";
    posRow.appendChild(span);
  }

  const primaryMeaning = card.fields?.["常见词义"] || card.fields?.["释义"] || card.fields?.["词义"] || "暂无释义";
  node.querySelector(".meaning-banner").textContent = `核心释义：${primaryMeaning}`;

  const grid = node.querySelector(".fields-grid");
  for (const [label, value] of orderFields(card.fields || {})) {
    if (["重点程度","评分","分数","常见词义","释义","词义"].includes(label)) continue;
    const item = document.createElement("div");
    item.className = "field-card";
    item.innerHTML = `<div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(value || "—")}</div>`;
    grid.appendChild(item);
  }

  els.cardsViewport.appendChild(node);
  els.cardIndex.textContent = `${state.currentCardIndex + 1} / ${state.cards.length}`;
  els.cardMiniMeta.textContent = `${card.word || "未识别"}${score ? " · " + score : ""}`;
}

function moveCard(delta) {
  if (!state.cards.length) return;
  state.currentCardIndex = (state.currentCardIndex + delta + state.cards.length) % state.cards.length;
  renderCard();
}

function speakWord(word) {
  if (!word || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = "en-US";
  utter.rate = 0.92;
  speechSynthesis.speak(utter);
}

function getSelectedFile() {
  return state.files.find(x => x.id === state.selectedFileId) || null;
}

function exportData() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    files: state.files
  }, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "word-card-studio-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function parseVocabularyText(text) {
  const clean = normalizeText(text)
    .replace(/^单词复习清单\s*[-—–]\s*\d{4}-\d{2}-\d{2}\s*/m, "")
    .replace(/单词复习清单\s*[-—–]\s*\d{4}-\d{2}-\d{2}/g, "");

  if (!clean) return [];
  const markers = [...clean.matchAll(/(?:^|\n|\s)(?:\[?(\d+)\]?\s*[：:.．]\s*)([A-Za-z][A-Za-z\-']*)/g)];
  if (!markers.length) return [];

  const chunks = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + (markers[i][0].startsWith(" ") ? 1 : 0);
    const end = i < markers.length - 1 ? markers[i + 1].index : clean.length;
    chunks.push(clean.slice(start, end).trim());
  }
  return chunks.map(parseWordChunk).filter(Boolean);
}

function parseWordChunk(chunk) {
  const text = chunk.trim();
  const match =
    text.match(/^\[?(\d+)\]?\s*[：:.．]\s*([A-Za-z][A-Za-z\-']*)\s*(.*)$/s) ||
    text.match(/^\[(\d+)\]\s*([A-Za-z][A-Za-z\-']*)\s*(.*)$/s);

  if (!match) return null;

  const serial = match[1] || "";
  const word = match[2] || "";
  let rest = match[3] || "";

  const phoneticMatch = rest.match(/[\{【\[]\s*(\/[^{}【】\[\]]+\/|[^{}【】\[\]]+)\s*[】}\]]/);
  const phonetic = phoneticMatch ? phoneticMatch[1].trim() : "";
  if (phoneticMatch) rest = rest.replace(phoneticMatch[0], " ");

  let pos = "";
  const posMatch = rest.match(/\[([^\]]*(?:名词|动词|形容词|副词|代词|介词|连词|短语|数词|冠词)[^\]]*)\]/);
  if (posMatch) {
    pos = posMatch[1].trim();
    rest = rest.replace(posMatch[0], " ");
  }

  rest = rest.replace(/\n/g, " ");
  const fields = {};
  const regex = /\[([^\]]{1,20})\]\s*[：:]?\s*/g;
  let m;
  const found = [];

  while ((m = regex.exec(rest)) !== null) {
    found.push({ label: m[1].trim(), start: m.index, end: regex.lastIndex });
  }

  if (!found.length) {
    fields["内容"] = rest.trim();
  } else {
    for (let i = 0; i < found.length; i++) {
      const current = found[i];
      const next = found[i + 1];
      const value = rest.slice(current.end, next ? next.start : rest.length).trim();
      if (value) fields[current.label] = value.replace(/\s{2,}/g, " ");
    }
  }

  return { serial, word, phonetic, pos, fields, raw: text };
}

function normalizePos(text) {
  return String(text || "")
    .split(/[、,，/\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function orderFields(fields) {
  const preferred = ["常见词义","生僻词义","重点程度","评分","分数","谐音记忆法","词根记忆法","场景记忆法","句子翻译","词组搭配记忆法","例句","备注","内容"];
  return Object.entries(fields).sort((a, b) => {
    const ai = preferred.indexOf(a[0]);
    const bi = preferred.indexOf(b[0]);
    if (ai === -1 && bi === -1) return a[0].localeCompare(b[0], "zh-CN");
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function formatSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
