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
    // Сообщаем, что выполнение успешно завершено
    self.postMessage({ type: 'success' });
  } catch (error) {
    // Если в коде ошибка — отправляем её наверх
    self.postMessage({ type: 'error', message: error.message });
  }
};
