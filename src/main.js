import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

// Начальный код в редакторе
const initialCode = `// Твой первый JS код на телефоне!\nconsole.log("Привет, мир!");\n`;

// Создаем состояние редактора с плагинами
const state = EditorState.create({
  doc: initialCode,
  extensions: [
    lineNumbers(),        // Включаем нумерацию строк
    javascript(),         // Подсветка и автодополнение для JS
    oneDark,              // Темная тема
    keymap.of(defaultKeymap), // Стандартные горячие клавиши
    EditorView.lineWrapping   // Автоперенос длинных строк (важно для мобилок)
  ],
});

// Инициализируем сам редактор в нашем HTML-контейнере
const view = new EditorView({
  state,
  parent: document.getElementById("editor-container"),
});

 // Логика кнопки "Запустить код" с перехватом консоли
  const runBtn = document.getElementById("run-btn");
  const consoleOutput = document.getElementById("console-output");

  if (runBtn && consoleOutput) {
    runBtn.addEventListener("click", () => {
      const codeToRun = view.state.doc.toString(); // Получаем текст из редактора
      
      // 1. Очищаем консоль перед новым запуском
      consoleOutput.innerHTML = ""; 

      // 2. Сохраняем оригинальный console.log, чтобы не сломать логи браузера
      const originalLog = console.log;

      // 3. Создаем свою функцию перехвата
      console.log = function (...args) {
        // Вызываем оригинальный лог, чтобы в консоли разработчика (F12) тоже всё дублировалось
        originalLog.apply(console, args);

        // Превращаем все аргументы в строки и объединяем через пробел
        const message = args.map(arg => {
          if (typeof arg === 'object') {
            return JSON.stringify(arg, null, 2); // Красивый вывод для объектов и массивов
          }
          return String(arg);
        }).join(' ');

        // Создаем новый элемент строки для нашей экранной консоли
        const logLine = document.createElement("div");
        logLine.style.fontFamily = "monospace";
        logLine.style.padding = "4px 0";
        logLine.style.borderBottom = "1px solid #222";
        logLine.style.whiteSpace = "pre-wrap"; // Сохраняем переносы строк внутри объектов
        logLine.textContent = `> ${message}`;

        consoleOutput.appendChild(logLine);
      };

      // 4. Безопасно запускаем код пользователя через try...catch
      try {
        // eval исполняет строку как обычный JS код
        eval(codeToRun); 
      } catch (error) {
        // Если в коде пользователя ошибка — выводим её красным цветом в нашу консоль
        const errorLine = document.createElement("div");
        errorLine.style.color = "#ff6b6b";
        errorLine.style.fontFamily = "monospace";
        errorLine.style.fontWeight = "bold";
        errorLine.textContent = `[Ошибка]: ${error.message}`;
        consoleOutput.appendChild(errorLine);
      }

      // 5. Возвращаем оригинальный console.log на место после выполнения кода
      console.log = originalLog;
    });
  }
