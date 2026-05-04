/*
  script.js
  Використання:
  - змініть datetime у <time id="target-date">, і таймер автоматично підхопить нову ціль
  - формат target за замовчуванням: 2026-06-01T00:00:00+03:00 (київський літній час)

  Технічні нотатки:
  - окремо зчитуємо цільовий timestamp з <time datetime> — MDN HTML <time>
  - countdown рахується як target - Date.now() на кожному кроці, а не декрементом змінних
  - для таймера використано вирівняний recursive setTimeout, а не 60fps-анімацію;
    MDN попереджає, що setInterval може накопичувати чергу, якщо логіка затримується
  - requestAnimationFrame тут використовується лише для косметичного scanline-ефекту
    і викликається перед наступним repaint — MDN requestAnimationFrame()
  - IntersectionObserver асинхронно виявляє появу блоків у viewport — MDN IntersectionObserver
  - role="status" + aria-live="polite" оновлюють доступний summary без агресивного
    переривання — MDN ARIA live regions / status role
*/

(() => {
  "use strict";

  const targetNode = document.getElementById("target-date");
  const liveNode = document.getElementById("countdown-live");
  const summaryNode = document.getElementById("summary-line");
  const quoteCard = document.getElementById("quote-card");
  const quoteTextNode = document.getElementById("quote-text");
  const quoteAuthorNode = document.getElementById("quote-author");
  const missionNode = document.getElementById("mission-text");

  const valueNodes = {
    days: document.getElementById("days"),
    hours: document.getElementById("hours"),
    minutes: document.getElementById("minutes"),
    seconds: document.getElementById("seconds"),
  };

  const defaultQuotes = [
    {
      text: "Учітеся, брати мої, думайте, читайте.",
      author: "— Тарас Шевченко",
    },
    {
      text: "Без надії таки сподіватись.",
      author: "— Леся Українка",
    },
    {
      text: "Лупайте сю скалу!",
      author: "— Іван Франко",
    },
    {
      text: "Бери вершину і матимеш середину.",
      author: "— Григорій Сковорода",
    },
    { text: 'Борітеся – поборете, Вам Бог помагає!', author: 'Тарас Шевченко' },
                { text: 'В своїй хаті своя й правда, і сила, і воля.', author: 'Тарас Шевченко' },
                { text: 'Ніщо так не зміцнює дух, як боротьба за свободу.', author: 'Іван Франко' },
                { text: 'Лиш боротись – значить жить.', author: 'Іван Франко' },
                { text: 'Душу й тіло ми положим за нашу свободу.', author: 'Гімн України' },
                { text: 'Воля не дається просто так – її виковують.', author: 'Леся Українка' },
                { text: 'Хто не знає свого минулого, не вартий майбутнього.', author: 'Михайло Грушевський' },
                { text: 'Україна понад усе!', author: 'Військове гасло' },
                { text: 'Сила духу перемагає будь-яку зброю.', author: 'Сучасна мудрість' },
                { text: 'Кожен твій крок сьогодні – це внесок у завтрашню перемогу.', author: 'Ліцейне гасло' },
                { text: 'Перемагає той, хто пам’ятає, за що бореться.', author: 'В. Чорновіл' },
                { text: 'Нас не здолати, бо ми – вільний народ.', author: 'Симон Петлюра' },
                { text: 'Справжній воїн не той, хто не падає, а той, хто підводиться.', author: 'Давня мудрість' },
  ];

  const defaultMissions = [
    "Тримати темп і не залишати справ на потім.",
    "Закрити все важливе до кінця дня.",
    "Останні тижні — без хаосу, зате з характером.",
    "Працювати спокійно, точно і до результату.",
    "Вийти в літо з чистою совістю та добрим настроєм.",
  ];

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const targetISO =
    targetNode?.getAttribute("datetime")?.trim() ||
    "2026-06-01T00:00:00+03:00";
  const targetDate = new Date(targetISO);
  const targetTimestamp = targetDate.getTime();

  let countdownTimerId = 0;
  let quoteTimerId = 0;
  let missionTimerId = 0;
  let quoteIndex = 0;
  let missionIndex = 0;
  let lastLiveAnnouncementKey = "";
  let scanlineRafId = 0;
  let revealObserver = null;

  if (Number.isNaN(targetTimestamp)) {
    console.error("Невірна дата цілі у <time datetime>:", targetISO);

    if (summaryNode) {
      summaryNode.textContent =
        "Помилка конфігурації дати. Перевірте атрибут datetime.";
    }

    if (liveNode) {
      liveNode.textContent = "Помилка конфігурації дати.";
    }

    return;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function pluralizeUk(number, one, few, many) {
    const abs = Math.abs(number) % 100;
    const last = abs % 10;

    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function breakdown(ms) {
    const safe = Math.max(0, ms);

    return {
      total: safe,
      days: Math.floor(safe / 86400000),
      hours: Math.floor((safe % 86400000) / 3600000),
      minutes: Math.floor((safe % 3600000) / 60000),
      seconds: Math.floor((safe % 60000) / 1000),
    };
  }

  function updateVisualCountdown(parts) {
    valueNodes.days.textContent = pad(parts.days);
    valueNodes.hours.textContent = pad(parts.hours);
    valueNodes.minutes.textContent = pad(parts.minutes);
    valueNodes.seconds.textContent = pad(parts.seconds);
  }

  // Видимий рядок оновлюємо щосекунди.
  // Live-region оновлюємо лише за зміни хвилини, щоб не створювати зайвий шум для screen readers.
  function updateAccessibleSummary(parts, isComplete) {
    if (!liveNode || !summaryNode) return;

    if (isComplete) {
      document.body.classList.add("is-complete");
      summaryNode.textContent =
        "Літо вже тут. Гарного відпочинку й сильного нового старту після канікул.";
      liveNode.textContent = "Літо вже настало.";
      return;
    }

    const publicSummary = `До літа залишилося ${parts.days} ${pluralizeUk(parts.days, "день", "дні", "днів")}, ${parts.hours} ${pluralizeUk(parts.hours, "година", "години", "годин")}, ${parts.minutes} ${pluralizeUk(parts.minutes, "хвилина", "хвилини", "хвилин")} і ${parts.seconds} ${pluralizeUk(parts.seconds, "секунда", "секунди", "секунд")}.`;

    summaryNode.textContent = publicSummary;

    const liveKey = `${parts.days}|${parts.hours}|${parts.minutes}`;
    if (liveKey !== lastLiveAnnouncementKey) {
      liveNode.textContent = `До літа залишилося ${parts.days} ${pluralizeUk(parts.days, "день", "дні", "днів")}, ${parts.hours} ${pluralizeUk(parts.hours, "година", "години", "годин")} і ${parts.minutes} ${pluralizeUk(parts.minutes, "хвилина", "хвилини", "хвилин")}.`;
      lastLiveAnnouncementKey = liveKey;
    }
  }

  function runCountdown() {
    const now = Date.now();
    const diff = targetTimestamp - now;
    const isComplete = diff <= 0;
    const parts = breakdown(diff);

    updateVisualCountdown(parts);
    updateAccessibleSummary(parts, isComplete);

    if (isComplete) {
      window.clearTimeout(countdownTimerId);
      return;
    }

    const msUntilNextSecond = 1000 - (now % 1000);

    // Невеликий хвіст у кілька мс допомагає потрапляти після зміни секунди.
    countdownTimerId = window.setTimeout(runCountdown, msUntilNextSecond + 12);
  }

  function swapQuote(next) {
    if (!quoteCard || !quoteTextNode || !quoteAuthorNode) return;

    if (reducedMotionQuery.matches) {
      quoteTextNode.textContent = next.text;
      quoteAuthorNode.textContent = next.author;
      return;
    }

    quoteCard.classList.add("is-fading");

    window.setTimeout(() => {
      quoteTextNode.textContent = next.text;
      quoteAuthorNode.textContent = next.author;
      quoteCard.classList.remove("is-fading");
    }, 220);
  }

  function rotateQuotes() {
    quoteIndex = (quoteIndex + 1) % defaultQuotes.length;
    swapQuote(defaultQuotes[quoteIndex]);
  }

  function swapMission(nextText) {
    if (!missionNode) return;

    if (reducedMotionQuery.matches) {
      missionNode.textContent = nextText;
      return;
    }

    missionNode.classList.add("is-updating");

    window.setTimeout(() => {
      missionNode.textContent = nextText;
      missionNode.classList.remove("is-updating");
    }, 180);
  }

  function rotateMission() {
    missionIndex = (missionIndex + 1) % defaultMissions.length;
    swapMission(defaultMissions[missionIndex]);
  }

  function startTextRotators() {
    window.clearInterval(quoteTimerId);
    window.clearInterval(missionTimerId);

    // 12 секунд — у межах бажаного інтервалу 10–15 с для ротації цитат.
    quoteTimerId = window.setInterval(rotateQuotes, 12000);
    missionTimerId = window.setInterval(rotateMission, 14000);
  }

  function setupReveals() {
    const revealTargets = document.querySelectorAll(".reveal");

    if (!revealTargets.length) return;

    if (revealObserver) {
      revealObserver.disconnect();
      revealObserver = null;
    }

    if (reducedMotionQuery.matches || !("IntersectionObserver" in window)) {
      revealTargets.forEach((node) => node.classList.add("is-visible"));
      return;
    }

    revealObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      {
        root: null,
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px",
      },
    );

    revealTargets.forEach((node) => revealObserver.observe(node));
  }

  function scanlineFrame(timestamp) {
    const offset = `${((timestamp * 0.04) % 6).toFixed(2)}px`;
    document.documentElement.style.setProperty("--scan-offset", offset);
    scanlineRafId = window.requestAnimationFrame(scanlineFrame);
  }

  function stopScanline() {
    if (!scanlineRafId) return;
    window.cancelAnimationFrame(scanlineRafId);
    scanlineRafId = 0;
    document.documentElement.style.setProperty("--scan-offset", "0px");
  }

  function updateScanlineState() {
    if (reducedMotionQuery.matches || document.hidden) {
      stopScanline();
      return;
    }

    if (!scanlineRafId) {
      scanlineRafId = window.requestAnimationFrame(scanlineFrame);
    }
  }

  function handleMotionPreferenceChange() {
    setupReveals();
    updateScanlineState();
  }

  function handleVisibilityChange() {
    updateScanlineState();

    if (document.hidden) {
      window.clearTimeout(countdownTimerId);
      window.clearInterval(quoteTimerId);
      window.clearInterval(missionTimerId);
      return;
    }

    // Після повернення у вкладку перераховуємо стан заново від реального часу.
    runCountdown();
    startTextRotators();
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);

  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleMotionPreferenceChange);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(handleMotionPreferenceChange);
  }

  quoteTextNode.textContent = defaultQuotes[0].text;
  quoteAuthorNode.textContent = defaultQuotes[0].author;
  missionNode.textContent = defaultMissions[0];

  setupReveals();
  runCountdown();
  startTextRotators();
  updateScanlineState();
})();
