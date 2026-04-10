const STORAGE_KEY = "word-card-studio-files-v3";
const THEME_STORAGE_KEY = "word-card-studio-theme-v1";
const COMPLETION_KEY = "word-card-studio-completions-v1";
const CLOUD_API_BASE = "/api/documents";
const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 15, 30];
const FIELD_ORDER = [
  "释义", "常见词义", "生僻词义", "重点程度", "谐音记忆法", "词根记忆法",
  "场景记忆法", "例句", "句子翻译", "场景句子翻译", "词组搭配记忆法",
  "搭配", "近义词", "反义词", "备注", "补充内容"
];
const SCORE_LABEL_KEYWORDS = ["重点程度", "评分", "分数", "重点", "难度", "score", "level"];

const state = {
  files: [],
  selectedFileId: null,
  cards: [],
  currentCardIndex: 0,
  mode: "study",
  theme: "light",
  lastMoveDirection: "next",
  touchStartX: 0,
  touchStartY: 0,
  touchTracking: false,
  lastSpokenWord: "",
  lastSpokenAt: 0,
  completions: {},
  cloudEnabled: false,
  cloudStatus: "云端：未连接",
  wrongEntries: [],
};
let autoSpeakTimer = null;
let preferredSpeechVoice = null;

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
const choiceTemplate = document.getElementById("choiceTemplate");
const modeStudyBtn = document.getElementById("modeStudyBtn");
const modeChoiceBtn = document.getElementById("modeChoiceBtn");
const modeQuizBtn = document.getElementById("modeQuizBtn");
const reviewSection = document.getElementById("reviewSection");
const fileSection = document.getElementById("fileSection");
const toggleReviewBtn = document.getElementById("toggleReviewBtn");
const toggleFileBtn = document.getElementById("toggleFileBtn");
const syncCloudBtn = document.getElementById("syncCloudBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const cloudSyncStatus = document.getElementById("cloudSyncStatus");
const themeLightBtn = document.getElementById("themeLightBtn");
const themeDarkBtn = document.getElementById("themeDarkBtn");
const todayReviewList = document.getElementById("todayReviewList");
const todayReviewCount = document.getElementById("todayReviewCount");
const reviewItemTemplate = document.getElementById("reviewItemTemplate");

init();

function init() {
  loadFromStorage();
  loadCompletions();
  loadThemePreference();
  bindEvents();
  setupSpeechEngine();
  applySidebarSectionState();
  updateCloudSyncStatus(state.cloudStatus);
  renderFileList();
  renderReviewList();
  renderCurrentView();
  void initializeCloudSync();
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
  modeChoiceBtn.addEventListener("click", () => switchMode("choice"));
  modeQuizBtn.addEventListener("click", () => switchMode("quiz"));
  toggleReviewBtn?.addEventListener("click", () => toggleSidebarSection("review"));
  toggleFileBtn?.addEventListener("click", () => toggleSidebarSection("file"));
  syncCloudBtn?.addEventListener("click", () => void syncFromCloud(true));
  downloadPdfBtn?.addEventListener("click", () => void exportCurrentFilePdf());
  themeLightBtn?.addEventListener("click", () => setTheme("light"));
  themeDarkBtn?.addEventListener("click", () => setTheme("dark"));

  window.addEventListener("keydown", (event) => {
    if (!state.cards.length) return;
    if (event.key === "ArrowLeft") moveCard(-1);
    if (event.key === "ArrowRight") moveCard(1);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.cloudEnabled) {
      void syncFromCloud(false);
    }
  });

  cardsViewport.addEventListener("touchstart", handleTouchStart, { passive: true });
  cardsViewport.addEventListener("touchend", handleTouchEnd, { passive: true });
}

function loadThemePreference() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    state.theme = savedTheme;
  } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    state.theme = "dark";
  } else {
    state.theme = "light";
  }
  applyTheme();
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

function loadCompletions() {
  try {
    const raw = localStorage.getItem(COMPLETION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      state.completions = parsed;
    }
  } catch (error) {
    console.warn("读取完成状态失败：", error);
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    files: state.files,
    selectedFileId: state.selectedFileId,
    wrongEntries: state.wrongEntries,
  }));
}

function saveCompletions() {
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(state.completions));
}

async function initializeCloudSync() {
  updateCloudSyncStatus("云端：连接中...", "syncing");
  const cloudDocuments = await fetchCloudDocuments();
  if (!cloudDocuments) {
    state.cloudEnabled = false;
    updateCloudSyncStatus("云端：不可用，当前仅本地", "error");
    return;
  }

  state.cloudEnabled = true;

  if (cloudDocuments.length) {
    applyCloudDocuments(cloudDocuments);
    updateCloudSyncStatus(`云端：已同步 ${cloudDocuments.length} 份文档`, "ok");
    return;
  }

  if (!state.files.length) {
    updateCloudSyncStatus("云端：已连接（暂无文档）", "ok");
    return;
  }

  updateCloudSyncStatus("云端：首次上传中...", "syncing");
  for (const file of state.files) {
    const uploaded = await upsertCloudDocument(file, true);
    if (!uploaded) {
      state.cloudEnabled = false;
      updateCloudSyncStatus("云端：首次上传失败，已回退本地", "error");
      return;
    }
  }

  updateCloudSyncStatus(`云端：已上传 ${state.files.length} 份文档`, "ok");
}

async function syncFromCloud(manual = false) {
  updateCloudSyncStatus("云端：同步中...", "syncing");
  const cloudDocuments = await fetchCloudDocuments();

  if (!cloudDocuments) {
    state.cloudEnabled = false;
    updateCloudSyncStatus("云端：同步失败，当前仅本地", "error");
    return;
  }

  state.cloudEnabled = true;

  if (cloudDocuments.length) {
    applyCloudDocuments(cloudDocuments);
    updateCloudSyncStatus(`云端：已同步 ${cloudDocuments.length} 份文档`, "ok");
    return;
  }

  if (manual) {
    updateCloudSyncStatus("云端：暂无文档", "ok");
  } else {
    updateCloudSyncStatus("云端：已连接（暂无文档）", "ok");
  }
}

function applyCloudDocuments(documents) {
  state.files = documents.map(normalizeCloudDocument);
  if (!state.files.some((item) => item.id === state.selectedFileId)) {
    state.selectedFileId = state.files[0]?.id || null;
    state.currentCardIndex = 0;
  }
  saveToStorage();
  renderFileList();
  renderReviewList();
  renderCurrentView();
}

async function fetchCloudDocuments() {
  try {
    const response = await fetch(CLOUD_API_BASE, {
      method: "GET",
      headers: {
        "Cache-Control": "no-store",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload?.documents)) return payload.documents;
    if (Array.isArray(payload)) return payload;
    return [];
  } catch (error) {
    console.warn("拉取云端文档失败：", error);
    return null;
  }
}

function normalizeCloudDocument(input) {
  const raw = input || {};
  return {
    id: String(raw.id || crypto.randomUUID()),
    name: String(raw.name || "未命名文档"),
    type: String(raw.type || "text/plain"),
    size: Number(raw.size || 0),
    createdAt: raw.createdAt || new Date().toISOString(),
    rawText: typeof raw.rawText === "string" ? raw.rawText : "",
    parsedCards: Array.isArray(raw.parsedCards) ? raw.parsedCards : [],
    parsedAt: raw.parsedAt || null,
  };
}

function buildCloudPayload(file) {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: file.createdAt,
    rawText: file.rawText,
    parsedCards: file.parsedCards,
    parsedAt: file.parsedAt,
  };
}

async function upsertCloudDocument(file, silent = false) {
  try {
    const payload = buildCloudPayload(file);
    const response = await fetch(`${CLOUD_API_BASE}/${encodeURIComponent(file.id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!silent) updateCloudSyncStatus(`云端：已更新 ${file.name}`, "ok");
    return true;
  } catch (error) {
    console.warn("上传云端失败：", error);
    if (!silent) updateCloudSyncStatus("云端：更新失败，稍后重试", "error");
    return false;
  }
}

async function deleteCloudDocument(fileId) {
  try {
    const response = await fetch(`${CLOUD_API_BASE}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`HTTP ${response.status}`);
    }
    updateCloudSyncStatus("云端：删除成功", "ok");
  } catch (error) {
    console.warn("删除云端文档失败：", error);
    updateCloudSyncStatus("云端：删除失败，稍后重试", "error");
  }
}

function updateCloudSyncStatus(message, status = "normal") {
  state.cloudStatus = message;
  if (!cloudSyncStatus) return;

  cloudSyncStatus.textContent = message;
  cloudSyncStatus.classList.remove("ok", "error", "syncing");
  if (status === "ok" || status === "error" || status === "syncing") {
    cloudSyncStatus.classList.add(status);
  }
}

function applySidebarSectionState() {
  reviewSection?.classList.remove("collapsed");
  fileSection?.classList.remove("collapsed");
  updateSidebarToggleIcons();
}

function toggleSidebarSection(type) {
  const target = type === "review" ? reviewSection : fileSection;
  if (!target) return;
  target.classList.toggle("collapsed");
  updateSidebarToggleIcons();
}

function updateSidebarToggleIcons() {
  if (toggleReviewBtn) {
    toggleReviewBtn.textContent = reviewSection?.classList.contains("collapsed") ? "▸" : "▾";
  }
  if (toggleFileBtn) {
    toggleFileBtn.textContent = fileSection?.classList.contains("collapsed") ? "▸" : "▾";
  }
}

function handleTouchStart(event) {
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  state.touchStartX = touch.clientX;
  state.touchStartY = touch.clientY;
  state.touchTracking = true;
}

function handleTouchEnd(event) {
  if (!state.touchTracking || !state.cards.length) return;
  state.touchTracking = false;
  const touch = event.changedTouches?.[0];
  if (!touch) return;

  const deltaX = touch.clientX - state.touchStartX;
  const deltaY = touch.clientY - state.touchStartY;
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY)) return;

  moveCard(deltaX < 0 ? 1 : -1);
}

async function handleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  const uploadedFiles = [];
  for (const file of files) {
    try {
      const text = await readFileAsText(file);
      const uploaded = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || detectTypeByName(file.name),
        size: file.size,
        createdAt: new Date().toISOString(),
        rawText: normalizeText(text),
        parsedCards: [],
        parsedAt: null,
      };
      state.files.unshift(uploaded);
      uploadedFiles.push(uploaded);
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

  if (state.cloudEnabled) {
    for (const file of uploadedFiles) {
      void upsertCloudDocument(file);
    }
  }
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
  if (state.cloudEnabled) void upsertCloudDocument(file);

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
  if (state.cloudEnabled) void deleteCloudDocument(fileId);
}

function renderCard() {
  const card = state.cards[state.currentCardIndex];
  if (!card) return;
  cardsViewport.innerHTML = "";

  if (state.mode === "quiz") renderQuizCard(card);
  else if (state.mode === "choice") renderChoiceCard(card);
  else renderStudyCard(card);

  const cardNode = cardsViewport.firstElementChild;
  if (cardNode) {
    cardNode.classList.add(state.lastMoveDirection === "prev" ? "card-slide-prev" : "card-slide-next");
  }

  cardIndex.textContent = `${state.currentCardIndex + 1} / ${state.cards.length}`;
  const score = getCardScoreValue(card);
  const scoreMeta = score ? ` · 重点 ${score}` : "";
  const wrongMark = hasWrongEntry(card.id) ? " · 已记错" : "";
  cardMiniMeta.textContent = `${card.word || "未识别"}${card.phonetic ? " · " + card.phonetic : ""}${scoreMeta}${wrongMark}`;
  queueAutoSpeak(card.word);
}

function renderStudyCard(card) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".card-serial").textContent = `第 ${card.serial || state.currentCardIndex + 1} 个单词`;
  node.querySelector(".headword").textContent = card.word || "未识别单词";
  node.querySelector(".phonetic").textContent = card.phonetic || "";
  renderHeadwordScore(node, card);

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

  node.querySelector(".small-speak-btn").addEventListener("click", () => speakWord(card.word, { auto: false }));
  cardsViewport.appendChild(node);
}

function renderQuizCard(card) {
  const node = quizTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".card-serial").textContent = `第 ${card.serial || state.currentCardIndex + 1} 个单词`;
  node.querySelector(".headword").textContent = card.word || "未识别单词";
  node.querySelector(".phonetic").textContent = card.phonetic || "";
  renderHeadwordScore(node, card);

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
    removeWrongEntry(card.id, true);
    advanceQuizCard();
  });

  node.querySelector(".judge-btn.wrong").addEventListener("click", () => {
    addWrongEntry(card, true);
    advanceQuizCard();
  });

  node.querySelector(".small-speak-btn").addEventListener("click", () => speakWord(card.word, { auto: false }));
  cardsViewport.appendChild(node);
}

function renderChoiceCard(card) {
  const node = choiceTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".card-serial").textContent = `第 ${card.serial || state.currentCardIndex + 1} 个单词`;
  node.querySelector(".headword").textContent = card.word || "未识别单词";
  node.querySelector(".phonetic").textContent = card.phonetic || "";

  const optionsWrap = node.querySelector(".choice-options");
  const feedbackEl = node.querySelector(".choice-feedback");
  const options = buildChoiceOptions(card);
  const correctMeaning = getPrimaryMeaning(card);

  for (const optionText of options) {
    const btn = document.createElement("button");
    btn.className = "choice-option-btn";
    btn.textContent = optionText || "—";
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      optionsWrap.querySelectorAll("button").forEach((item) => { item.disabled = true; });

      const isCorrect = optionText === correctMeaning;
      if (isCorrect) {
        btn.classList.add("correct");
        feedbackEl.textContent = "回答正确，继续下一个";
        feedbackEl.classList.remove("hidden");
        feedbackEl.classList.add("correct");
        removeWrongEntry(card.id, true);
        setTimeout(() => moveCard(1), 420);
        return;
      }

      addWrongEntry(card, true);
      btn.classList.add("wrong");
      node.classList.add("choice-wrong-pulse");
      feedbackEl.textContent = "回答错误，显示该词解析";
      feedbackEl.classList.remove("hidden");
      feedbackEl.classList.add("wrong");
      await showWrongAnswerOverlay(card);
      moveCard(1);
    });
    optionsWrap.appendChild(btn);
  }

  node.querySelector(".small-speak-btn").addEventListener("click", () => speakWord(card.word, { auto: false }));
  cardsViewport.appendChild(node);
}

function moveCard(delta) {
  if (!state.cards.length) return;
  const previous = state.currentCardIndex;
  const next = (state.currentCardIndex + delta + state.cards.length) % state.cards.length;
  const wrappedForward = delta > 0 && previous === state.cards.length - 1 && next === 0;
  state.lastMoveDirection = delta < 0 ? "prev" : "next";
  state.currentCardIndex = next;
  renderCard();
  if (state.mode === "quiz" && wrappedForward) {
    showCompletionCelebration();
  }
}

function switchMode(mode) {
  state.mode = mode;
  updateModeButtons();
  renderCurrentView();
}

function updateModeButtons() {
  modeStudyBtn.classList.toggle("active", state.mode === "study");
  modeChoiceBtn.classList.toggle("active", state.mode === "choice");
  modeQuizBtn.classList.toggle("active", state.mode === "quiz");
}

function advanceQuizCard() {
  moveCard(1);
}

function showCompletionCelebration() {
  const file = getSelectedFile();
  if (!file) return;
  const dateText = extractDateFromName(file.name) || formatDateOnly(new Date());
  const key = `${file.id}-${dateText}`;
  if (state.completions[key]) return;
  state.completions[key] = true;
  saveCompletions();

  const backdrop = document.createElement("div");
  backdrop.className = "completion-overlay";
  backdrop.innerHTML = `
    <div class="completion-panel">
      <div class="completion-spark">✨</div>
      <h3>${dateText} 学习已完成</h3>
      <p>今天这组单词已经完成一轮默写，继续保持节奏！</p>
      <button class="completion-btn">继续学习</button>
    </div>
  `;
  backdrop.querySelector(".completion-btn")?.addEventListener("click", () => backdrop.remove());
  document.body.appendChild(backdrop);
}

function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  state.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme();
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  updateThemeButtons();
}

function updateThemeButtons() {
  themeLightBtn?.classList.toggle("active", state.theme === "light");
  themeDarkBtn?.classList.toggle("active", state.theme === "dark");
}

function renderHeadwordScore(node, card) {
  const scoreEl = node.querySelector(".headword-score");
  if (!scoreEl) return;
  const scoreValue = getCardScoreValue(card);

  if (!scoreValue) {
    scoreEl.textContent = "";
    scoreEl.classList.add("hidden");
    return;
  }

  scoreEl.textContent = scoreValue;
  scoreEl.classList.remove("hidden");
}

function getCardScoreValue(card) {
  const fields = card?.fields || {};
  for (const [label, value] of Object.entries(fields)) {
    const normalizedLabel = String(label || "").trim().toLowerCase();
    if (!normalizedLabel) continue;
    if (!SCORE_LABEL_KEYWORDS.some((keyword) => normalizedLabel.includes(keyword.toLowerCase()))) continue;
    return normalizeScoreText(value);
  }
  return "";
}

function normalizeScoreText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";

  const matchedScore = text.match(/\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/);
  if (matchedScore) return matchedScore[0].replace(/\s+/g, "");

  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function getPrimaryMeaning(card) {
  return card.fields?.["释义"] || card.fields?.["常见词义"] || card.fields?.["生僻词义"] || "未识别释义";
}

function buildChoiceOptions(card) {
  const correct = getPrimaryMeaning(card);
  const pool = [];

  for (const other of state.cards) {
    if (!other || other.id === card.id) continue;
    const meaning = getPrimaryMeaning(other);
    if (meaning && meaning !== correct && !pool.includes(meaning)) {
      pool.push(meaning);
    }
  }

  const picked = shuffleArray(pool).slice(0, 3);
  while (picked.length < 3) {
    picked.push(`干扰项 ${picked.length + 1}`);
  }

  return shuffleArray([correct, ...picked]);
}

async function showWrongAnswerOverlay(card) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "answer-overlay-backdrop";

    const panel = document.createElement("div");
    panel.className = "answer-overlay-panel";

    const title = document.createElement("h3");
    title.textContent = `${card.word || "未识别"} 的解析`;
    panel.appendChild(title);

    const meaning = document.createElement("p");
    meaning.textContent = `释义：${getPrimaryMeaning(card)}`;
    panel.appendChild(meaning);

    for (const [label, value] of orderFields(card.fields || {})) {
      const line = document.createElement("p");
      line.className = "answer-overlay-line";
      line.textContent = `${label}：${value}`;
      panel.appendChild(line);
    }

    const nextBtn = document.createElement("button");
    nextBtn.className = "answer-overlay-btn";
    nextBtn.textContent = "继续下一个";
    nextBtn.addEventListener("click", () => {
      backdrop.remove();
      resolve();
    });

    panel.appendChild(nextBtn);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  });
}

function shuffleArray(input) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setupSpeechEngine() {
  if (!window.speechSynthesis) return;
  refreshPreferredVoice();
  window.speechSynthesis.addEventListener("voiceschanged", refreshPreferredVoice);
}

function refreshPreferredVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices?.length) return;

  preferredSpeechVoice =
    voices.find((voice) => /en-US/i.test(voice.lang) && !/Google UK/i.test(voice.name)) ||
    voices.find((voice) => /^en/i.test(voice.lang)) ||
    voices[0] ||
    null;
}

function speakCurrentCard() {
  const card = state.cards[state.currentCardIndex];
  if (card) speakWord(card.word, { auto: false });
}

function queueAutoSpeak(word) {
  if (!word) return;
  if (autoSpeakTimer) clearTimeout(autoSpeakTimer);
  autoSpeakTimer = setTimeout(() => {
    speakWord(word, { auto: true });
  }, 70);
}

function speakWord(word, options = {}) {
  const auto = Boolean(options.auto);
  if (!word || !window.speechSynthesis) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (auto && state.lastSpokenWord === word && now - state.lastSpokenAt < 550) {
    return;
  }

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = preferredSpeechVoice?.lang || "en-US";
  utter.rate = auto ? 0.96 : 1.02;
  utter.pitch = 1;
  utter.volume = 1;
  if (preferredSpeechVoice) {
    utter.voice = preferredSpeechVoice;
  }

  try {
    window.speechSynthesis.resume();
  } catch (error) {
    console.warn("语音引擎唤醒失败：", error);
  }

  window.speechSynthesis.speak(utter);
  state.lastSpokenWord = word;
  state.lastSpokenAt = now;
}

function addWrongEntry(card, skipRefresh = false) {
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
  if (!skipRefresh) renderCurrentView();
}

function removeWrongEntry(cardId, skipRefresh = false) {
  const before = state.wrongEntries.length;
  state.wrongEntries = state.wrongEntries.filter((item) => item.id !== cardId);
  if (before !== state.wrongEntries.length) {
    saveToStorage();
    if (!skipRefresh) renderCurrentView();
  }
}

function hasWrongEntry(cardId) {
  return state.wrongEntries.some((item) => item.id === cardId);
}

function getWrongCountForFile(fileId) {
  return state.wrongEntries.filter((item) => item.fileId === fileId).length;
}

async function exportWrongEntries() {
  if (!state.wrongEntries.length) {
    alert("当前还没有错词记录。");
    return;
  }
  const grouped = groupBy(state.wrongEntries, (item) => item.fileName);
  const sections = [];
  for (const [fileName, items] of Object.entries(grouped)) {
    items.sort((a, b) => Number(a.serial || 0) - Number(b.serial || 0));
    const bodyParts = items.map((item) => `${item.serial || "-"} · ${item.word || "未识别"}\n${item.raw || ""}`);
    sections.push({
      title: fileName || "未命名文档",
      body: bodyParts.join("\n\n========================================\n\n"),
    });
  }

  try {
    exportTextSectionsToPdf({
      filename: `错词汇总_${formatDateOnly(new Date())}.pdf`,
      title: "错词汇总",
      subtitle: `导出时间：${new Date().toLocaleString("zh-CN")}  ·  共 ${state.wrongEntries.length} 条`,
      sections,
    });
  } catch (error) {
    console.warn("错词 PDF 导出失败：", error);
    alert(`错词 PDF 导出失败：${error?.message || "未知错误"}`);
  }
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

async function exportCurrentFilePdf() {
  const current = getSelectedFile();
  if (!current) {
    alert("请先选择一个文档。");
    return;
  }
  if (!current.rawText && !current.parsedCards?.length) {
    alert("当前文档没有可导出的内容。");
    return;
  }
  const filename = `${sanitizeFilename(current.name.replace(/\.[^.]+$/, "")) || "word-cards"}.pdf`;
  const rawContent = current.rawText || (current.parsedCards || []).map((card) => rebuildRawText(card)).join("\n\n");

  try {
    exportTextSectionsToPdf({
      filename,
      title: `${current.name}（原始文档文本）`,
      subtitle: `导出时间：${new Date().toLocaleString("zh-CN")}`,
      sections: [{ title: "文档内容", body: rawContent || "（无内容）" }],
    });
  } catch (error) {
    console.warn("导出 PDF 失败：", error);
    alert(`PDF 导出失败：${error?.message || "未知错误"}`);
  }
}

function exportTextSectionsToPdf({ filename, title, subtitle, sections }) {
  const JsPdf = window.jspdf?.jsPDF || window.jsPDF;
  if (!JsPdf) {
    throw new Error("PDF 引擎未加载");
  }

  const doc = new JsPdf({ orientation: "p", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  const canvas = document.createElement("canvas");
  canvas.width = 1650;
  canvas.height = Math.floor((canvas.width * contentHeight) / contentWidth);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 初始化失败");
  }

  const pad = 68;
  const lineHeight = 36;
  const maxX = canvas.width - pad;
  const maxY = canvas.height - pad;
  let y = pad;
  let isFirstPage = true;
  let pageHasContent = false;

  const resetPage = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    y = pad;
    pageHasContent = false;
  };

  const flushPage = () => {
    if (!pageHasContent) return;
    const img = canvas.toDataURL("image/jpeg", 0.98);
    if (!isFirstPage) doc.addPage();
    doc.addImage(img, "JPEG", margin, margin, contentWidth, contentHeight, undefined, "FAST");
    isFirstPage = false;
    resetPage();
  };

  const drawLines = (text, font, color, blockLineHeight, spacingTop = 0, spacingBottom = 0) => {
    if (spacingTop) y += spacingTop;
    ctx.font = font;
    ctx.fillStyle = color;
    const lines = wrapTextLines(ctx, String(text || ""), maxX - pad);

    for (const line of lines) {
      if (y + blockLineHeight > maxY) {
        flushPage();
      }
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(line || " ", pad, y);
      y += blockLineHeight;
      pageHasContent = true;
    }

    if (spacingBottom) y += spacingBottom;
  };

  resetPage();
  drawLines(title || "文档导出", "700 46px 'Noto Sans SC', 'Microsoft YaHei', sans-serif", "#0f172a", 54, 0, 10);
  drawLines(subtitle || "", "500 24px 'Noto Sans SC', 'Microsoft YaHei', sans-serif", "#334155", 34, 0, 18);

  for (const section of sections || []) {
    drawLines(section.title || "", "700 32px 'Noto Sans SC', 'Microsoft YaHei', sans-serif", "#1d4ed8", 42, 8, 6);
    drawLines(section.body || "", "500 25px 'Noto Sans SC', 'Microsoft YaHei', sans-serif", "#111827", lineHeight, 0, 18);
  }

  if (!pageHasContent && isFirstPage) {
    pageHasContent = true;
  }
  flushPage();
  doc.save(filename || "export.pdf");
}

function wrapTextLines(ctx, text, maxWidth) {
  const source = String(text || "").replace(/\r/g, "");
  const paragraphs = source.split("\n");
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const char of paragraph) {
      const testLine = line + char;
      if (ctx.measureText(testLine).width <= maxWidth) {
        line = testLine;
      } else {
        if (line) lines.push(line);
        line = char;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
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
