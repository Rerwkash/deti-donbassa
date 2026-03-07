export default function HomePage() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Deti Donbassa</p>
        <h1>Telegram-бот для графика воды и синхронизации с Google и Microsoft Calendar</h1>
        <p className="lead">
          Бот работает через кнопки: подключает календари, помогает настроить дату подачи воды,
          запоминает примерное время начала и окончания и рассылает напоминания в день воды.
        </p>
        <div className="panel">
          <h2>Что умеет бот</h2>
          <ul>
            <li>Подключать Microsoft Calendar и Google Calendar через OAuth.</li>
            <li>Настраивать базовую дату воды кнопками: месяц, день, периодичность.</li>
            <li>Синхронизировать события сразу в оба календаря.</li>
            <li>Напоминать в день воды и просить отметить реальное начало и окончание.</li>
            <li>Использовать отмеченное время для следующих уведомлений и календарей.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
