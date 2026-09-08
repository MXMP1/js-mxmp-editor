import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, indentMore, indentLess } from "@codemirror/commands";
import { javascript, scopeCompletionSource } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { getAllFiles, saveFileContent, createNewFile, deleteFile } from "./storage.js";

// ==========================================================================
// 1. АВТОДОПОЛНЕНИЕ: JS-анализатор + глобальные объекты
// ==========================================================================
async function combinedCompletions(context) {
  let word = context.matchBefore(/\w*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  const from = word.from;
  const seen = new Set();
  const options = [];

  // 1a. Подсказки от JavaScript-анализатора (свойства объектов, переменные в области видимости)
  try {
    const jsResult = await scopeCompletionSource(context);
    if (jsResult && jsResult.options) {
      jsResult.options.forEach((opt) => seen.add(opt.label));
      options.push(...jsResult.options);
    }
  } catch (e) {}

  // 1b. Глобальные объекты, которых ещё нет в списке
  const globalNames = Object.getOwnPropertyNames(globalThis);
  for (let i = 0; i < globalNames.length; i++) {
    const name = globalNames[i];
    if (!/^[a-zA-Z_]\w*$/.test(name)) continue;
    if (seen.has(name)) continue;

    let type = "variable";
    try {
      if (typeof globalThis[name] === "function") type = "function";
      if (typeof globalThis[name] === "object" && globalThis[name] !== null) type = "namespace";
    } catch (e) {}

    options.push({ label: name, type });
    seen.add(name);
  }

  return { from, options, validFor: /^\w*$/ };
}

// ==========================================================================
// 2. ТЕМЫ РЕДАКТОРА (CodeMirror)
// ==========================================================================
// Базовая тема: размер шрифта берём из CSS-переменной, чтобы менять его на лету
const editorFontTheme = EditorView.theme({
  "&": { fontSize: "var(--editor-font-size, 16px)", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
});

// Поверх One Dark перекрашиваем "хром" редактора под тему Fresh Modern
const freshEditorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#12151f" },
    ".cm-gutters": { backgroundColor: "#12151f", color: "#4b5364", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(139,92,246,0.07)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(139,92,246,0.12)", color: "#a78bfa" },
    ".cm-content": { caretColor: "#a78bfa" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#a78bfa" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(139,92,246,0.30)",
    },
  },
  { dark: true }
);

// Возвращаем набор расширений темы для выбранного оформления
function editorThemeFor(themeName) {
  return themeName === "fresh-modern" ? [oneDark, freshEditorTheme] : [oneDark];
}

// Compartment позволяет менять тему редактора без пересоздания редактора
const themeCompartment = new Compartment();

// ==========================================================================
// 3. НАСТРОЙКИ (тема, размер шрифта, панель символов) — храним в localStorage
// ==========================================================================
const SETTINGS_KEY = "js_editor_settings";
const MIN_FONT = 12;
const MAX_FONT = 26;
const DEFAULT_SETTINGS = { theme: "vscode-dark", fontSize: 16, extraKeys: true };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    merged.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, Number(merged.fontSize) || DEFAULT_SETTINGS.fontSize));
    return merged;
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

const settings = loadSettings();

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

const root = document.documentElement;
const appEl = document.getElementById("app");

// ==========================================================================
// 4. СОЗДАНИЕ РЕДАКТОРА
// ==========================================================================
let currentFileName = "main.js";
const allFiles = getAllFiles();
const initialCode = allFiles[currentFileName] || "// Пустой файл\n";

// Автосохранение при любом изменении текста
const autoSaveExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    saveFileContent(currentFileName, update.state.doc.toString());
  }
});

const state = EditorState.create({
  doc: initialCode,
  extensions: [
    lineNumbers(),
    javascript(),
    themeCompartment.of(editorThemeFor(settings.theme)),
    editorFontTheme,
    autocompletion({ defaultKeymap: true, override: [combinedCompletions] }),
    keymap.of(defaultKeymap),
    // Tab всегда делает отступ внутри редактора (не уводит фокус на кнопки)
    keymap.of([
      { key: "Tab", run: indentMore },
      { key: "Shift-Tab", run: indentLess },
    ]),
    EditorView.lineWrapping,
    autoSaveExtension,
  ],
});

const view = new EditorView({
  state,
  parent: document.getElementById("editor-container"),
});

// ==========================================================================
// 5. ПРИМЕНЕНИЕ НАСТРОЕК
// ==========================================================================
const settingsDialog = document.getElementById("settings-dialog");
const settingsBtn = document.getElementById("settings-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const themeSegmented = document.getElementById("theme-segmented");
const fontDecreaseBtn = document.getElementById("font-decrease");
const fontIncreaseBtn = document.getElementById("font-increase");
const fontSizeValue = document.getElementById("font-size-value");
const extraKeysToggle = document.getElementById("extrakeys-toggle");

function syncSettingsUI() {
  themeSegmented.querySelectorAll(".segmented-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.themeValue === settings.theme);
  });
  fontSizeValue.textContent = settings.fontSize + "px";
  fontDecreaseBtn.disabled = settings.fontSize <= MIN_FONT;
  fontIncreaseBtn.disabled = settings.fontSize >= MAX_FONT;
  extraKeysToggle.setAttribute("aria-checked", String(settings.extraKeys));
}

function applySettings() {
  // Тема всей страницы (CSS-переменные)
  root.setAttribute("data-theme", settings.theme);
  // Размер шрифта редактора
  root.style.setProperty("--editor-font-size", settings.fontSize + "px");
  // Панель быстрых символов
  appEl.classList.toggle("no-extra-keys", !settings.extraKeys);
  // Цвет браузерной строки
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", settings.theme === "fresh-modern" ? "#0e1016" : "#1e1e1e");
  // Тема самого редактора
  view.dispatch({ effects: themeCompartment.reconfigure(editorThemeFor(settings.theme)) });

  syncSettingsUI();
}

settingsBtn.addEventListener("click", () => {
  syncSettingsUI();
  settingsDialog.showModal();
});
settingsCloseBtn.addEventListener("click", () => settingsDialog.close());

themeSegmented.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-btn");
  if (!btn) return;
  settings.theme = btn.dataset.themeValue;
  persistSettings();
  applySettings();
});

function changeFontSize(delta) {
  settings.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, settings.fontSize + delta));
  persistSettings();
  applySettings();
}
fontDecreaseBtn.addEventListener("click", () => changeFontSize(-1));
fontIncreaseBtn.addEventListener("click", () => changeFontSize(1));

extraKeysToggle.addEventListener("click", () => {
  settings.extraKeys = !settings.extraKeys;
  persistSettings();
  applySettings();
});

// ==========================================================================
// 6. СПИСОК ФАЙЛОВ
// ==========================================================================
const filesListContainer = document.getElementById("files-list");
const addFileBtn = document.getElementById("add-file-btn");
const currentFileNameEl = document.getElementById("current-file-name");

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

function renderFilesList() {
  filesListContainer.innerHTML = "";
  const files = getAllFiles();

  Object.keys(files).forEach((fileName) => {
    const fileRow = document.createElement("div");
    fileRow.className = "file-row";
    if (fileName === currentFileName) {
      fileRow.classList.add("file-row--active");
      fileRow.setAttribute("aria-current", "true");
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = fileName;
    fileRow.appendChild(nameSpan);

    // Клик по строке переключает файл
    fileRow.addEventListener("click", () => switchFile(fileName));

    // Кнопка удаления (нельзя удалить main.js)
    if (fileName !== "main.js") {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "file-delete-btn";
      delBtn.setAttribute("aria-label", `Удалить ${fileName}`);
      delBtn.innerHTML = TRASH_SVG;
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // не переключаем файл
        openDeleteDialog(fileName);
      });
      fileRow.appendChild(delBtn);
    }

    filesListContainer.appendChild(fileRow);
  });
}

function switchFile(fileName) {
  currentFileName = fileName;
  const files = getAllFiles();
  const fileContent = files[fileName] || "";

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: fileContent },
  });

  if (currentFileNameEl) currentFileNameEl.textContent = fileName;
  renderFilesList();
  closeSidebar(); // на мобильном прячем ящик после выбора файла
}

// ==========================================================================
// 7. САЙДБАР: выдвижной ящик (мобильные) / сворачивание (десктоп)
// ==========================================================================
const menuBtn = document.getElementById("menu-btn");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const mobileQuery = window.matchMedia("(max-width: 767px)");

function toggleSidebar() {
  if (mobileQuery.matches) {
    appEl.classList.toggle("sidebar-open");
  } else {
    appEl.classList.toggle("sidebar-collapsed");
  }
}
function closeSidebar() {
  if (mobileQuery.matches) appEl.classList.remove("sidebar-open");
}

menuBtn.addEventListener("click", toggleSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);

// ==========================================================================
// 8. КОНСОЛЬ: шторка (мобильные) + изменение высоты + счётчик новых строк
// ==========================================================================
const mainCol = document.getElementById("main-col");
const consolePane = document.getElementById("console-pane");
const consoleHandle = document.getElementById("console-handle");
const consoleToggleBtn = document.getElementById("console-toggle-btn");
const consoleCloseBtn = document.getElementById("console-close-btn");
const consoleBadge = document.getElementById("console-badge");
let unreadCount = 0;

function setConsoleOpen(open) {
  if (!mobileQuery.matches) return; // на десктопе консоль всегда видна
  mainCol.classList.toggle("console-open", open);
  consoleToggleBtn.setAttribute("aria-pressed", String(open));
  if (open) resetBadge();
}
function toggleConsole() {
  setConsoleOpen(!mainCol.classList.contains("console-open"));
}
function bumpBadge() {
  if (mobileQuery.matches && !mainCol.classList.contains("console-open")) {
    unreadCount++;
    consoleBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    consoleBadge.classList.remove("is-hidden");
  }
}
function resetBadge() {
  unreadCount = 0;
  consoleBadge.textContent = "0";
  consoleBadge.classList.add("is-hidden");
}

consoleToggleBtn.addEventListener("click", toggleConsole);
consoleCloseBtn.addEventListener("click", () => setConsoleOpen(false));

// Перетаскивание границы консоли (работает и на ПК, и на телефоне)
let resizing = false;
let resizeStartY = 0;
let resizeStartH = 0;

consoleHandle.addEventListener("pointerdown", (e) => {
  resizing = true;
  resizeStartY = e.clientY;
  resizeStartH = consolePane.getBoundingClientRect().height;
  consoleHandle.setPointerCapture(e.pointerId);
  document.body.classList.add("is-resizing");
  e.preventDefault();
});
consoleHandle.addEventListener("pointermove", (e) => {
  if (!resizing) return;
  const dy = resizeStartY - e.clientY; // тянем вверх — консоль растёт
  const parentH = mainCol.clientHeight || window.innerHeight;
  const minH = 90;
  const maxH = Math.max(minH + 10, parentH * 0.9);
  const nextH = Math.max(minH, Math.min(maxH, resizeStartH + dy));
  root.style.setProperty("--console-height", nextH + "px");
});
function endResize(e) {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove("is-resizing");
  try {
    consoleHandle.releasePointerCapture(e.pointerId);
  } catch (err) {}
}
consoleHandle.addEventListener("pointerup", endResize);
consoleHandle.addEventListener("pointercancel", endResize);

// ==========================================================================
// 9. ПАНЕЛЬ БЫСТРЫХ СИМВОЛОВ (вставка в редактор без потери фокуса)
// ==========================================================================
const extraKeys = document.getElementById("extra-keys");

function insertText(text) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}
function insertPair(open, close) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected.length > 0) {
    view.dispatch({
      changes: { from, to, insert: open + selected + close },
      selection: { anchor: from + open.length, head: from + open.length + selected.length },
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      changes: { from, insert: open + close },
      selection: { anchor: from + open.length },
      scrollIntoView: true,
    });
  }
  view.focus();
}

// Не даём кнопкам украсть фокус у редактора (важно на ПК, помогает на мобильном)
extraKeys.addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) e.preventDefault();
});
extraKeys.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.key === "tab") {
    indentMore(view);
    view.focus();
    return;
  }
  const pair = btn.dataset.pair;
  if (pair) {
    insertPair(pair[0], pair[pair.length - 1]);
    return;
  }
  if (btn.dataset.insert != null) {
    insertText(btn.dataset.insert);
  }
});

// ==========================================================================
// 10. ЗАПУСК КОДА (Web Worker) И ВЫВОД В КОНСОЛЬ
// ==========================================================================
const runBtn = document.getElementById("run-btn");
const runBtnLabel = document.getElementById("run-btn-label");
const stopBtn = document.getElementById("stop-btn");
const consoleOutput = document.getElementById("console-output");
const clearConsoleBtn = document.getElementById("clear-console-btn");
let currentWorker = null;

function setRunningUI(running) {
  stopBtn.classList.toggle("is-hidden", !running);
  runBtn.classList.toggle("is-running", running);
  runBtnLabel.textContent = running ? "Выполняется…" : "Запустить";
}

function printToScreenConsole(type, args) {
  const message = args
    .map((arg) => {
      if (typeof arg === "object" && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");

  const logLine = document.createElement("div");
  logLine.className = "log-line";
  logLine.textContent = `> ${message}`;

  if (type === "warn") logLine.classList.add("log-line--warn");
  else if (type === "error") logLine.classList.add("log-line--error");
  else if (type === "info") logLine.classList.add("log-line--info");

  consoleOutput.appendChild(logLine);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
  bumpBadge();
}

function stopExecution() {
  if (!currentWorker) return;
  currentWorker.terminate(); // жёстко убиваем поток с бесконечным циклом
  currentWorker = null;
  printToScreenConsole("warn", ["Выполнение кода принудительно остановлено."]);
  setRunningUI(false);
}

clearConsoleBtn.addEventListener("click", () => {
  consoleOutput.innerHTML = "";
  resetBadge();
});
stopBtn.addEventListener("click", stopExecution);

runBtn.addEventListener("click", () => {
  // Повторный клик по "Запустить" во время выполнения = Стоп
  if (currentWorker) {
    stopExecution();
    return;
  }

  const codeToRun = view.state.doc.toString();
  consoleOutput.innerHTML = "";
  resetBadge();
  setConsoleOpen(true); // на мобильном сразу показываем результат
  setRunningUI(true);

  currentWorker = new Worker(new URL("./eval-worker.js", import.meta.url), { type: "module" });

  currentWorker.onmessage = function (e) {
    const data = e.data;
    if (data.type === "console") {
      printToScreenConsole(data.method, data.args);
    } else if (data.type === "success") {
      setRunningUI(false);
      currentWorker = null;
    } else if (data.type === "error") {
      printToScreenConsole("error", [`[Ошибка]: ${data.message}`]);
      setRunningUI(false);
      currentWorker = null;
    }
  };

  currentWorker.postMessage({ code: codeToRun });
});

// ==========================================================================
// 11. ДИАЛОГ: СОЗДАНИЕ ФАЙЛА
// ==========================================================================
const fileDialog = document.getElementById("file-dialog");
const fileNameInput = document.getElementById("new-file-name-input");
const dialogCancelBtn = document.getElementById("dialog-cancel-btn");
const dialogSaveBtn = document.getElementById("dialog-save-btn");
const dialogErrorMsg = document.getElementById("dialog-error-msg");

function showFileError(msg) {
  dialogErrorMsg.textContent = msg;
  dialogErrorMsg.classList.add("is-visible");
}
function hideFileError() {
  dialogErrorMsg.textContent = "";
  dialogErrorMsg.classList.remove("is-visible");
}

addFileBtn.addEventListener("click", () => {
  fileNameInput.value = "";
  hideFileError();
  fileDialog.showModal();
  fileNameInput.focus();
});

dialogCancelBtn.addEventListener("click", () => fileDialog.close());

function handleCreateFile() {
  const nameWithoutExtension = fileNameInput.value.trim();

  if (!nameWithoutExtension) {
    showFileError("Имя файла не может быть пустым!");
    return;
  }

  const fullFileName = `${nameWithoutExtension}.js`;
  if (createNewFile(fullFileName)) {
    switchFile(fullFileName);
    fileDialog.close();
  } else {
    showFileError("Файл с таким именем уже существует!");
  }
}

dialogSaveBtn.addEventListener("click", handleCreateFile);
fileNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleCreateFile();
  }
});

// ==========================================================================
// 12. ДИАЛОГ: УДАЛЕНИЕ ФАЙЛА
// ==========================================================================
const deleteDialog = document.getElementById("delete-dialog");
const deleteDialogText = document.getElementById("delete-dialog-text");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
let fileToDelete = "";

function openDeleteDialog(fileName) {
  fileToDelete = fileName;
  deleteDialogText.textContent = `Вы действительно хотите удалить файл ${fileName}? Восстановить его будет невозможно.`;
  deleteDialog.showModal();
}

deleteCancelBtn.addEventListener("click", () => {
  deleteDialog.close();
  fileToDelete = "";
});

deleteConfirmBtn.addEventListener("click", () => {
  if (!fileToDelete) return;
  deleteFile(fileToDelete);
  if (currentFileName === fileToDelete) {
    switchFile("main.js");
  } else {
    renderFilesList();
  }
  deleteDialog.close();
  fileToDelete = "";
});

// ==========================================================================
// 13. КЛАВИАТУРА: подъём интерфейса над виртуальной клавиатурой (iOS)
// ==========================================================================
function setupKeyboardInset() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const update = () => {
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty("--kb-inset", inset + "px");
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  update();
}

// ==========================================================================
// 14. ГОРЯЧАЯ КЛАВИША: Ctrl/Cmd + Enter — запуск кода
// ==========================================================================
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runBtn.click();
  }
});

// ==========================================================================
// 15. ИНИЦИАЛИЗАЦИЯ
// ==========================================================================
applySettings();
renderFilesList();
if (currentFileNameEl) currentFileNameEl.textContent = currentFileName;
setRunningUI(false);
setupKeyboardInset();
