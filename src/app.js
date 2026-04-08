const STORAGE_KEY = "word-card-studio-files-v2";
const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 15, 30];

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
        if (state.cards.length === 0) return;
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
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            files: state.files,
            selectedFileId: state.selectedFileId,
            wrongEntries: state.wrongEntries,
        })
    );
}

async function handleFilesSelected(event) {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
        try {
            const text = await readFileAsText(file);
            const record = {
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type || detectTypeByName(file.name),
                size: file.size,
                createdAt: new Date().toISOString(),
                rawText: normalizeText(text),
                parsedCards: [],
                parsedAt: null,
            };
            state.files.unshift(record);
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
    return await file.text();
}

function renderFileList() {
    fileList.innerHTML = "";
    fileCount.textContent = String(state.files.length);

    if (state.files.length === 0) {
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
            renderFileList();
            renderCurrentView();
            saveToStorage();
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
                renderFileList();
                renderCurrentView();
                saveToStorage();
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

    if (!current.parsedCards || current.parsedCards.length === 0) {
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

    if (cards.length === 0) {
        alert("没有识别到单词卡。请检查文档格式，或把序号调整为 [1]、1:、1： 这类形式。");
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
        posList.forEach((pos) => {
            const chip = document.createElement("span");
            chip.className = "pos-chip";
            chip.textContent = pos;
            posRow.appendChild(chip);
        });
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

    const meaning = card.fields?.["常见词义"] || card.fields?.["生僻词义"] || "未识别释义";
    const extra = [
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
    if (state.cards.length === 0) return;
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
    if (!card) return;
    speakWord(card.word);
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
    if (state.wrongEntries.length !== before) {
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
        items.forEach((item) => {
            parts.push(item.raw.trim());
            parts.push("");
        });
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
    const payload = { exportedAt: new Date().toISOString(), files: state.files, wrongEntries: state.wrongEntries };
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
        .replace(/[ ]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseVocabularyText(text, fileId) {
    let normalized = normalizeText(text);
    if (!normalized) return [];

    normalized = normalized
        .replace(/^\s*单词复习清单\s*[-－—:]\s*\d{4}-\d{2}-\d{2}\s*/m, "")
        .replace(/^\s*单词复习清单.*$/gm, "")
        .trim();

    const chunks = splitIntoWordChunks(normalized);
    return chunks
        .map((chunk) => parseWordChunk(chunk, fileId))
        .filter((item) => item && item.word && !/单词复习清单/.test(item.word));
}

function splitIntoWordChunks(text) {
    const normalized = text.replace(/\n\s*\n/g, "\n");
    const entryRegex = /^\s*(?:\[(\d+)\]|(\d+))\s*[：:．.]\s*(?=[A-Za-z])/gm;
    const starts = [];
    let match;
    while ((match = entryRegex.exec(normalized)) !== null) {
        starts.push({ index: match.index, serial: match[1] || match[2] || "" });
    }

    if (!starts.length) return [];

    const chunks = [];
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i].index;
        const end = i + 1 < starts.length ? starts[i + 1].index : normalized.length;
        const chunk = normalized.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
    }
    return chunks;
}

function parseWordChunk(chunk, fileId) {
    const original = chunk.trim();
    const firstLineBreak = original.indexOf("\n");
    const headerLine = firstLineBreak === -1 ? original : original.slice(0, firstLineBreak).trim();
    const bodyText = firstLineBreak === -1 ? "" : original.slice(firstLineBreak + 1).trim();

    const headMatch = headerLine.match(/^\s*(?:\[(\d+)\]|(\d+))\s*[：:．.]\s*(.+)$/);
    if (!headMatch) return null;

    const serial = (headMatch[1] || headMatch[2] || "").trim();
    const headerRest = (headMatch[3] || "").trim();
    const info = parseHeader(headerRest);
    if (!info.word) return null;

    const fields = parseFields(bodyText);
    return {
        id: `${fileId || "file"}-${serial}-${info.word.toLowerCase()}`,
        fileId,
        serial,
        word: info.word,
        phonetic: info.phonetic,
        pos: info.pos,
        fields,
        raw: original,
    };
}

function parseHeader(headerText) {
    let text = headerText.trim();

    const phoneticMatch = text.match(/\{\s*([^{}]+?)\s*\}/) || text.match(/\[\s*\/(.+?)\/\s*\]/) || text.match(/\/(.+?)\//);
    const phonetic = phoneticMatch ? phoneticMatch[1].trim() : "";
    if (phoneticMatch) text = text.replace(phoneticMatch[0], " ");

    const posMatch = text.match(/\[([^\]]*(?:名词|动词|形容词|副词|代词|介词|连词|数词|冠词|短语)[^\]]*)\]/);
    const pos = posMatch ? posMatch[1].trim() : "";
    if (posMatch) text = text.replace(posMatch[0], " ");

    text = text.replace(/[\u3000]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const wordMatch = text.match(/^([A-Za-z][A-Za-z\-']*)/);
    const word = wordMatch ? wordMatch[1].trim() : text.split(/\s+/)[0] || "";
    return { word, phonetic, pos };
}

function parseFields(bodyText) {
    const fields = {};
    if (!bodyText) return fields;

    const lines = bodyText.split(/\n/).map((line) => line.trim()).filter(Boolean);
    let currentLabel = null;
    let buffer = [];

    const flush = () => {
        if (!currentLabel) return;
        const value = buffer.join(" ").replace(/\s{2,}/g, " ").trim();
        if (value) fields[currentLabel] = value;
        currentLabel = null;
        buffer = [];
    };

    for (const line of lines) {
        const labelMatch = line.match(/^\[([^\]]+)\]\s*[：:]?\s*(.*)$/);
        if (labelMatch) {
            flush();
            currentLabel = labelMatch[1].trim();
            buffer = [labelMatch[2].trim()];
            continue;
        }

        const looseLabel = line.match(/^([^\s\[\]：:]{2,16})\s*[：:]\s*(.+)$/);
        if (looseLabel && isLikelyLooseLabel(looseLabel[1])) {
            flush();
            currentLabel = looseLabel[1].trim();
            buffer = [looseLabel[2].trim()];
            continue;
        }

        if (!currentLabel && /^[A-Za-z].+/.test(line)) {
            fields["补充内容"] = fields["补充内容"] ? `${fields["补充内容"]} ${line}` : line;
        } else {
            buffer.push(line);
        }
    }
    flush();
    return fields;
}

function isLikelyLooseLabel(label) {
    return [
        "常见词义", "生僻词义", "重点程度", "谐音记忆法", "词根记忆法", "场景记忆法",
        "句子翻译", "场景句子翻译", "词组搭配记忆法", "例句", "搭配", "近义词", "反义词", "备注", "补充内容"
    ].includes(label);
}

function rebuildRawText(card) {
    const header = `${card.serial}：${card.word}${card.phonetic ? ` {/${card.phonetic.replace(/^\/+|\/+$/g, "")}/}` : ""}${card.pos ? ` [${card.pos}]` : ""}`;
    const body = orderFields(card.fields || {}).map(([k, v]) => `[${k}]：${v}`).join("\n");
    return `${header}\n${body}`.trim();
}

function normalizePos(posText) {
    if (!posText) return [];
    return posText.split(/[、,，/\s]+/).map((s) => s.trim()).filter(Boolean);
}

function orderFields(fields) {
    const preferred = [
        "常见词义", "生僻词义", "重点程度", "谐音记忆法", "词根记忆法", "场景记忆法",
        "例句", "句子翻译", "场景句子翻译", "词组搭配记忆法", "搭配", "近义词", "反义词", "备注", "补充内容"
    ];
    const entries = Object.entries(fields || {});
    entries.sort((a, b) => {
        const ai = preferred.indexOf(a[0]);
        const bi = preferred.indexOf(b[0]);
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
    const ms = startOfDay(later) - startOfDay(earlier);
    return Math.round(ms / 86400000);
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
    const date = new Date(iso);
    return date.toLocaleString("zh-CN");
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
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
