const STORAGE_KEY = "word-card-studio-files-v3";
const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 15, 30];
const FIELD_ORDER = [
  "释义", "常见词义", "生僻词义", "重点程度", "谐音记忆法", "词根记忆法",
  "场景记忆法", "例句", "句子翻译", "场景句子翻译", "词组搭配记忆法",
  "搭配", "近义词", "反义词", "备注", "补充内容"
];

const state = {
  files: [],
  selectedFileId: null,
  cards: [],
  currentCardIndex: 0,
  mode: "study",
  wrongEntries: [],
};

const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const fileCount = document.getElementById("fileCount");
const downloadDataBtn = document.getElementById("downloadDataBtn");
const downloadWrongBtn = document.getElementById("downloadWrongBtn");
const currentDocTitle = document.getElementById("currentDocTitle");
const currentDocMeta = document.getElementById("currentDocMeta");
const emptyState = document.getElementById("emptyState");
const cardsArea = document.getElementById("cardsArea");
const cardsViewport = document.getElementById("cardsViewport");
const cardIndex = document.getElementById("cardIndex");
const cardMiniMeta = document.getElementById("cardMiniMeta");
const prevCardBtn = document.getElementById("prevCardBtn");
const nextCardBtn = document.getElementById("nextCardBtn");
const prevOverlayBtn = document.getElementById("prevOverlayBtn");
const nextOverlayBtn = document.getElementById("nextOverlayBtn");
const speakBtn = document.getElementById("speakBtn");
const fileItemTemplate = document.getElementById("fileItemTemplate");
const cardTemplate = document.getElementById("cardTemplate");
const quizTemplate = document.getElementById("quizTemplate");
const modeStudyBtn = document.getElementById("modeStudyBtn");
const modeQuizBtn = document.getElementById("modeQuizBtn");
const todayReviewList = document.getElementById("todayReviewList");
const todayReviewCount = document.getElementById("todayReviewCount");
const reviewItemTemplate = document.getElementById("reviewItemTemplate");

init();

function init() {
  loadFromStorage();
  bindEvents();
  renderFileList();
  renderReviewList();
  renderCurrentView();
}

function bindEvents() {
  fileInput.addEventListener("change", handleFilesSelected);
  downloadDataBtn.addEventListener("click", exportData);
  downloadWrongBtn.addEventListener("click", exportWrongEntries);
  prevCardBtn.addEventListener("click", () => moveCard(-1));
  nextCardBtn.addEventListener("click", () => moveCard(1));
  prevOverlayBtn.addEventListener("click", () => moveCard(-1));
  nextOverlayBtn.addEventListener("click", () => moveCard(1));
  speakBtn.addEventListener("click", speakCurrentCard);
  modeStudyBtn.addEventListener("click", () => switchMode("study"));
  modeQuizBtn.addEventListener("click", () => switchMode("quiz"));

  window.addEventListener("keydown", (event) => {
    if (!state.cards.length) return;
    if (event.key === "ArrowLeft") moveCard(-1);
    if (event.key === "ArrowRight") moveCard(1);
  });
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.files)) {
      state.files = data.files;
      state.selectedFileId = data.selectedFileId || data.files[0]?.id || null;
    }
    if (Array.isArray(data.wrongEntries)) {
      state.wrongEntries = data.wrongEntries;
    }
  } catch (error) {
    console.warn("读取本地数据失败：", error);
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    files: state.files,
    selectedFileId: state.selectedFileId,
    wrongEntries: state.wrongEntries,
  }));
}

async function handleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    try {
      const text = await readFileAsText(file);
      state.files.unshift({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || detectTypeByName(file.name),
        size: file.size,
        createdAt: new Date().toISOString(),
        rawText: normalizeText(text),
        parsedCards: [],
        parsedAt: null,
      });
    } catch (error) {
      alert(`文件 ${file.name} 读取失败：${error.message}`);
    }
  }

  event.target.value = "";
  if (!state.selectedFileId && state.files[0]) {
    state.selectedFileId = state.files[0].id;
  }
  saveToStorage();
  renderFileList();
  renderReviewList();
  renderCurrentView();
}

function detectTypeByName(name = "") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".txt")) return "text/plain";
  return "unknown";
}

async function readFileAsText(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  }
  return file.text();
}

function renderFileList() {
  fileList.innerHTML = "";
  fileCount.textContent = String(state.files.length);

  if (!state.files.length) {
    const div = document.createElement("div");
    div.className = "glass";
    div.style.borderRadius = "18px";
    div.style.padding = "16px";
    div.style.color = "var(--muted)";
    div.textContent = "还没有文件，先上传一个 Word 文档。";
    fileList.appendChild(div);
    return;
  }

  for (const file of state.files) {
    const node = fileItemTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("active", file.id === state.selectedFileId);
    const date = extractDateFromName(file.name);

    node.querySelector(".file-name").textContent = file.name;
    node.querySelector(".file-meta").textContent = [
      formatSize(file.size),
      date ? `文件日期 ${date}` : "未识别日期",
      `${file.parsedCards?.length || 0} 张卡片`,
    ].join(" · ");

    node.querySelector(".file-item-main").addEventListener("click", () => {
      state.selectedFileId = file.id;
      state.cards = file.parsedCards || [];
      state.currentCardIndex = 0;
      saveToStorage();
      renderFileList();
      renderCurrentView();
    });

    node.querySelector(".parse-btn").addEventListener("click", () => parseDocument(file.id));
    node.querySelector(".delete-btn").addEventListener("click", () => deleteFile(file.id));
    fileList.appendChild(node);
  }
}

function renderReviewList() {
  todayReviewList.innerHTML = "";
  const dueFiles = getTodayReviewFiles();
  todayReviewCount.textContent = String(dueFiles.length);

  if (!dueFiles.length) {
    const empty = document.createElement("div");
    empty.className = "glass";
    empty.style.borderRadius = "18px";
    empty.style.padding = "14px";
    empty.style.color = "var(--muted)";
    empty.textContent = "今天没有命中的复习文件。上传更多带日期的文档后会自动计算。";
    todayReviewList.appendChild(empty);
    return;
  }

  for (const item of dueFiles) {
    const node = reviewItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".review-name").textContent = item.file.name;
    node.querySelector(".review-meta").textContent = `第 ${item.dayDiff} 天 · ${item.reason}`;
    node.querySelector(".review-open-btn").addEventListener("click", () => {
      state.selectedFileId = item.file.id;
      if (!item.file.parsedCards?.length) parseDocument(item.file.id);
      else {
        state.cards = item.file.parsedCards;
        state.currentCardIndex = 0;
        saveToStorage();
        renderFileList();
        renderCurrentView();
      }
    });
    todayReviewList.appendChild(node);
  }
}

function renderCurrentView() {
  const current = getSelectedFile();
  updateModeButtons();

  if (!current) {
    emptyState.classList.remove("hidden");
    cardsArea.classList.add("hidden");
    currentDocTitle.textContent = "请选择左侧文件并点击“解析”";
    currentDocMeta.textContent = "解析后会在这里显示单词卡片，可左右切换、朗读和默写。";
    return;
  }

  currentDocTitle.textContent = current.name;
  currentDocMeta.textContent = current.parsedAt
    ? `最近解析：${formatDateTime(current.parsedAt)}，共 ${current.parsedCards.length} 张卡片，错词 ${getWrongCountForFile(current.id)} 条`
    : "尚未解析，点击左侧“解析”按钮开始。";

  if (!current.parsedCards?.length) {
    emptyState.classList.remove("hidden");
    cardsArea.classList.add("hidden");
    return;
  }

  state.cards = current.parsedCards;
  if (state.currentCardIndex >= state.cards.length) state.currentCardIndex = 0;
  emptyState.classList.add("hidden");
  cardsArea.classList.remove("hidden");
  renderCard();
}

function parseDocument(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file) return;

  const cards = parseVocabularyText(file.rawText, file.id);
  file.parsedCards = cards;
  file.parsedAt = new Date().toISOString();
  state.selectedFileId = file.id;
  state.cards = cards;
  state.currentCardIndex = 0;

  saveToStorage();
  renderFileList();
  renderReviewList();
  renderCurrentView();

  if (!cards.length) {
    alert("没有识别到单词卡。当前版本会优先识别连续文本里的“数字+冒号+英文单词”结构，例如 1：access。\n如仍失败，请把出问题文件继续发我，我会再针对样式修正。");
  } else {
    alert(`解析完成：共识别 ${cards.length} 个单词。`);
  }
}

function deleteFile(fileId) {
  const index = state.files.findIndex((item) => item.id === fileId);
  if (index === -1) return;
  const removed = state.files[index];
  if (!confirm(`确定删除文件“${removed.name}”吗？`)) return;

  state.files.splice(index, 1);
  state.wrongEntries = state.wrongEntries.filter((item) => item.fileId !== fileId);

  if (state.selectedFileId === fileId) {
    state.selectedFileId = state.files[0]?.id || null;
    state.cards = [];
    state.currentCardIndex = 0;
  }

  saveToStorage();
  renderFileList();
  renderReviewList();
  renderCurrentView();
}

function renderCard() {
  const card = state.cards[state.currentCardIndex];
  if (!card) return;
  cardsViewport.innerHTML = "";

  if (state.mode === "quiz") renderQuizCard(card);
  else renderStudyCard(card);

  cardIndex.textContent = `${state.currentCardIndex + 1} / ${state.cards.length}`;
  const wrongMark = hasWrongEntry(card.id) ? " · 已记错" : "";
  cardMiniMeta.textContent = `${card.word || "未识别"}${card.phonetic ? " · " + card.phonetic : ""}${wrongMark}`;
}

function renderStudyCard(card) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".card-serial").textContent = `第 ${card.serial || state.currentCardIndex + 1} 个单词`;
  node.querySelector(".headword").textContent = card.word || "未识别单词";
  node.querySelector(".phonetic").textContent = card.phonetic || "";

  const posRow = node.querySelector(".pos-row");
  const posList = normalizePos(card.pos || "");
  if (posList.length) {
    for (const pos of posList) {
      const chip = document.createElement("span");
      chip.className = "pos-chip";
      chip.textContent = pos;
      posRow.appendChild(chip);
    }
  } else {
    posRow.innerHTML = `<span class="pos-chip">词性待识别</span>`;
  }

  const fieldsGrid = node.querySelector(".fields-grid");
  for (const [label, value] of orderFields(card.fields || {})) {
    const field = document.createElement("div");
    field.className = "field-card";
    field.innerHTML = `<div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(value || "—")}</div>`;
    fieldsGrid.appendChild(field);
  }

  node.querySelector(".small-speak-btn").addEventListener("click", () => speakWord(card.word));
  cardsViewport.appendChild(node);
}

function renderQuizCard(card) {
  const node = quizTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".card-serial").textContent = `第 ${card.serial || state.currentCardIndex + 1} 个单词`;
  node.querySelector(".headword").textContent = card.word || "未识别单词";
  node.querySelector(".phonetic").textContent = card.phonetic || "";

  const answerBox = node.querySelector(".quiz-answer");
  const judgeBox = node.querySelector(".quiz-judge");
  const meaningEl = node.querySelector(".quiz-meaning");
  const extraEl = node.querySelector(".quiz-extra");

  const meaning = card.fields?.["释义"] || card.fields?.["常见词义"] || card.fields?.["生僻词义"] || "未识别释义";
  const extra = [
    card.fields?.["生僻词义"] ? `生僻词义：${card.fields["生僻词义"]}` : "",
    card.fields?.["句子翻译"] ? `句子翻译：${card.fields["句子翻译"]}` : "",
    card.fields?.["词组搭配记忆法"] ? `搭配：${card.fields["词组搭配记忆法"]}` : "",
  ].filter(Boolean).join("\n");

  meaningEl.textContent = `释义：${meaning}`;
  extraEl.textContent = extra || "点击“正确”或“错误”后会自动进入下一张。";

  node.querySelector(".reveal-btn").addEventListener("click", () => {
    answerBox.classList.remove("hidden");
    judgeBox.classList.remove("hidden");
  });

  node.querySelector(".judge-btn.correct").addEventListener("click", () => {
    removeWrongEntry(card.id);
    moveCard(1);
  });

  node.querySelector(".judge-btn.wrong").addEventListener("click", () => {
    addWrongEntry(card);
    moveCard(1);
  });

  node.querySelector(".small-speak-btn").addEventListener("click", () => speakWord(card.word));
  cardsViewport.appendChild(node);
}

function moveCard(delta) {
  if (!state.cards.length) return;
  state.currentCardIndex = (state.currentCardIndex + delta + state.cards.length) % state.cards.length;
  renderCard();
}

function switchMode(mode) {
  state.mode = mode;
  updateModeButtons();
  renderCard();
}

function updateModeButtons() {
  modeStudyBtn.classList.toggle("active", state.mode === "study");
  modeQuizBtn.classList.toggle("active", state.mode === "quiz");
}

function speakCurrentCard() {
  const card = state.cards[state.currentCardIndex];
  if (card) speakWord(card.word);
}

function speakWord(word) {
  if (!word || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = "en-US";
  utter.rate = 0.92;
  window.speechSynthesis.speak(utter);
}

function addWrongEntry(card) {
  if (hasWrongEntry(card.id)) return;
  const currentFile = getSelectedFile();
  state.wrongEntries.push({
    id: card.id,
    fileId: currentFile?.id || "",
    fileName: currentFile?.name || "",
    serial: card.serial,
    word: card.word,
    raw: card.raw || rebuildRawText(card),
    addedAt: new Date().toISOString(),
  });
  saveToStorage();
  renderCurrentView();
}

function removeWrongEntry(cardId) {
  const before = state.wrongEntries.length;
  state.wrongEntries = state.wrongEntries.filter((item) => item.id !== cardId);
  if (before !== state.wrongEntries.length) {
    saveToStorage();
    renderCurrentView();
  }
}

function hasWrongEntry(cardId) {
  return state.wrongEntries.some((item) => item.id === cardId);
}

function getWrongCountForFile(fileId) {
  return state.wrongEntries.filter((item) => item.fileId === fileId).length;
}

function exportWrongEntries() {
  if (!state.wrongEntries.length) {
    alert("当前还没有错词记录。");
    return;
  }

  const grouped = groupBy(state.wrongEntries, (item) => item.fileName);
  const parts = [];
  for (const [fileName, items] of Object.entries(grouped)) {
    parts.push(`单词复习清单错词汇总 - ${fileName}`);
    parts.push("");
    items.sort((a, b) => Number(a.serial || 0) - Number(b.serial || 0));
    for (const item of items) {
      parts.push(item.raw.trim());
      parts.push("");
    }
    parts.push("========================================");
    parts.push("");
  }

  const blob = new Blob([parts.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `错词汇总_${formatDateOnly(new Date())}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    files: state.files,
    wrongEntries: state.wrongEntries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "word-card-studio-data.json";
  a.click();
  URL.revokeObjectURL(url);
}

function getSelectedFile() {
  return state.files.find((file) => file.id === state.selectedFileId) || null;
}

function getTodayReviewFiles() {
  const today = startOfDay(new Date());
  return state.files
    .map((file) => {
      const dateString = extractDateFromName(file.name);
      if (!dateString) return null;
      const fileDate = parseDate(dateString);
      const dayDiff = daysBetween(fileDate, today);
      if (!REVIEW_INTERVALS.includes(dayDiff)) return null;
      return {
        file,
        dayDiff,
        reason: dayDiff === 0 ? "今天新学，建议首次学习" : `符合艾宾浩斯第 ${dayDiff} 天复习`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dayDiff - b.dayDiff);
}

function normalizeText(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/[\u00A0\t]+/g, " ")
    .replace(/\u200b/g, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseVocabularyText(text, fileId) {
  let normalized = normalizeText(text);
  if (!normalized) return [];

  normalized = normalized
    .replace(/^\s*单词复习清单\s*[-－—:：]?\s*\d{4}-\d{2}-\d{2}\s*\n?/gm, "")
    .replace(/^\s*单词复习清单.*$/gm, "")
    .trim();

  const chunks = splitIntoWordChunks(normalized);
  return chunks
    .map((chunk) => parseWordChunk(chunk, fileId))
    .filter((item) => item && item.word);
}

function splitIntoWordChunks(text) {
  const flat = text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!flat) return [];

  const entryRegex = /(\d{1,3})\s*[：:．.]\s*([A-Za-z][\s\S]*?)(?=(?:\d{1,3}\s*[：:．.]\s*[A-Za-z])|$)/g;
  const chunks = [];
  let match;

  while ((match = entryRegex.exec(flat)) !== null) {
    const serial = (match[1] || "").trim();
    const content = (match[2] || "").trim();
    if (content) chunks.push(`${serial}：${content}`);
  }
  return chunks;
}

function parseWordChunk(chunk, fileId) {
  const original = chunk.trim();
  const match = original.match(/^\s*(\d{1,3})\s*[：:．.]\s*([A-Za-z][\s\S]*)$/);
  if (!match) return null;

  const serial = (match[1] || "").trim();
  const content = (match[2] || "").trim();
  const info = parseHeader(content);
  if (!info.word) return null;

  const fields = parseFields(content);
  return {
    id: `${fileId || "file"}-${serial}-${info.word.toLowerCase()}`,
    fileId,
    serial,
    word: info.word,
    phonetic: info.phonetic,
    pos: info.pos,
    fields,
    raw: rebuildRawText({ serial, word: info.word, phonetic: info.phonetic, pos: info.pos, fields }),
  };
}

function parseHeader(content) {
  const clean = (content || "").trim();
  if (!clean) return { word: "", phonetic: "", pos: "" };

  const wordMatch = clean.match(/^([A-Za-z][A-Za-z'\-]*)/);
  const word = wordMatch ? wordMatch[1].trim() : "";

  const phoneticMatch = clean.match(/\{\s*([^{}]+?)\s*\}/) || clean.match(/\/(.+?)\//);
  const phonetic = phoneticMatch ? phoneticMatch[1].trim() : "";

  const posMatch = clean.match(/\[([^\]]*(?:名词|动词|形容词|副词|代词|介词|连词|数词|冠词|短语)[^\]]*)\]/);
  const pos = posMatch ? posMatch[1].trim() : "";

  return { word, phonetic, pos };
}

function parseFields(content) {
  const fields = {};
  if (!content) return fields;

  const labelRegex = /\[([^\[\]]+?)\]\s*[：:]\s*([\s\S]*?)(?=(?:\[[^\[\]]+?\]\s*[：:])|$)/g;
  let match;

  while ((match = labelRegex.exec(content)) !== null) {
    const label = (match[1] || "").trim();
    const value = (match[2] || "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!label || !value) continue;
    fields[label] = value;
  }

  return fields;
}

function isLikelyLooseLabel(label) {
  return FIELD_ORDER.includes(label);
}

function rebuildRawText(card) {
  const header = `${card.serial}：${card.word}${card.phonetic ? ` {/${String(card.phonetic).replace(/^\/+|\/+$/g, "")}/}` : ""}${card.pos ? ` [${card.pos}]` : ""}`;
  const body = orderFields(card.fields || {}).map(([k, v]) => `[${k}]：${v}`).join("\n");
  return `${header}\n${body}`.trim();
}

function normalizePos(posText) {
  if (!posText) return [];
  return posText.split(/[、,，/\s]+/).map((s) => s.trim()).filter(Boolean);
}

function orderFields(fields) {
  const entries = Object.entries(fields || {});
  entries.sort((a, b) => {
    const ai = FIELD_ORDER.indexOf(a[0]);
    const bi = FIELD_ORDER.indexOf(b[0]);
    if (ai === -1 && bi === -1) return a[0].localeCompare(b[0], "zh-CN");
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return entries;
}

function extractDateFromName(name = "") {
  const match = name.match(/(20\d{2}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function parseDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(earlier, later) {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / 86400000);
}

function groupBy(array, getKey) {
  return array.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function formatSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("zh-CN");
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
