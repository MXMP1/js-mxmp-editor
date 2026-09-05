import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { scopeCompletionSource } from "@codemirror/lang-javascript";
import { getAllFiles, saveFileContent, createNewFile, deleteFile } from "./storage.js";

// 1. Создаем мощный кастомный источник подсказок для глобальной области видимости
function customGlobalCompletions(context) {
  // Находим слово, которое сейчас вводится
  let word = context.matchBefore(/\w*/);
  
  // Если ввода нет или мы внутри строки/комментария — ничего не предлагаем
  if (!word || (word.from == word.to && !context.explicit)) return null;

  // Собираем список всех глобальных штук (console, setTimeout, Math, Array и т.д.)
  const options = Object.getOwnPropertyNames(globalThis)
    .filter(name => /^[a-zA-Z_]\w*$/.test(name)) // Берем только валидные имена переменных
    .map(name => {
      // Пытаемся определить тип для красивой иконки в меню подсказок
      let type = "variable";
      try {
        if (typeof globalThis[name] === "function") type = "function";
        if (typeof globalThis[name] === "object" && globalThis[name] !== null) type = "namespace";
      } catch(e) {}
      
      return { label: name, type: type };
    });

  return {
    from: word.from,
    options: options,
    validFor: /^\w*$/
  };
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
                          // Закидываем наш кастомный источник в массив override
      override: [customGlobalCompletions] 
    }), // Включаем автодополнение (работает на лету!)
    keymap.of(defaultKeymap), // Стандартные горячие клавиши
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
    fileRow.style.display = "flex";
    fileRow.style.justifyContent = "space-between";
    fileRow.style.alignItems = "center";
    fileRow.style.padding = "8px 10px";
    fileRow.style.cursor = "pointer";
    fileRow.style.borderBottom = "1px solid #333";
    fileRow.style.fontSize = "14px";
    
    // Подсвечиваем активный файл
    if (fileName === currentFileName) {
      fileRow.style.background = "#37373d";
      fileRow.style.fontWeight = "bold";
    }

    // Название файла (клик по нему переключает файл)
    const nameSpan = document.createElement("span");
    nameSpan.textContent = fileName;
    nameSpan.style.flex = "1";
    nameSpan.addEventListener("click", () => switchFile(fileName));
    fileRow.appendChild(nameSpan);

    // Кнопка удаления файла (крестик)
    if (fileName !== "main.js") { // Запретим удалять главный файл для безопасности
      const delBtn = document.createElement("span");
      delBtn.textContent = "×";
      delBtn.style.color = "#ff6b6b";
      delBtn.style.padding = "0 5px";
      delBtn.style.fontSize = "18px";
      delBtn.style.fontWeight = "bold";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Чтобы не сработало переключение файла
        if (confirm(`Удалить файл ${fileName}?`)) {
          deleteFile(fileName);
          if (currentFileName === fileName) {
            switchFile("main.js");
          } else {
            renderFilesList();
          }
        }
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

// 1. Открытие окна при клике на "+ Новый файл"
addFileBtn.addEventListener("click", () => {
  fileNameInput.value = ""; // Очищаем поле перед открытием
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
  
  // Валидация на пустое поле
  if (!nameWithoutExtension) {
    alert("Имя файла не может быть пустым!"); // Пока оставим алерт, но его тоже можно заменить на красивую надпись в самом диалоге
    return;
  }

  // Автоматически приклеиваем .js к введённому имени
  const fullFileName = `${nameWithoutExtension}.js`;

  if (createNewFile(fullFileName)) {
    switchFile(fullFileName);
    fileDialog.close(); // Закрываем окно после успешного создания
  } else {
    alert("Файл с таким именем уже существует!");
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

  if (runBtn && consoleOutput) {
    runBtn.addEventListener("click", () => {
      const codeToRun = view.state.doc.toString(); // Получаем текст из редактора
      
      // 1. Очищаем консоль перед новым запуском
      consoleOutput.innerHTML = ""; 

      // 2. Сохраняем оригинальные методы консоли
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
      };

      // Функция для создания красивой строки в нашей консоли
      function createLogElement(type, args) {
        originalConsole[type].apply(console, args); // Дублируем в F12

        const message = args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            return JSON.stringify(arg, null, 2);
          }
          return String(arg);
        }).join(' ');

        const logLine = document.createElement("div");
        logLine.style.fontFamily = "monospace";
        logLine.style.padding = "6px 0";
        logLine.style.borderBottom = "1px solid #222";
        logLine.style.whiteSpace = "pre-wrap";
        logLine.textContent = `> ${message}`;

        // Подсвечиваем цветом в зависимости от типа метода
        if (type === 'warn') {
          logLine.style.color = "#ffcb6b"; // Желтый для варнингов
          logLine.style.backgroundColor = "rgba(255, 203, 107, 0.05)";
        } else if (type === 'error') {
          logLine.style.color = "#f07178"; // Красный для ошибок консоли
          logLine.style.backgroundColor = "rgba(240, 113, 120, 0.05)";
        } else if (type === 'info') {
          logLine.style.color = "#82aaff"; // Синий для инфо
        }

        consoleOutput.appendChild(logLine);
      }

      // 3. Подменяем методы
      console.log = (...args) => createLogElement('log', args);
      console.warn = (...args) => createLogElement('warn', args);
      console.error = (...args) => createLogElement('error', args);
      console.info = (...args) => createLogElement('info', args);

      // 4. Безопасно запускаем код пользователя
      try {
        eval(codeToRun); 
      } catch (error) {
        const errorLine = document.createElement("div");
        errorLine.style.color = "#ff6b6b";
        errorLine.style.fontFamily = "monospace";
        errorLine.style.fontWeight = "bold";
        errorLine.style.padding = "6px 0";
        errorLine.textContent = `[Критическая ошибка выполнения]: ${error.message}`;
        consoleOutput.appendChild(errorLine);
      }

      // 5. Возвращаем всё назад
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
    });
  }
