// Ключ, по которому мы храним данные в браузере
const STORAGE_KEY = "js_editor_files";

// Дефолтный файл, если у пользователя еще ничего не сохранено
const defaultFiles = {
  "main.js": "// Твой первый JS код на телефоне!\nconsole.log('Привет, мир!');\n",
  "test.js": "// Другой файл для тестов\nconsole.warn('Это тест номер 2');\n"
};

// Получить все файлы из LocalStorage
export function getAllFiles() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    // Если пусто, сохраняем дефолтные файлы и возвращаем их
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultFiles));
    return defaultFiles;
  }
  return JSON.parse(data);
}

// Сохранить код конкретного файла
export function saveFileContent(fileName, content) {
  const files = getAllFiles();
  files[fileName] = content;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

// Создать новый файл
export function createNewFile(fileName) {
  const files = getAllFiles();
  if (files[fileName] !== undefined) return false; // Файл уже есть
  files[fileName] = `// Файл ${fileName}\n`;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  return true;
}

// Удалить файл
export function deleteFile(fileName) {
  const files = getAllFiles();
  delete files[fileName];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}
