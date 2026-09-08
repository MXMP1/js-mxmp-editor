// Отслеживаем активные таймеры, чтобы не закрыть воркер раньше времени
let activeTimers = new Set();

function checkComplete() {
  if (activeTimers.size === 0) {
    self.postMessage({ type: 'success' });
    self.close(); // Закрываем воркер, все таймеры завершены
  }
}

// Оборачиваем setInterval — сохраняем ID таймера
const origSetInterval = self.setInterval;
self.setInterval = function (fn, delay, ...args) {
  const id = origSetInterval(fn, delay, ...args);
  activeTimers.add(id);
  return id;
};

const origClearInterval = self.clearInterval;
self.clearInterval = function (id) {
  origClearInterval(id);
  activeTimers.delete(id);
  checkComplete();
};

// Оборачиваем setTimeout
const origSetTimeout = self.setTimeout;
self.setTimeout = function (fn, delay, ...args) {
  const id = origSetTimeout(function () {
    activeTimers.delete(id);
    fn();
    checkComplete();
  }, delay, ...args);
  activeTimers.add(id);
  return id;
};

const origClearTimeout = self.clearTimeout;
self.clearTimeout = function (id) {
  origClearTimeout(id);
  activeTimers.delete(id);
  checkComplete();
};

// Слушаем сообщения от основного потока приложения
self.onmessage = function (e) {
  const { code } = e.data;

  // Перехватываем методы консоли прямо ВНУТРИ ВОРКЕРА
  const methods = ['log', 'warn', 'error', 'info'];
  methods.forEach(type => {
    console[type] = function (...args) {
      // Отправляем логи обратно в главное окно
      self.postMessage({ type: 'console', method: type, args: args });
    };
  });

  try {
    // Выполняем код пользователя в изолированном фоновом потоке
    eval(code);

    // Если нет активных таймеров — считаем, что код завершён
    if (activeTimers.size === 0) {
      self.postMessage({ type: 'success' });
      self.close();
    }
    // Иначе воркер остаётся жить, таймеры работают,
    // и success придёт позже через checkComplete()
  } catch (error) {
    // Если в коде ошибка — отправляем её наверх и закрываемся
    self.postMessage({ type: 'error', message: error.message });
    self.close();
  }
};
