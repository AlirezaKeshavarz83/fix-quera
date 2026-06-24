const BOX_ID = "deadline-viewer-box";
const STYLE_ID = "deadline-viewer-style";
const TOOLTIP_ID = "deadline-viewer-tooltip";
const TEHRAN_TIME_ZONE = "Asia/Tehran";
const COURSE_TOTAL_ID = "deadline-viewer-course-total";
const COURSE_CACHE_PREFIX = "qdv-course-delay";
const COURSE_CACHE_TTL_MS = 10 * 60 * 1000;
const COURSE_QUEUE_BATCH_SIZE = 1;
const COURSE_QUEUE_DELAY_MS = 1000;
const COURSE_QUEUE_JITTER_MS = 250;
const COURSE_DELAY_STATUS = {
  loading: "loading",
  fresh: "fresh",
  stale: "stale",
  error: "error"
};

// Course pages can list many assignments. Keep fetches serialized so opening a
// course does not burst requests at Quera, and keep per-assignment state stable
// while cached values are shown before fresh values arrive.
const courseFetchQueue = [];
const courseInFlight = new Map();
const courseQueuedWork = new Map();
let courseQueueRunning = false;
let courseRenderTimer = null;
let courseObserver = null;
let lastCourseAssignmentSignature = "";
let lastBootRoute = "";
let routePollTimer = null;
let activeCourseRenderId = 0;

function extractDeadlineData() {
  const data = {
    serverNow: null,
    finishTime: null,
    extraTimeSeconds: null
  };

  // Quera's legacy assignment pages expose deadline values as script globals,
  // not as structured DOM data. Scraping only these known variables keeps the
  // extension independent of visual countdown text and locale formatting.
  const patterns = {
    serverNow: /(?:var|let|const)\s+server_now\s*=\s*new\s+Date\s*\(['"]([^'"]+)['"]\)/,
    finishTime: /(?:var|let|const)\s+finish_time\s*=\s*new\s+Date\s*\(['"]([^'"]+)['"]\)/,
    extraTimeSeconds: /(?:var|let|const)\s+extra_time\s*=\s*([0-9]+)/
  };

  for (const script of document.scripts) {
    const text = script.textContent || "";

    if (!data.serverNow) {
      const match = text.match(patterns.serverNow);
      if (match) data.serverNow = parseDateValue(match[1]);
    }

    if (!data.finishTime) {
      const match = text.match(patterns.finishTime);
      if (match) data.finishTime = parseDateValue(match[1]);
    }

    if (data.extraTimeSeconds === null) {
      const match = text.match(patterns.extraTimeSeconds);
      if (match) data.extraTimeSeconds = Number(match[1]);
    }

    if (data.serverNow && data.finishTime && data.extraTimeSeconds !== null) {
      break;
    }
  }

  if (!data.serverNow || !data.finishTime || data.extraTimeSeconds === null) {
    return null;
  }

  const hardFinishTime = new Date(
    data.finishTime.date.getTime() + data.extraTimeSeconds * 1000
  );

  return {
    ...data,
    hardFinishTime,
    status: getDeadlineStatus(data.serverNow.date, data.finishTime.date, hardFinishTime)
  };
}

function parseDateValue(raw) {
  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return { raw, date };
}

function getDeadlineStatus(serverNow, finishTime, hardFinishTime) {
  if (serverNow < finishTime) {
    return {
      label: "زمان عادی",
      className: "is-normal"
    };
  }

  if (serverNow < hardFinishTime) {
    return {
      label: "زمان اضافه",
      className: "is-extra"
    };
  }

  return {
    label: "پایان یافته",
    className: "is-finished"
  };
}

function formatDate(date) {
  const parts = new Intl.DateTimeFormat("fa-IR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: TEHRAN_TIME_ZONE
  }).formatToParts(date);

  const valueByType = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${valueByType.weekday} ${valueByType.day} ${valueByType.month}`;
}

function formatHoverTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: TEHRAN_TIME_ZONE
  }).format(date);
}

function getDeadlineDetail(result) {
  if (result.serverNow.date < result.finishTime.date) {
    return {
      label: "مهلت اضافه",
      value: formatCompactDuration(result.extraTimeSeconds),
      className: "has-warning",
      warning:
        "ممکن است این مهلت اضافه عمدا توسط دستیار آموزشی تنظیم نشده باشد."
    };
  }

  if (result.serverNow.date < result.hardFinishTime) {
    return {
      label: "در تاخیر",
      value: formatCompactDuration(
        (result.serverNow.date.getTime() - result.finishTime.date.getTime()) / 1000
      ),
      className: "",
      warning: ""
    };
  }

  return null;
}

function showDeadlineData() {
  const result = extractDeadlineData();

  if (!result) {
    console.warn("[Deadline Viewer] deadline data not found");
    removeExistingUi();
    return;
  }

  removeExistingUi();
  injectStyles();

  const detail = getDeadlineDetail(result);
  const box = document.createElement("div");
  box.id = BOX_ID;
  box.className = "item";
  box.dir = "rtl";

  box.appendChild(createDeadlineBar(result, detail));

  insertDeadlineBox(box);
  bindWarningTooltip(box);
  showSubmissionDelays();
}

function createDeadlineBar(result, detail) {
  const inline = document.createElement("div");
  inline.className = "qdv-inline";

  inline.appendChild(createStatusDot(result.status));
  inline.appendChild(createDateItem("ددلاین", result.finishTime.date));
  inline.appendChild(createDateItem("هارد ددلاین", result.hardFinishTime));

  if (detail) {
    inline.appendChild(createDetailItem(detail));
  }

  return inline;
}

function createStatusDot(status) {
  const statusElement = document.createElement("div");
  statusElement.className = `qdv-status ${status.className}`;
  statusElement.title = status.label;

  const dot = document.createElement("span");
  dot.className = "qdv-status-dot";
  statusElement.appendChild(dot);

  return statusElement;
}

function createDateItem(label, date) {
  const item = document.createElement("div");
  item.className = "qdv-deadline";

  const labelElement = document.createElement("span");
  labelElement.className = "qdv-label";
  labelElement.textContent = label;

  const dateElement = document.createElement("time");
  const hoverTime = formatHoverTime(date);
  dateElement.className = "qdv-date";
  dateElement.dateTime = date.toISOString();
  dateElement.dataset.time = hoverTime;
  dateElement.title = hoverTime;
  dateElement.textContent = formatDate(date);

  item.append(labelElement, dateElement);
  return item;
}

function createDetailItem(detail) {
  const item = document.createElement("div");
  item.className = "qdv-deadline qdv-detail";
  if (detail.className) {
    item.classList.add(detail.className);
  }

  const labelElement = document.createElement("span");
  labelElement.className = "qdv-label";
  labelElement.append(document.createTextNode(detail.label));

  if (detail.warning) {
    labelElement.append(document.createTextNode(" "));

    const warning = document.createElement("span");
    warning.className = "qdv-warning";
    warning.dataset.tooltip = detail.warning;
    warning.textContent = "!";
    labelElement.appendChild(warning);
  }

  const duration = document.createElement("span");
  duration.className = "qdv-duration";
  duration.title = detail.warning || detail.label;
  duration.textContent = detail.value;

  item.append(labelElement, duration);
  return item;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  // One stylesheet covers both the legacy assignment pages and the newer
  // Chakra course pages. It inherits Quera's font/colors where possible so the
  // extension remains low-contrast and review-friendly.
  style.textContent = `
    #${BOX_ID} {
      --qdv-primary: var(--colors-primary, #0076a6);
      --qdv-primary-soft: var(--colors-primary-hover-opaque, rgba(0, 168, 214, 0.07));
      --qdv-text: var(--chakra-colors-text-normal, #1a202c);
      --qdv-muted: var(--chakra-colors-text-pale, #718096);
      --qdv-border: var(--colors-border, var(--chakra-colors-border-gray, #e2e8f0));
      position: relative;
      z-index: 1;
      align-self: stretch;
      display: flex !important;
      align-items: center;
      justify-content: center;
      color: var(--qdv-text);
      font-family: inherit;
      font-size: 12px;
      line-height: 1.45;
      white-space: nowrap;
    }

    html[data-theme="dark"] #${BOX_ID},
    [data-theme="dark"] #${BOX_ID},
    body.chakra-ui-dark #${BOX_ID} {
      --qdv-primary: #91def3;
      --qdv-primary-soft: rgba(145, 222, 243, 0.12);
      --qdv-text: #edf2f7;
      --qdv-muted: #a0aec0;
      --qdv-border: #2d3748;
    }

    #${BOX_ID}.qdv-floating {
      position: fixed;
      top: 72px;
      right: 16px;
      z-index: 2147483647;
      align-self: auto;
      padding: 8px 10px;
      background: var(--chakra-colors-bg-pale, #ffffff);
      border: 1px solid var(--qdv-border);
      border-top: 3px solid var(--qdv-primary);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(26, 32, 44, 0.12);
    }

    html[data-theme="dark"] #${BOX_ID}.qdv-floating,
    [data-theme="dark"] #${BOX_ID}.qdv-floating,
    body.chakra-ui-dark #${BOX_ID}.qdv-floating {
      background: #1a202c;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    }

    #${BOX_ID} .qdv-inline {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
    }

    #${BOX_ID} .qdv-status {
      display: flex;
      align-items: center;
      color: var(--qdv-primary);
    }

    #${BOX_ID} .qdv-status-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: currentColor;
      flex: 0 0 auto;
    }

    #${BOX_ID} .qdv-status.is-extra {
      color: #b7791f;
    }

    #${BOX_ID} .qdv-status.is-finished {
      color: #dc4040;
    }

    html[data-theme="dark"] #${BOX_ID} .qdv-status.is-extra,
    [data-theme="dark"] #${BOX_ID} .qdv-status.is-extra,
    body.chakra-ui-dark #${BOX_ID} .qdv-status.is-extra {
      color: #fbd38d;
    }

    #${BOX_ID} .qdv-deadline {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      min-width: 92px;
    }

    #${BOX_ID} .qdv-label {
      color: var(--qdv-muted);
      font-size: 11px;
      font-weight: 500;
    }

    #${BOX_ID} .qdv-date,
    #${BOX_ID} .qdv-duration {
      position: relative;
      color: var(--qdv-text);
      text-align: center;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    #${BOX_ID} .qdv-date {
      direction: rtl;
    }

    #${BOX_ID} .qdv-duration {
      direction: rtl;
    }

    #${BOX_ID} .qdv-warning {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      width: 14px;
      height: 14px;
      margin-right: 4px;
      color: #b7791f;
      background: rgba(246, 173, 85, 0.14);
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      direction: ltr;
    }

    html[data-theme="dark"] #${BOX_ID} .qdv-warning,
    [data-theme="dark"] #${BOX_ID} .qdv-warning,
    body.chakra-ui-dark #${BOX_ID} .qdv-warning {
      color: #fbd38d;
      background: rgba(251, 211, 141, 0.14);
    }

    #${TOOLTIP_ID} {
      position: fixed;
      z-index: 2147483647;
      width: max-content;
      max-width: 260px;
      padding: 6px 8px;
      color: #ffffff;
      background: #1a202c;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(26, 32, 44, 0.18);
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.6;
      white-space: normal;
      pointer-events: none;
      direction: rtl;
      text-align: right;
    }

    #${BOX_ID} .qdv-date:hover::after,
    #${BOX_ID} .qdv-date:focus::after {
      content: attr(data-time);
      position: absolute;
      top: calc(100% + 8px);
      right: 50%;
      transform: translateX(50%);
      z-index: 2147483647;
      padding: 4px 8px;
      color: #ffffff;
      background: #1a202c;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(26, 32, 44, 0.18);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
      white-space: nowrap;
      pointer-events: none;
    }

    #${BOX_ID} .qdv-date:hover::before,
    #${BOX_ID} .qdv-date:focus::before {
      content: "";
      position: absolute;
      top: calc(100% + 3px);
      right: 50%;
      transform: translateX(50%);
      border: 5px solid transparent;
      border-bottom-color: #1a202c;
      pointer-events: none;
    }

    @media (max-width: 768px) {
      #${BOX_ID}:not(.qdv-floating) {
        width: 100%;
      }

      #${BOX_ID} .qdv-inline {
        flex-wrap: wrap;
        justify-content: center;
        gap: 10px 14px;
      }
    }

    @media (max-width: 520px) {
      #${BOX_ID}.qdv-floating {
        top: auto;
        right: 8px;
        bottom: 8px;
        width: calc(100vw - 16px);
      }
    }

    .qdv-delay-cell {
      white-space: nowrap;
      text-align: center !important;
      vertical-align: middle !important;
    }

    .qdv-delay-header {
      text-align: center !important;
    }

    .qdv-delay {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 82px;
      padding: 3px 8px;
      color: var(--colors-primary, #0076a6);
      background: var(--colors-primary-hover-opaque, rgba(0, 168, 214, 0.07));
      border-radius: 4px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      direction: rtl;
      line-height: 1.4;
      text-align: center;
    }

    html[data-theme="dark"] .qdv-delay,
    [data-theme="dark"] .qdv-delay,
    body.chakra-ui-dark .qdv-delay {
      color: #91def3;
      background: rgba(145, 222, 243, 0.12);
    }

    .qdv-course-delay {
      --qdv-primary: var(--colors-primary, #0076a6);
      --qdv-primary-soft: var(--colors-primary-hover-opaque, rgba(0, 168, 214, 0.07));
      --qdv-text: var(--chakra-colors-text-normal, #1a202c);
      --qdv-muted: var(--chakra-colors-text-pale, #718096);
      --qdv-border: var(--colors-border, var(--chakra-colors-border-gray, #e2e8f0));
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      max-width: 100%;
      margin-top: 0;
      padding: 1px 6px;
      color: var(--qdv-primary);
      background: var(--qdv-primary-soft);
      border: 1px solid transparent;
      border-radius: 4px;
      font-family: inherit;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.4;
      direction: rtl;
      white-space: nowrap;
    }

    .qdv-course-delay-value {
      direction: rtl;
      font-family: inherit;
      font-variant-numeric: tabular-nums;
    }

    .qdv-course-delay.is-loading,
    .qdv-course-delay.is-stale {
      color: var(--qdv-muted);
      background: transparent;
      border-color: var(--qdv-border);
    }

    .qdv-course-delay.is-error {
      color: #dc4040;
      background: rgba(220, 64, 64, 0.08);
      border-color: rgba(220, 64, 64, 0.16);
    }

    #${COURSE_TOTAL_ID} {
      margin-inline-start: 10px;
      vertical-align: middle;
    }

    html[data-theme="dark"] .qdv-course-delay,
    [data-theme="dark"] .qdv-course-delay,
    body.chakra-ui-dark .qdv-course-delay {
      --qdv-primary: #91def3;
      --qdv-primary-soft: rgba(145, 222, 243, 0.12);
      --qdv-text: #edf2f7;
      --qdv-muted: #a0aec0;
      --qdv-border: #2d3748;
    }

    html[data-theme="dark"] .qdv-course-delay.is-error,
    [data-theme="dark"] .qdv-course-delay.is-error,
    body.chakra-ui-dark .qdv-course-delay.is-error {
      color: #feb2b2;
      background: rgba(254, 178, 178, 0.12);
      border-color: rgba(254, 178, 178, 0.18);
    }
  `;

  document.head.appendChild(style);
}

function insertDeadlineBox(box) {
  const timer = document.getElementById("timer");
  const timerItem = timer?.closest(".item");
  const rightMenu = timerItem?.parentElement || document.querySelector("#nav-bar .right.menu");

  if (timerItem?.parentElement) {
    timerItem.insertAdjacentElement("afterend", box);
    return;
  }

  if (rightMenu) {
    rightMenu.prepend(box);
    return;
  }

  box.classList.add("qdv-floating");
  document.body.appendChild(box);
}

function removeExistingUi() {
  document.getElementById(BOX_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(TOOLTIP_ID)?.remove();
  document.querySelectorAll(".qdv-delay").forEach((element) => element.remove());
  document.querySelectorAll(".qdv-delay-inserted").forEach((element) => element.remove());
  document.querySelectorAll(".qdv-delay-cell").forEach((element) => {
    element.classList.remove("qdv-delay-cell");
  });
}

function bindWarningTooltip(container) {
  const warning = container.querySelector(".qdv-warning");

  if (!warning) {
    return;
  }

  warning.addEventListener("mouseenter", () => showWarningTooltip(warning));
  warning.addEventListener("focus", () => showWarningTooltip(warning));
  warning.addEventListener("mouseleave", removeWarningTooltip);
  warning.addEventListener("blur", removeWarningTooltip);
}

function showWarningTooltip(anchor) {
  removeWarningTooltip();

  const tooltipText = anchor.dataset.tooltip;
  if (!tooltipText) {
    return;
  }

  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.textContent = tooltipText;
  document.body.appendChild(tooltip);

  positionWarningTooltip(anchor, tooltip);
}

function positionWarningTooltip(anchor, tooltip) {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const gap = 8;
  const viewportPadding = 8;

  let top = anchorRect.bottom + gap;
  if (top + tooltipRect.height > window.innerHeight - viewportPadding) {
    top = anchorRect.top - tooltipRect.height - gap;
  }

  const idealLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
  const left = Math.max(
    viewportPadding,
    Math.min(idealLeft, window.innerWidth - tooltipRect.width - viewportPadding)
  );

  tooltip.style.top = `${Math.max(viewportPadding, top)}px`;
  tooltip.style.left = `${left}px`;
}

function removeWarningTooltip() {
  document.getElementById(TOOLTIP_ID)?.remove();
}

function showSubmissionDelays() {
  document.querySelectorAll("table").forEach((table) => {
    if (!table.querySelector("tr[data-submission_id]")) {
      return;
    }

    if (replaceExistingSubmissionDelayColumn(table)) {
      return;
    }

    addMissingSubmissionDelayColumn(table);
  });
}

function replaceExistingSubmissionDelayColumn(table) {
  const delayElements = table.querySelectorAll(
    "tr[data-submission_id] .humanize_duration.delay[data-duration]"
  );

  if (!delayElements.length) {
    return false;
  }

  table.querySelectorAll("th").forEach((header) => {
    const text = normalizeText(header.textContent || "");
    if (text.includes("ضریب نمره") || text.includes("ضریب تاخیر")) {
      header.textContent = "میزان تاخیر";
      header.classList.add("qdv-delay-header");
    }
  });

  delayElements.forEach((delayElement) => {
    const delaySeconds = Number(delayElement.dataset.duration);
    const delayCell = delayElement.closest("td");

    if (!Number.isFinite(delaySeconds) || !delayCell) {
      return;
    }

    delayCell.replaceChildren(createDelayBadge(delaySeconds));
    delayCell.classList.add("qdv-delay-cell");
  });

  return true;
}

function addMissingSubmissionDelayColumn(table) {
  if (table.querySelector(".qdv-delay-inserted")) {
    return;
  }

  const deadlineData = extractDeadlineData();
  if (!deadlineData) {
    return;
  }

  const headerRow = Array.from(table.querySelectorAll("tr")).find((row) => {
    return Array.from(row.children).some((cell) => {
      return normalizeText(cell.textContent || "") === "زمان ارسال";
    });
  });

  if (!headerRow) {
    return;
  }

  const headerCells = Array.from(headerRow.children);
  const submittedAtIndex = headerCells.findIndex((cell) => {
    return normalizeText(cell.textContent || "") === "زمان ارسال";
  });

  if (submittedAtIndex < 0) {
    return;
  }

  // Some submission tables omit Quera's delay/coefficient column entirely.
  // In that shape we insert our own delay column after "زمان ارسال" and compute
  // delay from the parsed submission timestamp and assignment finish_time.
  const header = document.createElement("th");
  header.textContent = "میزان تاخیر";
  header.className = "qdv-delay-header qdv-delay-inserted";
  headerRow.children[submittedAtIndex].insertAdjacentElement("afterend", header);

  table.querySelectorAll("tr[data-submission_id]").forEach((row) => {
    const cells = Array.from(row.children);
    const submittedAtCell = cells[submittedAtIndex];
    const delayCell = document.createElement("td");
    delayCell.className = "qdv-delay-cell qdv-delay-inserted";

    const submittedAt = parseQueraSubmissionDate(submittedAtCell?.textContent || "");
    const delaySeconds = submittedAt
      ? Math.max(0, (submittedAt.getTime() - deadlineData.finishTime.date.getTime()) / 1000)
      : 0;

    delayCell.appendChild(createDelayBadge(delaySeconds));
    submittedAtCell?.insertAdjacentElement("afterend", delayCell);
  });
}

function createDelayBadge(delaySeconds) {
  const badge = document.createElement("span");
  badge.className = "qdv-delay";
  badge.textContent = formatDelay(delaySeconds);
  badge.title = "تاخیر";
  return badge;
}

function parseQueraSubmissionDate(raw) {
  const text = normalizePersianDigits(normalizeText(raw));
  const match = text.match(
    /(\d{1,4})\s+([^\s]+)\s+(\d{3,4})\s+ساعت\s+(\d{1,2}):(\d{1,2})/
  );

  if (!match) {
    return null;
  }

  const [, dayValue, monthName, yearValue, hourValue, minuteValue] = match;
  const month = PERSIAN_MONTHS[monthName];

  if (!month) {
    return null;
  }

  const gregorian = jalaliToGregorian(Number(yearValue), month, Number(dayValue));
  return new Date(
    Date.UTC(
      gregorian.year,
      gregorian.month - 1,
      gregorian.day,
      Number(hourValue) - 3,
      Number(minuteValue) - 30,
      0
    )
  );
}

function normalizePersianDigits(value) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
    if (persianIndex >= 0) {
      return String(persianIndex);
    }

    return String("٠١٢٣٤٥٦٧٨٩".indexOf(digit));
  });
}

// Quera renders submission timestamps in Jalali/Persian text. There is no
// browser-native parser for this, so keep the conversion local and explicit
// instead of depending on a package inside a single-file extension.
const PERSIAN_MONTHS = {
  فروردین: 1,
  اردیبهشت: 2,
  خرداد: 3,
  تیر: 4,
  مرداد: 5,
  شهریور: 6,
  مهر: 7,
  آبان: 8,
  آذر: 9,
  دی: 10,
  بهمن: 11,
  اسفند: 12
};

function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days =
    -355668 +
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }

  gy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  const gd = days + 1;
  const salA = [
    0,
    31,
    isGregorianLeapYear(gy) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  let gm = 0;
  let day = gd;
  while (gm < 13 && day > salA[gm]) {
    day -= salA[gm];
    gm++;
  }

  return { year: gy, month: gm, day };
}

function isGregorianLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function formatDelay(totalSeconds) {
  return formatCompactDuration(totalSeconds);
}

function formatCompactDuration(totalSeconds) {
  const roundedHours = Math.ceil(Math.max(0, totalSeconds) / 3600);
  const days = Math.floor(roundedHours / 24);
  const hours = roundedHours % 24;

  if (days && hours) {
    return `${formatPersianNumber(days)} روز و ${formatPersianNumber(hours)} ساعت`;
  }

  if (days) {
    return `${formatPersianNumber(days)} روز`;
  }

  return `${formatPersianNumber(hours)} ساعت`;
}

function formatPersianNumber(value) {
  return new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: 0,
    useGrouping: false
  }).format(value);
}

function formatRoundedHours(totalHours) {
  const safeHours = Math.max(0, Math.ceil(totalHours));
  return formatCompactDuration(safeHours * 3600);
}

function getRoundedDelayHours(totalSeconds) {
  return Math.ceil(Math.max(0, totalSeconds) / 3600);
}

function isAssignmentPage() {
  return /^\/course\/assignments\/\d+\//.test(window.location.pathname);
}

function isCoursePage() {
  return /^\/course\/\d+\/?$/.test(window.location.pathname);
}

function getExtensionStorage() {
  const api = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;

  if (!api) {
    return null;
  }

  return api;
}

function storageGet(key) {
  const storage = getExtensionStorage();

  if (!storage) {
    return Promise.resolve({});
  }

  if (globalThis.browser?.storage?.local) {
    return storage.get(key);
  }

  return new Promise((resolve) => {
    storage.get(key, resolve);
  });
}

function storageSet(values) {
  const storage = getExtensionStorage();

  if (!storage) {
    return Promise.resolve();
  }

  if (globalThis.browser?.storage?.local) {
    return storage.set(values);
  }

  return new Promise((resolve) => {
    storage.set(values, resolve);
  });
}

function getCourseId() {
  return window.location.pathname.match(/^\/course\/(\d+)\/?$/)?.[1] || null;
}

function getCourseName() {
  const heading = document.querySelector("h1");
  const headingText = normalizeText(heading?.textContent || "");

  if (headingText) {
    return headingText;
  }

  return normalizeText(document.title.split("|")[0] || document.title);
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function getCourseAssignments() {
  const assignmentsById = new Map();

  document
    .querySelectorAll('a[href*="/course/assignments/"][href*="/problems"]')
    .forEach((link) => {
      const url = new URL(link.href, window.location.href);
      const id = url.pathname.match(/\/course\/assignments\/(\d+)\/problems\/?/)?.[1];

      if (!id || assignmentsById.has(id)) {
        return;
      }

      const card = link.closest(".chakra-linkbox");
      if (!card) {
        return;
      }

      assignmentsById.set(id, {
        id,
        name: normalizeText(link.textContent || link.getAttribute("title") || id),
        finalUrl: `/course/assignments/${id}/submissions/final`,
        card
      });
    });

  return Array.from(assignmentsById.values());
}

async function showCourseDelays() {
  const courseId = getCourseId();
  if (!courseId) {
    return;
  }

  const courseName = getCourseName();
  const assignments = getCourseAssignments();

  if (!assignments.length) {
    injectStyles();
    return;
  }

  removeExistingCourseUi();
  injectStyles();

  const state = createCourseDelayState(courseId, courseName, assignments);

  insertCourseTotalBadge(state);

  for (const assignment of assignments) {
    insertAssignmentDelayBadge(assignment, COURSE_DELAY_STATUS.loading, "...");
  }

  await hydrateCourseDelayState(state);
}

function createCourseDelayState(courseId, courseName, assignments) {
  activeCourseRenderId += 1;

  return {
    courseId,
    courseName,
    renderId: activeCourseRenderId,
    assignments,
    delayHoursByAssignment: new Map(),
    failedAssignments: new Set(),
    pendingAssignments: new Set(assignments.map((assignment) => assignment.id))
  };
}

async function hydrateCourseDelayState(state) {
  const now = Date.now();

  for (const assignment of state.assignments) {
    const cache = await readAssignmentDelayCache(state.courseId, assignment.id);

    if (cache) {
      applyAssignmentDelayResult(state, assignment, {
        delaySeconds: Number(cache.delaySeconds) || 0,
        fetchedAt: Number(cache.fetchedAt) || 0,
        status: now - Number(cache.fetchedAt) >= COURSE_CACHE_TTL_MS
          ? COURSE_DELAY_STATUS.stale
          : COURSE_DELAY_STATUS.fresh
      });
    }

    if (!cache || now - Number(cache.fetchedAt) >= COURSE_CACHE_TTL_MS) {
      enqueueAssignmentDelayFetch(state, assignment, {
        showLoading: !cache
      });
    }
  }

  updateCourseTotalBadge(state);
}

async function readAssignmentDelayCache(courseId, assignmentId) {
  const key = getAssignmentDelayCacheKey(courseId, assignmentId);
  const values = await storageGet(key);
  return values?.[key] || null;
}

async function writeAssignmentDelayCache(courseId, assignment, delaySeconds, status) {
  const key = getAssignmentDelayCacheKey(courseId, assignment.id);
  await storageSet({
    [key]: {
      courseId,
      assignmentId: assignment.id,
      assignmentName: assignment.name,
      delaySeconds,
      displayHours: getRoundedDelayHours(delaySeconds),
      fetchedAt: Date.now(),
      status
    }
  });
}

function getAssignmentDelayCacheKey(courseId, assignmentId) {
  return `${COURSE_CACHE_PREFIX}:${courseId}:${assignmentId}`;
}

function enqueueAssignmentDelayFetch(state, assignment, options = {}) {
  const cacheKey = getAssignmentDelayCacheKey(state.courseId, assignment.id);
  const showLoading = options.showLoading !== false;

  state.pendingAssignments.add(assignment.id);
  if (showLoading) {
    insertAssignmentDelayBadge(assignment, COURSE_DELAY_STATUS.loading, "...");
  }
  updateCourseTotalBadge(state);

  if (courseInFlight.has(cacheKey)) {
    courseInFlight.get(cacheKey).then((result) => {
      applyAssignmentDelayResult(state, assignment, result);
    });
    return;
  }

  const queuedWork = courseQueuedWork.get(cacheKey);
  if (queuedWork) {
    queuedWork.subscribers.push({ state, assignment });
    return;
  }

  const work = {
    assignment,
    cacheKey,
    courseId: state.courseId,
    subscribers: [{ state, assignment }]
  };

  courseQueuedWork.set(cacheKey, work);
  courseFetchQueue.push(work);
  runCourseFetchQueue();
}

async function runCourseFetchQueue() {
  if (courseQueueRunning) {
    return;
  }

  courseQueueRunning = true;

  while (courseFetchQueue.length) {
    const batch = courseFetchQueue.splice(0, COURSE_QUEUE_BATCH_SIZE);
    batch.forEach((item) => {
      courseQueuedWork.delete(item.cacheKey);
    });

    await Promise.all(batch.map((item) => fetchQueuedAssignmentDelay(item)));

    if (courseFetchQueue.length) {
      await waitForCourseQueueDelay();
    }
  }

  courseQueueRunning = false;
}

async function fetchQueuedAssignmentDelay(work) {
  const { assignment, cacheKey, courseId, subscribers } = work;

  if (!courseInFlight.has(cacheKey)) {
    courseInFlight.set(
      cacheKey,
      fetchAssignmentDelay(assignment)
        .then(async (result) => {
          await writeAssignmentDelayCache(
            courseId,
            assignment,
            result.delaySeconds,
            COURSE_DELAY_STATUS.fresh
          );
          return result;
        })
        .catch((error) => {
          console.warn("[Deadline Viewer] course delay fetch failed", assignment.id, error);
          return {
            delaySeconds: 0,
            fetchedAt: Date.now(),
            status: COURSE_DELAY_STATUS.error
          };
        })
        .finally(() => {
          courseInFlight.delete(cacheKey);
        })
    );
  }

  const result = await courseInFlight.get(cacheKey);
  subscribers.forEach((subscriber) => {
    applyAssignmentDelayResult(subscriber.state, subscriber.assignment, result);
  });
}

async function fetchAssignmentDelay(assignment) {
  // Student course pages do not include final-delay data, but the student
  // final-submissions page does. Fetch only page 1; Quera orders the relevant
  // max delay there for the student view we support.
  const response = await fetch(assignment.finalUrl, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const delays = Array.from(
    doc.querySelectorAll(".humanize_duration.delay[data-duration]")
  )
    .map((element) => Number(element.getAttribute("data-duration")))
    .filter(Number.isFinite);

  return {
    delaySeconds: delays.length ? Math.max(...delays) : 0,
    fetchedAt: Date.now(),
    status: COURSE_DELAY_STATUS.fresh
  };
}

function applyAssignmentDelayResult(state, assignment, result) {
  if (state.renderId !== activeCourseRenderId) {
    return;
  }

  const delaySeconds = Number(result.delaySeconds) || 0;
  const delayHours = getRoundedDelayHours(delaySeconds);
  const status = result.status || COURSE_DELAY_STATUS.fresh;
  const hadKnownValue = state.delayHoursByAssignment.has(assignment.id);

  state.pendingAssignments.delete(assignment.id);

  if (status === COURSE_DELAY_STATUS.error) {
    state.failedAssignments.add(assignment.id);

    if (hadKnownValue) {
      insertAssignmentDelayBadge(
        assignment,
        status,
        formatRoundedHours(state.delayHoursByAssignment.get(assignment.id))
      );
    } else {
      insertAssignmentDelayBadge(assignment, status, "—");
    }

    updateCourseTotalBadge(state);
    return;
  } else {
    state.failedAssignments.delete(assignment.id);
  }

  state.delayHoursByAssignment.set(assignment.id, delayHours);
  insertAssignmentDelayBadge(assignment, status, formatRoundedHours(delayHours));
  updateCourseTotalBadge(state);
}

function waitForCourseQueueDelay() {
  const jitter = Math.floor(Math.random() * COURSE_QUEUE_JITTER_MS);
  return new Promise((resolve) => {
    setTimeout(resolve, COURSE_QUEUE_DELAY_MS + jitter);
  });
}

function insertAssignmentDelayBadge(assignment, status, value) {
  const badge = getOrCreateAssignmentDelayBadge(assignment);
  badge.className = `qdv-course-delay is-${status}`;
  badge.title = getAssignmentDelayTitle(status);
  badge.replaceChildren(
    document.createTextNode("تاخیر"),
    createCourseDelayValue(value)
  );
}

function getOrCreateAssignmentDelayBadge(assignment) {
  let badge = assignment.card.querySelector(
    `.qdv-course-delay[data-assignment-id="${escapeCssIdent(assignment.id)}"]`
  );

  if (badge) {
    return badge;
  }

  badge = document.createElement("span");
  badge.className = "qdv-course-delay";
  badge.dataset.assignmentId = assignment.id;

  const metadataContainer = findAssignmentMetadataContainer(assignment.card);
  metadataContainer.appendChild(badge);

  return badge;
}

function findAssignmentMetadataContainer(card) {
  // Put the course delay badge into Quera's existing metadata row so cards do
  // not gain an extra visual line.
  const directStack = Array.from(card.children).find((element) => {
    return (
      element.classList?.contains("chakra-stack") &&
      normalizeText(element.textContent || "").includes("مهلت")
    );
  });

  if (directStack) {
    return directStack;
  }

  return (
    Array.from(card.querySelectorAll(".chakra-stack")).find((element) => {
      return normalizeText(element.textContent || "").includes("مهلت");
    }) || card
  );
}

function escapeCssIdent(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function createCourseDelayValue(value) {
  const valueElement = document.createElement("span");
  valueElement.className = "qdv-course-delay-value";
  valueElement.textContent = value;
  return valueElement;
}

function getAssignmentDelayTitle(status) {
  if (status === COURSE_DELAY_STATUS.loading) {
    return "در صف دریافت تاخیر";
  }

  if (status === COURSE_DELAY_STATUS.stale) {
    return "تاخیر ذخیره‌شده؛ در صف به‌روزرسانی";
  }

  if (status === COURSE_DELAY_STATUS.error) {
    return "دریافت تاخیر ناموفق بود";
  }

  return "تاخیر ارسال نهایی";
}

function insertCourseTotalBadge(state) {
  const heading = findCourseAssignmentsHeading();
  const total = document.createElement("span");
  total.id = COURSE_TOTAL_ID;
  total.className = "qdv-course-delay is-loading";
  total.dir = "rtl";
  total.replaceChildren(
    document.createTextNode("مجموع تاخیر"),
    createCourseDelayValue("...")
  );

  if (heading) {
    heading.appendChild(total);
    return;
  }

  state.assignments[0]?.card?.parentElement?.prepend(total);
}

function updateCourseTotalBadge(state) {
  if (state.renderId !== activeCourseRenderId) {
    return;
  }

  const total = document.getElementById(COURSE_TOTAL_ID);
  if (!total) {
    return;
  }

  const totalHours = Array.from(state.delayHoursByAssignment.values()).reduce(
    (sum, hours) => sum + hours,
    0
  );
  const hasAllValues = state.delayHoursByAssignment.size === state.assignments.length;
  const complete = state.pendingAssignments.size === 0;
  const hasFailures = state.failedAssignments.size > 0;

  total.className = `qdv-course-delay is-${
    hasAllValues && complete
      ? hasFailures
        ? COURSE_DELAY_STATUS.error
        : COURSE_DELAY_STATUS.fresh
      : hasAllValues
        ? COURSE_DELAY_STATUS.stale
        : COURSE_DELAY_STATUS.loading
  }`;
  total.title = !hasAllValues
    ? "در انتظار دریافت تاخیر همه تمرین‌ها"
    : !complete
      ? "مجموع ذخیره‌شده؛ بعضی تمرین‌ها در صف به‌روزرسانی هستند"
    : hasFailures
      ? "مجموع ناقص است؛ دریافت تاخیر بعضی تمرین‌ها ناموفق بود"
      : "مجموع تاخیر ارسال‌های نهایی";
  total.replaceChildren(
    document.createTextNode("مجموع تاخیر"),
    createCourseDelayValue(hasAllValues ? formatRoundedHours(totalHours) : "...")
  );
}

function findCourseAssignmentsHeading() {
  return Array.from(document.querySelectorAll("h1, h2, h3, h4")).find(
    (heading) => normalizeText(heading.textContent || "").includes("تمرین")
  );
}

function removeExistingCourseUi() {
  document.getElementById(COURSE_TOTAL_ID)?.remove();
  document.querySelectorAll(".qdv-course-delay").forEach((element) => element.remove());
}

function stopCourseObserver() {
  if (courseObserver) {
    courseObserver.disconnect();
    courseObserver = null;
  }

  if (courseRenderTimer) {
    clearTimeout(courseRenderTimer);
    courseRenderTimer = null;
  }

  lastCourseAssignmentSignature = "";
}

function scheduleCourseDelays(delayMs = 250) {
  if (courseRenderTimer) {
    clearTimeout(courseRenderTimer);
  }

  courseRenderTimer = setTimeout(() => {
    courseRenderTimer = null;
    showCourseDelays().catch((error) => {
      console.warn("[Deadline Viewer] course delay render failed", error);
    });
  }, delayMs);
}

function observeCoursePage() {
  if (courseObserver || !document.body) {
    return;
  }

  lastCourseAssignmentSignature = getCourseAssignmentSignature();

  // Quera renders course content asynchronously after route changes. Watch for
  // the assignment list to appear or change, then render once the cards exist.
  courseObserver = new MutationObserver(() => {
    const signature = getCourseAssignmentSignature();
    const hasAssignments = Boolean(signature);
    const hasBadges = Boolean(document.querySelector(".qdv-course-delay"));

    if (signature !== lastCourseAssignmentSignature || (hasAssignments && !hasBadges)) {
      lastCourseAssignmentSignature = signature;
      scheduleCourseDelays();
    }
  });

  courseObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function getCourseAssignmentSignature() {
  return getCourseAssignments()
    .map((assignment) => assignment.id)
    .join(",");
}

function boot(force = false) {
  const route = `${window.location.pathname}${window.location.search}`;

  if (!force && lastBootRoute === route) {
    return;
  }

  lastBootRoute = route;

  if (isCoursePage()) {
    removeExistingUi();
    removeExistingCourseUi();
    activeCourseRenderId += 1;
    observeCoursePage();
    scheduleCourseDelays();
    return;
  }

  stopCourseObserver();
  removeExistingCourseUi();
  activeCourseRenderId += 1;

  if (isAssignmentPage()) {
    showDeadlineData();
    return;
  }

  removeExistingUi();
}

function installRouteChangeWatcher() {
  const notifyRouteChange = () => {
    window.setTimeout(() => boot(), 0);
  };

  // The manifest injects on all Quera pages so SPA navigation can be detected.
  // History wrapping catches same-world navigation; polling covers isolated-world
  // extension behavior where Quera's router may not call our wrapped methods.
  ["pushState", "replaceState"].forEach((methodName) => {
    const original = history[methodName];

    if (typeof original !== "function" || original.__qdvWrapped) {
      return;
    }

    const wrapped = function (...args) {
      const result = original.apply(this, args);
      notifyRouteChange();
      return result;
    };

    wrapped.__qdvWrapped = true;
    history[methodName] = wrapped;
  });

  window.addEventListener("popstate", notifyRouteChange);

  if (!routePollTimer) {
    routePollTimer = window.setInterval(() => boot(), 1000);
  }
}

installRouteChangeWatcher();
boot(true);
