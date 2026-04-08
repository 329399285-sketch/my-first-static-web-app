let vocabulary = [];
let currentIndex = 0;

const fileInput = document.getElementById('fileInput');
const cardWrapper = document.getElementById('cardWrapper');
const emptyState = document.getElementById('emptyState');
const statusText = document.getElementById('status');

// 初始化：检查本地存储
window.onload = () => {
    const savedData = localStorage.getItem('myVocabulary');
    if (savedData) {
        vocabulary = JSON.parse(savedData);
        showCard(0);
    }
};

// 1. 文件上传与解析
fileInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    statusText.innerText = "正在解析文档...";

    const reader = new FileReader();
    reader.onload = function (event) {
        const arrayBuffer = event.target.result;

        mammoth.extractRawText({ arrayBuffer: arrayBuffer })
            .then(result => {
                parseText(result.value);
            })
            .catch(err => alert("解析失败: " + err));
    };
    reader.readAsArrayBuffer(file);
});

// 2. 正则表达式解析文本 (根据图片格式定制)
function parseText(text) {
    // 按序号切分，例如 "1: ", "2: "
    const entries = text.split(/(?=\d+[:：])/);
    const parsedData = entries.map(entry => {
        const lines = entry.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) return null;

        // 解析头部信息 1: word {phonetic}
        const headMatch = lines[0].match(/(\d+)[:：]\s*(\w+)\s*\{([^}]+)\}/);

        return {
            id: headMatch ? headMatch[1] : "?",
            word: headMatch ? headMatch[2] : lines[0],
            phonetic: headMatch ? headMatch[3] : "",
            common: findDetail(lines, "[常见词义]"),
            scene: findDetail(lines, "[场景记忆法]"),
            trans: findDetail(lines, "[句子翻译]"),
            collo: findDetail(lines, "[词组搭配记忆法]")
        };
    }).filter(item => item !== null);

    if (parsedData.length > 0) {
        vocabulary = parsedData;
        localStorage.setItem('myVocabulary', JSON.stringify(vocabulary));
        currentIndex = 0;
        showCard(0);
        statusText.innerText = `成功解析 ${vocabulary.length} 个单词`;
    }
}

function findDetail(lines, keyword) {
    const line = lines.find(l => l.includes(keyword));
    return line ? line.split('：')[1] || line.split(':')[1] : "-";
}

// 3. 渲染卡片
function showCard(index) {
    if (vocabulary.length === 0) return;

    const item = vocabulary[index];
    document.getElementById('wordId').innerText = item.id;
    document.getElementById('wordText').innerText = item.word;
    document.getElementById('phonetic').innerText = `{ ${item.phonetic} }`;
    document.getElementById('commonDef').innerText = item.common;
    document.getElementById('sceneMem').innerText = item.scene;
    document.getElementById('sentenceTrans').innerText = item.trans;
    document.getElementById('collocation').innerText = item.collo;

    cardWrapper.classList.remove('hidden');
    emptyState.classList.add('hidden');
}

// 4. 语音播放 (Web Speech API)
document.getElementById('speakBtn').onclick = () => {
    const text = vocabulary[currentIndex].word;
    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'en-US';
    window.speechSynthesis.speak(msg);
};

// 5. 导航控制
document.getElementById('nextBtn').onclick = () => {
    if (currentIndex < vocabulary.length - 1) {
        currentIndex++;
        showCard(currentIndex);
    }
};

document.getElementById('prevBtn').onclick = () => {
    if (currentIndex > 0) {
        currentIndex--;
        showCard(currentIndex);
    }
};

// 6. 下载与删除
document.getElementById('btnDownload').onclick = () => {
    if (vocabulary.length === 0) return alert("没有可导出的数据");
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(vocabulary));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "vocabulary_backup.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
};

document.getElementById('btnDelete').onclick = () => {
    if (confirm("确定要清空云端存储吗？")) {
        localStorage.removeItem('myVocabulary');
        vocabulary = [];
        location.reload();
    }
};