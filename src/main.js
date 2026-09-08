import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, indentMore, indentLess } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { scopeCompletionSource } from "@codemirror/lang-javascript";
import { getAllFiles, saveFileContent, createNewFile, deleteFile } from "./storage.js";

// 1. Объединённый источник подсказок: JS-анализатор + глобальные объекты
async function combinedCompletions(context) {
  let word = context.matchBefore(/\w*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  const from = word.from;
  const seen = new Set();
  const options = [];

  // 1a. Получаем подсказки от JavaScript-анализатора (свойства объектов, переменные в области видимости)
  try {
    const jsResult = await scopeCompletionSource(context);
    if (jsResult && jsResult.options) {
      jsResult.options.forEach(opt => { seen.add(opt.label); });
      options.push(...jsResult.options);
    }
  } catch (e) {}

  // 1b. Добавляем глобальные объекты, которых ещё нет в списке
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

// Кастомная тема для настройки высоты и шрифта редактора
const customTheme = EditorView.theme({
  "&": {
    fontSize: "16px", // Идеальный размер для мобильных экранов, чтобы браузер не зумил при фокусе
    height: "100%"
  },
  ".cm-scroller": {
    fontFamily: "JetBrains Mono, Fira Code, monospace", // Красивый моноширинный шрифт
  }
});

// Переменная для отслеживания текущего открытого файла
let currentFileName = "main.js";

// Берем файлы из локального хранилища
const allFiles = getAllFiles();
const initialCode = allFiles[currentFileName] || "// Пустой файл\n";

// Функция, которая срабатывает при ЛЮБОМ изменении текста в редакторе (Автосохранение!)
const autoSaveExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    const currentDocText = update.state.doc.toString();
    saveFileContent(currentFileName, currentDocText);
  }
});

// Создаем состояние редактора с плагинами
const state = EditorState.create({
  doc: initialCode,
  extensions: [
    lineNumbers(),        // Включаем нумерацию строк
    javascript(),         // Подсветка и автодополнение для JS
    oneDark,              // Темная тема
    customTheme,          // Применяем наши стили шрифта
    autocompletion({ 
      defaultKeymap: true,
      override: [combinedCompletions] 
    }), // Включаем автодополнение с объединёнными подсказками
    keymap.of(defaultKeymap), // Стандартные горячие клавиши
    // Tab всегда делает отступ внутри редактора (не уводит фокус на кнопки)
    keymap.of([
      { key: "Tab", run: indentMore },
      { key: "Shift-Tab", run: indentLess }
    ]),
    EditorView.lineWrapping,   // Автоперенос длинных строк (важно для мобилок)
    autoSaveExtension // Подключаем наше автосохранение!
  ],
});

// Инициализируем сам редактор в нашем HTML-контейнере
const view = new EditorView({
  state,
  parent: document.getElementById("editor-container"),
});

// --- ЛОГИКА ИНТЕРФЕЙСА ФАЙЛОВ ---

const filesListContainer = document.getElementById("files-list");
const addFileBtn = document.getElementById("add-file-btn");

// Функция для рендеринга списка файлов в сайдбаре
function renderFilesList() {
  filesListContainer.innerHTML = "";
  const files = getAllFiles();

  Object.keys(files).forEach(fileName => {
    const fileRow = document.createElement("div");
    fileRow.className = "file-row";
    
    // Подсвечиваем активный файл
    if (fileName === currentFileName) {
      fileRow.classList.add("file-row--active");
    }

    // Название файла (клик по нему переключает файл)
    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = fileName;
    nameSpan.addEventListener("click", () => switchFile(fileName));
    fileRow.appendChild(nameSpan);

    // Кнопка удаления файла (крестик)
    if (fileName !== "main.js") {
      const delBtn = document.createElement("span");
      delBtn.className = "file-delete-btn";
      delBtn.textContent = "×";
      
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Чтобы не сработало переключение файла
        
        // Вызываем наше кастомное окно удаления
        openDeleteDialog(fileName);
      });
      fileRow.appendChild(delBtn);
    }

    filesListContainer.appendChild(fileRow);
  });
}

// Функция переключения между файлами
function switchFile(fileName) {
  currentFileName = fileName;
  const files = getAllFiles();
  const fileContent = files[fileName] || "";

  // Обновляем текст внутри редактора безопасным путем через dispatch
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: fileContent }
  });

  renderFilesList();
}

// Находим новые элементы диалогового окна
const fileDialog = document.getElementById("file-dialog");
const fileNameInput = document.getElementById("new-file-name-input");
const dialogCancelBtn = document.getElementById("dialog-cancel-btn");
const dialogSaveBtn = document.getElementById("dialog-save-btn");
// Находим элемент текста ошибки в диалоге
const dialogErrorMsg = document.getElementById("dialog-error-msg");

// 1. Открытие окна при клике на "+ Новый файл"
addFileBtn.addEventListener("click", () => {
  fileNameInput.value = ""; // Очищаем поле перед открытием
  dialogErrorMsg.style.display = "none"; // Скрываем прошлую ошибку при новом открытии
  dialogErrorMsg.textContent = "";
  fileDialog.showModal();   // Метод showModal() открывает окно как полноценный попап с затемнением заднего фона
  fileNameInput.focus();    // Сразу фокусируемся на инпуте (на ПК поднимет фокус, на мобилке может вызвать клавиатуру)
});

// 2. Закрытие окна при клике на "Отмена"
dialogCancelBtn.addEventListener("click", () => {
  fileDialog.close();       // Закрываем окно
});

// 3. Логика сохранения файла по кнопке "Создать"
function handleCreateFile() {
  const nameWithoutExtension = fileNameInput.value.trim();
  
  // Валидация на пустое поле через текст в попапе
  if (!nameWithoutExtension) {
    dialogErrorMsg.textContent = "Имя файла не может быть пустым!";
    dialogErrorMsg.style.display = "block";
    return;
  }

  // Автоматически приклеиваем .js к введённому имени
  const fullFileName = `${nameWithoutExtension}.js`;

  if (createNewFile(fullFileName)) {
    switchFile(fullFileName);
    fileDialog.close(); // Закрываем окно после успешного создания
  } else {
    // Валидация на дубликат через текст в попапе
    dialogErrorMsg.textContent = "Файл с таким именем уже существует!";
    dialogErrorMsg.style.display = "block";
  }
}

// Срабатывает при клике на синюю кнопку в попапе
dialogSaveBtn.addEventListener("click", handleCreateFile);

// Удобство: создание файла по нажатию клавиши Enter внутри инпута
fileNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
     e.preventDefault();
    handleCreateFile();
  }
});

// Инициализируем список файлов при первой загрузке приложения
renderFilesList();

 // Логика кнопки "Запустить код" с перехватом консоли
  const runBtn = document.getElementById("run-btn");
  const consoleOutput = document.getElementById("console-output");

// --- УПРАВЛЕНИЕ ЗАПУСКОМ КОДА И КОНСОЛЬЮ ---
const stopBtn = document.getElementById("stop-btn");
const clearConsoleBtn = document.getElementById("clear-console-btn");

let currentWorker = null; // Переменная для хранения активного фонового потока

// 1. Кнопка «Очистить консоль»
if (clearConsoleBtn && consoleOutput) {
  clearConsoleBtn.addEventListener("click", () => {
    consoleOutput.innerHTML = "";
  });
}

// 2. Функция для вывода логов на экран (мы её немного упростили, так как типы приходят из воркера)
function printToScreenConsole(type, args) {
  const message = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg, null, 2);
    return String(arg);
  }).join(' ');

  const logLine = document.createElement("div");
  logLine.className = "log-line";
  logLine.textContent = `> ${message}`;

  if (type === 'warn') {
    logLine.classList.add("log-line--warn");
  } else if (type === 'error') {
    logLine.classList.add("log-line--error");
  } else if (type === 'info') {
    logLine.classList.add("log-line--info");
  }

  consoleOutput.appendChild(logLine);
  consoleOutput.scrollTop = consoleOutput.scrollHeight; // Автоскролл консоли вниз
}

// 3. Функция остановки зависшего кода
function stopExecution() {
  if (currentWorker) {
    currentWorker.terminate(); // Жестко убиваем фоновый поток с бесконечным циклом
    currentWorker = null;
    
    printToScreenConsole('warn', ['Выполнение кода принудительно остановлено пользователем.']);
    
    // Меняем состояние кнопок назад
    stopBtn.style.display = "none";
    runBtn.textContent = "▶ Запустить код";
  }
}

// Привязываем клик по кнопке «Стоп»
if (stopBtn) {
  stopBtn.addEventListener("click", stopExecution);
}

// 4. Логика кнопки «Запустить код» через Web Worker
if (runBtn && consoleOutput) {
  runBtn.addEventListener("click", () => {
    // Если код уже запущен, повторный клик сработает как Стоп
    if (currentWorker) {
      stopExecution();
      return;
    }

    const codeToRun = view.state.doc.toString();
    consoleOutput.innerHTML = ""; // Очищаем консоль

    // Показываем кнопку Стоп и меняем текст кнопки Запуск
    stopBtn.style.display = "block";
    runBtn.textContent = "⌛ Выполняется...";

    // Инициализируем новый фоновый Worker через специальный синтаксис Vite
    currentWorker = new Worker(new URL('./eval-worker.js', import.meta.url), { type: 'module' });

    // Слушаем ответы от фонового потока
    currentWorker.onmessage = function (e) {
      const data = e.data;

      if (data.type === 'console') {
        // Если воркер прислал лог — выводим на экран
        printToScreenConsole(data.method, data.args);
      } 
      else if (data.type === 'success') {
        // Код выполнился (воркер сам закрылся, т.к. нет активных таймеров)
        stopBtn.style.display = "none";
        runBtn.textContent = "▶ Запустить код";
        currentWorker = null;
      } 
      else if (data.type === 'error') {
        // Произошла ошибка во время выполнения кода
        printToScreenConsole('error', [`[Ошибка]: ${data.message}`]);
        stopBtn.style.display = "none";
        runBtn.textContent = "▶ Запустить код";
        currentWorker = null;
      }
    };

    // Запускаем код! Отправляем строку с кодом в воркер
    currentWorker.postMessage({ code: codeToRun });
  });
}


  // --- ЛОГИКА ОКНА УДАЛЕНИЯ ---
const deleteDialog = document.getElementById("delete-dialog");
const deleteDialogText = document.getElementById("delete-dialog-text");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");

let fileToDelete = ""; // Переменная для хранения имени файла, выбранного для удаления

// Функция открытия окна удаления
function openDeleteDialog(fileName) {
  fileToDelete = fileName;
  deleteDialogText.textContent = `Вы действительно хотите удалить файл ${fileName}? Восстановить его будет невозможно.`;
  deleteDialog.showModal();
}

// Клик по кнопке "Отмена" в окне удаления
deleteCancelBtn.addEventListener("click", () => {
  deleteDialog.close();
  fileToDelete = ""; // Очищаем ссылку
});

// Клик по кнопке "Удалить" (финальное удаление)
deleteConfirmBtn.addEventListener("click", () => {
  if (fileToDelete) {
    deleteFile(fileToDelete);
    
    // Если мы удалили тот файл, который прямо сейчас открыт — переключаем на main.js
    if (currentFileName === fileToDelete) {
      switchFile("main.js");
    } else {
      renderFilesList(); // Иначе просто обновляем список в сайдбаре
    }
    
    deleteDialog.close();
    fileToDelete = "";
  }
});