const BOX_ID = "deadline-viewer-box";
const STYLE_ID = "deadline-viewer-style";
const TOOLTIP_ID = "deadline-viewer-tooltip";
const TEHRAN_TIME_ZONE = "Asia/Tehran";
const COURSE_TOTAL_ID = "deadline-viewer-course-total";
const COURSE_CACHE_PREFIX = "qdv-course-delay";
const COURSE_FOLLOW_STATE_KEY = "qdv-course-follow-state:v1";
const COURSE_FOLLOW_STATE_MIRROR_KEY = "qdv-course-follow-state-mirror:v1";
const COURSE_FOLLOW_BUTTON_CLASS = "qdv-course-follow-button";
const COURSE_FOLLOW_MENUITEM_CLASS = "qdv-course-follow-menuitem";
const COURSE_FOLLOW_INDICATOR_CLASS = "qdv-course-follow-indicator";
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
let courseFollowStateCache = null;
let courseFollowStateReady = null;
let courseFollowObserver = null;
let courseFollowRenderTimer = null;

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
  if (!document.head) {
    return;
  }

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

    .${COURSE_FOLLOW_BUTTON_CLASS} {
      --qdv-primary: var(--colors-primary, #0076a6);
      --qdv-primary-soft: var(--colors-primary-hover-opaque, rgba(0, 168, 214, 0.07));
      --qdv-text: var(--chakra-colors-text-normal, #1a202c);
      --qdv-border: var(--colors-border, var(--chakra-colors-border-gray, #e2e8f0));
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-height: 32px;
      margin-top: 10px;
      padding: 6px 12px;
      color: var(--qdv-primary);
      background: var(--qdv-primary-soft);
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.5;
      white-space: nowrap;
    }

    .${COURSE_FOLLOW_BUTTON_CLASS}:hover,
    .${COURSE_FOLLOW_BUTTON_CLASS}:focus {
      border-color: var(--qdv-primary);
      outline: none;
    }

    .${COURSE_FOLLOW_BUTTON_CLASS}.is-unfollowed {
      color: var(--chakra-colors-text-pale, #718096);
      background: transparent;
      border-color: var(--qdv-border);
    }

    .${COURSE_FOLLOW_MENUITEM_CLASS} {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 32px;
      padding: 6px 12px;
      color: inherit;
      background: transparent;
      border: 0;
      cursor: pointer;
      font: inherit;
      text-align: right;
      direction: rtl;
    }

    .${COURSE_FOLLOW_MENUITEM_CLASS} .qdv-course-follow-menuicon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      color: var(--colors-primary, #0076a6);
    }

    .${COURSE_FOLLOW_MENUITEM_CLASS}.is-unfollow-action .qdv-course-follow-menuicon {
      color: #c2410c;
    }

    .${COURSE_FOLLOW_MENUITEM_CLASS} .qdv-course-follow-menuicon svg {
      display: block;
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    .${COURSE_FOLLOW_MENUITEM_CLASS}:hover,
    .${COURSE_FOLLOW_MENUITEM_CLASS}:focus {
      background: var(--chakra-colors-blackAlpha-100, rgba(0, 0, 0, 0.06));
      outline: none;
    }

    .${COURSE_FOLLOW_INDICATOR_CLASS} {
      --qdv-primary: var(--colors-primary, #0076a6);
      --qdv-tooltip-bg: #111827;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      width: 22px;
      height: 22px;
      margin-inline-end: 3px;
      color: var(--qdv-primary);
      cursor: help;
      isolation: isolate;
      vertical-align: middle;
      z-index: 20;
    }

    .${COURSE_FOLLOW_INDICATOR_CLASS} svg {
      display: block;
      width: 15px;
      height: 15px;
      stroke: currentColor;
    }

    .${COURSE_FOLLOW_INDICATOR_CLASS}::before,
    .${COURSE_FOLLOW_INDICATOR_CLASS}::after {
      position: absolute;
      opacity: 0;
      pointer-events: none;
      transform: translateY(2px);
      transition: opacity 120ms ease, transform 120ms ease;
      z-index: 10000;
    }

    .${COURSE_FOLLOW_INDICATOR_CLASS}::before {
      content: "";
      inset-inline-end: 6px;
      inset-block-end: calc(100% + 3px);
      border: 5px solid transparent;
      border-block-start-color: var(--qdv-tooltip-bg);
    }

    .${COURSE_FOLLOW_INDICATOR_CLASS}::after {
      content: attr(aria-label);
      inset-inline-end: 0;
      inset-block-end: calc(100% + 11px);
      width: 310px;
      padding: 7px 9px;
      color: #ffffff;
      background-color: var(--qdv-tooltip-bg);
      border-radius: 4px;
      box-sizing: border-box;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.35);
      direction: rtl;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
      text-align: right;
      white-space: nowrap;
    }

    .${COURSE_FOLLOW_INDICATOR_CLASS}:hover::before,
    .${COURSE_FOLLOW_INDICATOR_CLASS}:hover::after {
      opacity: 1;
      transform: translateY(0);
    }

    html[data-theme="dark"] .${COURSE_FOLLOW_BUTTON_CLASS},
    [data-theme="dark"] .${COURSE_FOLLOW_BUTTON_CLASS},
    body.chakra-ui-dark .${COURSE_FOLLOW_BUTTON_CLASS} {
      --qdv-primary: #91def3;
      --qdv-primary-soft: rgba(145, 222, 243, 0.12);
      --qdv-text: #edf2f7;
      --qdv-border: #2d3748;
    }

    html[data-theme="dark"] .${COURSE_FOLLOW_INDICATOR_CLASS},
    [data-theme="dark"] .${COURSE_FOLLOW_INDICATOR_CLASS},
    body.chakra-ui-dark .${COURSE_FOLLOW_INDICATOR_CLASS} {
      --qdv-primary: #91def3;
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

function isCourseListPage() {
  return /^\/course\/?$/.test(window.location.pathname);
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

function installCourseFollowStateStorageListener() {
  const onChanged =
    globalThis.browser?.storage?.onChanged ||
    globalThis.chrome?.storage?.onChanged;

  if (!onChanged?.addListener) {
    return;
  }

  onChanged.addListener((changes, areaName) => {
    if (areaName && areaName !== "local") {
      return;
    }

    const change = changes?.[COURSE_FOLLOW_STATE_KEY];
    if (!change) {
      return;
    }

    const nextState = normalizeCourseFollowState(change.newValue);
    courseFollowStateCache = nextState;
    courseFollowStateReady = Promise.resolve(courseFollowStateCache);
    writeCourseFollowStateMirror(nextState);

    if (isCourseListPage() || isCoursePage()) {
      scheduleCourseFollowControls();
    }
  });
}

function isExtensionContextInvalidatedError(error) {
  return String(error?.message || error).includes("Extension context invalidated");
}

function runSafely(callback, warning) {
  try {
    return callback();
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      return undefined;
    }

    if (warning) {
      console.warn(warning, error);
    }

    throw error;
  }
}

function createEmptyCourseFollowState() {
  return {
    version: 1,
    courses: {},
    assignments: {},
    overrides: {}
  };
}

function normalizeCourseFollowState(value) {
  const state = createEmptyCourseFollowState();

  if (!value || typeof value !== "object") {
    return state;
  }

  state.courses = value.courses && typeof value.courses === "object"
    ? { ...value.courses }
    : {};
  state.assignments = value.assignments && typeof value.assignments === "object"
    ? { ...value.assignments }
    : {};
  state.overrides = value.overrides && typeof value.overrides === "object"
    ? { ...value.overrides }
    : {};

  return state;
}

async function readCourseFollowState() {
  if (courseFollowStateCache) {
    return cloneCourseFollowState(courseFollowStateCache);
  }

  return readCourseFollowStateFromStorage();
}

async function readCourseFollowStateFromStorage() {
  if (!courseFollowStateReady) {
    courseFollowStateReady = storageGet(COURSE_FOLLOW_STATE_KEY)
      .then((values) => {
        courseFollowStateCache = normalizeCourseFollowState(
          values?.[COURSE_FOLLOW_STATE_KEY]
        );
        writeCourseFollowStateMirror(courseFollowStateCache);
        return courseFollowStateCache;
      })
      .catch((error) => {
        if (isExtensionContextInvalidatedError(error)) {
          return createEmptyCourseFollowState();
        }

        console.warn("[Deadline Viewer] course follow state read failed", error);
        courseFollowStateCache = createEmptyCourseFollowState();
        return courseFollowStateCache;
      });
  }

  await courseFollowStateReady;
  return cloneCourseFollowState(courseFollowStateCache);
}

function primeCourseFollowStateMirror() {
  readCourseFollowState().catch((error) => {
    if (isExtensionContextInvalidatedError(error)) {
      return;
    }

    console.warn("[Deadline Viewer] course follow state mirror prime failed", error);
  });
}

function cloneCourseFollowState(state) {
  return {
    version: 1,
    courses: { ...(state?.courses || {}) },
    assignments: { ...(state?.assignments || {}) },
    overrides: { ...(state?.overrides || {}) }
  };
}

function writeCourseFollowStateMirror(state) {
  try {
    window.localStorage.setItem(
      COURSE_FOLLOW_STATE_MIRROR_KEY,
      JSON.stringify(normalizeCourseFollowState(state))
    );
  } catch {
    // The extension storage copy remains authoritative if page storage is unavailable.
  }
}

async function writeCourseFollowState(state) {
  const normalized = normalizeCourseFollowState(state);
  courseFollowStateCache = normalized;
  courseFollowStateReady = Promise.resolve(courseFollowStateCache);
  writeCourseFollowStateMirror(normalized);
  await storageSet({ [COURSE_FOLLOW_STATE_KEY]: normalized });
}

async function updateCourseFollowState(mutator) {
  courseFollowStateReady = null;
  const state = await readCourseFollowStateFromStorage();
  const mutatedState = mutator(state);
  if (mutatedState === false) {
    return state;
  }

  const nextState = mutatedState || state;
  await writeCourseFollowState(nextState);
  return nextState;
}

function isCourseFollowedInState(state, courseId) {
  const id = String(courseId || "");

  if (!id) {
    return true;
  }

  if (typeof state.overrides[id] === "boolean") {
    return state.overrides[id];
  }

  const course = state.courses[id];
  if (course && typeof course.isArchived === "boolean") {
    return !course.isArchived;
  }

  return true;
}

function getCourseFollowLabel(followed) {
  return followed ? "دنبال نکردن درس" : "دنبال کردن درس";
}

async function setCourseFollowOverride(course, followed) {
  const courseInfo = normalizeCourseMetadata(course);
  const courseId = courseInfo?.id;

  if (!courseId) {
    return null;
  }

  return updateCourseFollowState((state) => {
    mergeCourseMetadataIntoState(state, [courseInfo]);
    state.overrides[courseId] = Boolean(followed);
    return state;
  });
}

function normalizeCourseMetadata(course) {
  if (!course || typeof course !== "object") {
    return null;
  }

  const id = String(course.id || course.pk || course.courseId || "");
  if (!id) {
    return null;
  }

  const name = normalizeText(course.name || course.courseName || "");
  const archivedValue = course.is_archived ?? course.isArchived;
  const archivedBy = course.archived_by ?? course.archivedBy ?? null;
  const metadata = {
    id,
    name,
    archivedBy,
    lastSeenAt: Date.now()
  };

  if (typeof archivedValue === "boolean") {
    metadata.isArchived = archivedValue;
  }

  return metadata;
}

function mergeCourseMetadataIntoState(state, courses) {
  let changed = false;

  courses.forEach((course) => {
    const normalized = normalizeCourseMetadata(course);
    if (!normalized) {
      return;
    }

    const previous = state.courses[normalized.id] || {};
    const nextCourse = {
      ...previous,
      ...normalized,
      name: normalized.name || previous.name || normalized.id,
      lastSeenAt: previous.lastSeenAt || normalized.lastSeenAt
    };

    const hasMeaningfulChange =
      !previous.id ||
      previous.name !== nextCourse.name ||
      previous.isArchived !== nextCourse.isArchived ||
      previous.archivedBy !== nextCourse.archivedBy;

    if (hasMeaningfulChange) {
      nextCourse.lastSeenAt = normalized.lastSeenAt;
      state.courses[normalized.id] = nextCourse;
      changed = true;
    }
  });

  return changed;
}

function mergeAssignmentMappingsIntoState(state, course, assignments) {
  const normalizedCourse = normalizeCourseMetadata(course);
  if (!normalizedCourse || !Array.isArray(assignments)) {
    return false;
  }

  let changed = mergeCourseMetadataIntoState(state, [normalizedCourse]);

  assignments.forEach((assignment) => {
    const assignmentId = String(assignment?.pk || assignment?.id || "");
    if (!assignmentId) {
      return;
    }

    const previous = state.assignments[assignmentId] || {};
    const nextAssignment = {
      ...previous,
      assignmentId,
      courseId: normalizedCourse.id,
      courseName: normalizedCourse.name,
      assignmentName: normalizeText(assignment.name || ""),
      lastSeenAt: previous.lastSeenAt || Date.now()
    };

    const hasMeaningfulChange =
      !previous.assignmentId ||
      previous.courseId !== nextAssignment.courseId ||
      previous.courseName !== nextAssignment.courseName ||
      previous.assignmentName !== nextAssignment.assignmentName;

    if (hasMeaningfulChange) {
      nextAssignment.lastSeenAt = Date.now();
      state.assignments[assignmentId] = nextAssignment;
      changed = true;
    }
  });

  return changed;
}

async function persistFollowStateFromNextData(nextData) {
  const course = nextData?.props?.pageProps?.course;
  if (!course) {
    return;
  }

  await updateCourseFollowState((state) => {
    return mergeFollowStateFromPageCourse(state, course) ? state : false;
  });
}

function mergeFollowStateFromPageCourse(state, course) {
  let changed = false;

  const courseNodes = course.courses?.edges
    ?.map((edge) => edge?.node)
    .filter(Boolean) || [];
  changed = mergeCourseMetadataIntoState(state, courseNodes) || changed;

  if (course.id && course.name) {
    changed = mergeAssignmentMappingsIntoState(state, course, course.assignments) || changed;
  }

  return changed;
}

function getCourseId() {
  return window.location.pathname.match(/^\/course\/(\d+)\/?$/)?.[1] || null;
}

function getCourseName() {
  const heading = document.querySelector("h1, h2");
  const headingText = normalizeText(heading?.textContent || "");

  if (headingText) {
    return headingText;
  }

  return normalizeText(document.title.split("|")[0] || document.title);
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function getNextDataCourse() {
  const script = document.getElementById("__NEXT_DATA__");
  if (!script?.textContent) {
    return null;
  }

  try {
    return JSON.parse(script.textContent)?.props?.pageProps?.course || null;
  } catch (error) {
    console.warn("[Deadline Viewer] Next data parse failed", error);
    return null;
  }
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

  const nextCourse = getNextDataCourse();
  if (nextCourse) {
    persistFollowStateFromNextData({ props: { pageProps: { course: nextCourse } } })
      .catch((error) => {
        if (isExtensionContextInvalidatedError(error)) {
          return;
        }

        console.warn("[Deadline Viewer] course follow state update failed", error);
      });
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
      runSafely(() => {
        applyAssignmentDelayResult(state, assignment, result);
      });
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
    runSafely(() => {
      applyAssignmentDelayResult(subscriber.state, subscriber.assignment, result);
    });
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

function removeExistingCourseFollowUi() {
  runSafely(() => {
    document.querySelectorAll(`.${COURSE_FOLLOW_BUTTON_CLASS}`).forEach((element) => {
      element.remove();
    });
    document.querySelectorAll(`.${COURSE_FOLLOW_MENUITEM_CLASS}`).forEach((element) => {
      element.remove();
    });
    document.querySelectorAll(`.${COURSE_FOLLOW_INDICATOR_CLASS}`).forEach((element) => {
      element.remove();
    });
  });
}

function scheduleCourseFollowControls(delayMs = 100) {
  if (courseFollowRenderTimer) {
    clearTimeout(courseFollowRenderTimer);
  }

  courseFollowRenderTimer = setTimeout(() => {
    runSafely(() => {
      courseFollowRenderTimer = null;
      renderCourseFollowControls().catch((error) => {
        if (isExtensionContextInvalidatedError(error)) {
          return;
        }

        console.warn("[Deadline Viewer] course follow controls failed", error);
      });
    });
  }, delayMs);
}

function observeCourseFollowControls() {
  if (courseFollowObserver || !document.body) {
    return;
  }

  courseFollowObserver = new MutationObserver(() => {
    runSafely(() => {
      scheduleCourseFollowControls();
    });
  });

  courseFollowObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopCourseFollowObserver() {
  if (courseFollowObserver) {
    courseFollowObserver.disconnect();
    courseFollowObserver = null;
  }

  if (courseFollowRenderTimer) {
    clearTimeout(courseFollowRenderTimer);
    courseFollowRenderTimer = null;
  }
}

async function renderCourseFollowControls() {
  if (!document.body) {
    return;
  }

  injectStyles();

  const nextCourse = getNextDataCourse();
  if (nextCourse) {
    await persistFollowStateFromNextData({ props: { pageProps: { course: nextCourse } } });
  }

  if (isCoursePage()) {
    await renderCoursePageFollowButton();
    return;
  }

  if (isCourseListPage()) {
    await renderCourseListFollowIndicators();
    await renderCourseListFollowMenuItem();
  }
}

async function renderCoursePageFollowButton() {
  const course = getCurrentCourseMetadata();
  if (!course?.id) {
    return;
  }

  const state = await readCourseFollowState();
  const followed = isCourseFollowedInState(state, course.id);
  let button = document.querySelector(`.${COURSE_FOLLOW_BUTTON_CLASS}`);

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = COURSE_FOLLOW_BUTTON_CLASS;
    button.dir = "rtl";
    button.addEventListener("click", async () => {
      const latestState = await readCourseFollowState();
      const latestFollowed = isCourseFollowedInState(latestState, course.id);
      await setCourseFollowOverride(course, !latestFollowed);
      await renderCoursePageFollowButton();
    });

    const container = findCourseFollowButtonContainer(course.name);
    container?.appendChild(button);
  }

  updateCourseFollowButton(button, followed);
}

function updateCourseFollowButton(button, followed) {
  button.textContent = getCourseFollowLabel(followed);
  button.title = followed
    ? "حذف ددلاین‌های این درس از ویجت مهلت‌ها"
    : "نمایش ددلاین‌های این درس در ویجت مهلت‌ها";
  button.classList.toggle("is-unfollowed", !followed);
}

function findCourseFollowButtonContainer(courseName) {
  const headings = Array.from(document.querySelectorAll("h1, h2"));
  const heading = headings.find((element) => {
    return normalizeText(element.textContent || "") === normalizeText(courseName || "");
  });

  return (
    heading?.closest(".chakra-stack")?.parentElement ||
    heading?.parentElement ||
    document.querySelector("main")
  );
}

async function renderCourseListFollowIndicators() {
  const links = getCourseCardLinks();
  if (!links.length) {
    document.querySelectorAll(`.${COURSE_FOLLOW_INDICATOR_CLASS}`).forEach((element) => {
      element.remove();
    });
    return;
  }

  const state = await readCourseFollowState();
  const seenCourseIds = new Set();

  links.forEach((link) => {
    const course = getCourseMetadataFromCardLink(link);
    if (!course?.id || seenCourseIds.has(course.id)) {
      return;
    }

    seenCourseIds.add(course.id);
    updateCourseCardFollowIndicator(link, course, isCourseFollowedInState(state, course.id));
  });

  document.querySelectorAll(`.${COURSE_FOLLOW_INDICATOR_CLASS}`).forEach((indicator) => {
    if (!seenCourseIds.has(indicator.dataset.courseId || "")) {
      indicator.remove();
    }
  });
}

function updateCourseCardFollowIndicator(link, course, followed) {
  const card = findCourseCardContainer(link);
  const anchor = findCourseFollowIndicatorAnchor(card);
  if (!anchor) {
    return;
  }

  let indicator = Array.from(card.querySelectorAll(`.${COURSE_FOLLOW_INDICATOR_CLASS}`))
    .find((element) => element.dataset.courseId === course.id);

  if (!followed) {
    indicator?.remove();
    return;
  }

  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = COURSE_FOLLOW_INDICATOR_CLASS;
    indicator.dataset.courseId = course.id;
    anchor.insertAdjacentElement("beforebegin", indicator);
  }

  if (!indicator.firstElementChild) {
    indicator.replaceChildren(createCourseFollowIcon());
  }

  indicator.setAttribute(
    "aria-label",
    "ددلاین‌های این درس در ویجت مهلت‌ها نمایش داده می‌شوند"
  );
  indicator.title = "";
}

function createCourseFollowIcon(crossed = false) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const elements = [
    ["rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }],
    ["line", { x1: "16", y1: "2", x2: "16", y2: "6" }],
    ["line", { x1: "8", y1: "2", x2: "8", y2: "6" }],
    ["line", { x1: "3", y1: "10", x2: "21", y2: "10" }],
    ["path", { d: "m8 15 2.5 2.5L16 13" }]
  ];

  if (crossed) {
    elements.push(["path", { d: "M4 4l16 16" }]);
  }

  elements.forEach(([tagName, attributes]) => {
    const element = document.createElementNS(svgNamespace, tagName);
    Object.entries(attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
    svg.appendChild(element);
  });

  return svg;
}

function createCourseFollowMenuIcon(crossed) {
  const icon = document.createElement("span");
  icon.className = "qdv-course-follow-menuicon";
  icon.setAttribute("aria-hidden", "true");
  icon.appendChild(createCourseFollowIcon(crossed));
  return icon;
}

function findCourseFollowIndicatorAnchor(card) {
  return findCourseCardMenuButton(card);
}

async function renderCourseListFollowMenuItem() {
  const expandedButton = findExpandedCourseCardMenuButton();
  const menu = expandedButton ? findControlledCourseCardMenu(expandedButton) : null;

  if (!menu || !expandedButton) {
    document.querySelectorAll(`.${COURSE_FOLLOW_MENUITEM_CLASS}`).forEach((element) => {
      element.remove();
    });
    return;
  }

  const course = getCourseMetadataFromCardMenuButton(expandedButton);
  if (!course?.id) {
    return;
  }

  const state = await readCourseFollowState();
  const followed = isCourseFollowedInState(state, course.id);

  document.querySelectorAll(`.${COURSE_FOLLOW_MENUITEM_CLASS}`).forEach((element) => {
    if (element.parentElement !== menu) {
      element.remove();
    }
  });

  let item = menu.querySelector(`.${COURSE_FOLLOW_MENUITEM_CLASS}`);

  if (!item) {
    item = document.createElement("button");
    item.type = "button";
    item.role = "menuitem";
    item.className = COURSE_FOLLOW_MENUITEM_CLASS;
    item.dir = "rtl";

    menu.appendChild(item);
  }

  item.dataset.courseId = course.id;
  item.classList.toggle("is-unfollow-action", followed);
  item.replaceChildren(
    createCourseFollowMenuIcon(followed),
    document.createTextNode(getCourseFollowLabel(followed))
  );
  item.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const latestState = await readCourseFollowState();
    const latestFollowed = isCourseFollowedInState(latestState, course.id);
    await setCourseFollowOverride(course, !latestFollowed);
    window.location.reload();
  };
}

function findControlledCourseCardMenu(button) {
  const menuId = button?.getAttribute("aria-controls");
  if (!menuId) {
    return null;
  }

  const menu = document.getElementById(menuId);
  if (!menu?.matches('[role="menu"], .chakra-menu__menu-list')) {
    return null;
  }

  return menu;
}

function findExpandedCourseCardMenuButton() {
  return Array.from(document.querySelectorAll('button[aria-expanded="true"]')).find((button) => {
    return Boolean(findCourseCardContainer(button));
  }) || null;
}

function findCourseCardMenuButton(card) {
  if (!card) {
    return null;
  }

  return Array.from(card.querySelectorAll("button")).find((button) => {
    const label = normalizeText(
      button.getAttribute("aria-label") ||
      button.getAttribute("title") ||
      button.textContent ||
      ""
    );

    return (
      button.getAttribute("aria-haspopup") === "menu" ||
      button.getAttribute("aria-expanded") !== null ||
      button.className?.toString().includes("menu") ||
      label === "⋮" ||
      label.includes("گزینه") ||
      label.includes("منو")
    );
  }) || null;
}

function getCourseCardLinks() {
  const links = Array.from(document.querySelectorAll('a[href*="/course/"]'));
  const seen = new Set();

  return links.filter((link) => {
    const id = getCourseIdFromLink(link);
    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

function getCourseIdFromLink(link) {
  try {
    const url = new URL(link.href, window.location.href);
    return url.pathname.match(/^\/course\/(\d+)\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}

function getCurrentCourseMetadata() {
  const nextCourse = getNextDataCourse();
  const courseId = getCourseId() || nextCourse?.id;
  const name = nextCourse?.name || getCourseName();

  return normalizeCourseMetadata({
    id: courseId,
    name,
    isArchived: nextCourse?.is_archived ?? nextCourse?.isArchived,
    archivedBy: nextCourse?.archived_by || nextCourse?.archivedBy || null
  });
}

function getCourseMetadataFromCardLink(link) {
  const courseId = getCourseIdFromLink(link);
  const courseNode = findCourseNodeInNextData(courseId);

  return normalizeCourseMetadata(
    courseNode || {
      id: courseId,
      name: getCourseNameFromCardLink(link),
      isArchived: isArchivedCourseListSelected()
    }
  );
}

function getCourseMetadataFromCardMenuButton(button) {
  const card = findCourseCardContainer(button);
  const link = card?.querySelector('a[href*="/course/"]');
  return getCourseMetadataFromCardLink(link);
}

function findCourseCardContainer(element) {
  let current = element?.parentElement;

  while (current && current !== document.body) {
    if (
      current.querySelector?.('a[href*="/course/"]') &&
      current.querySelector?.("button")
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function getCourseNameFromCardLink(link) {
  const paragraphs = Array.from(link?.querySelectorAll("p") || []);
  const firstParagraph = normalizeText(paragraphs[0]?.textContent || "");

  if (firstParagraph) {
    return firstParagraph;
  }

  return normalizeText(link?.textContent || "");
}

function findCourseNodeInNextData(courseId) {
  const id = String(courseId || "");
  if (!id) {
    return null;
  }

  const nextCourse = getNextDataCourse();
  return (
    nextCourse?.courses?.edges
      ?.map((edge) => edge?.node)
      .find((node) => String(node?.id || "") === id) || null
  );
}

function isArchivedCourseListSelected() {
  const selectedOption = document.querySelector("select option:checked");
  return normalizeText(selectedOption?.textContent || "") === "آرشیو شده";
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
    runSafely(() => {
      courseRenderTimer = null;
      showCourseDelays().catch((error) => {
        if (isExtensionContextInvalidatedError(error)) {
          return;
        }

        console.warn("[Deadline Viewer] course delay render failed", error);
      });
    });
  }, delayMs);
}

function ensureCourseDelaysScheduled(delayMs = 250) {
  if (courseRenderTimer) {
    return;
  }

  scheduleCourseDelays(delayMs);
}

function observeCoursePage() {
  if (courseObserver || !document.body) {
    return;
  }

  lastCourseAssignmentSignature = getCourseAssignmentSignature();

  // Quera renders course content asynchronously after route changes. Watch for
  // the assignment list to appear or change, then render once the cards exist.
  courseObserver = new MutationObserver(() => {
    runSafely(() => {
      const signature = getCourseAssignmentSignature();
      const hasAssignments = Boolean(signature);
      const hasBadges = Boolean(document.querySelector(".qdv-course-delay"));

      if (signature !== lastCourseAssignmentSignature) {
        lastCourseAssignmentSignature = signature;
        scheduleCourseDelays();
        return;
      }

      if (hasAssignments && !hasBadges) {
        ensureCourseDelaysScheduled();
      }
    });
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
  if (!document.body || !document.head) {
    runWhenDocumentReady(() => boot(force));
    return;
  }

  const route = `${window.location.pathname}${window.location.search}`;

  if (!force && lastBootRoute === route) {
    if (isCoursePage() && getCourseAssignments().length && !document.querySelector(".qdv-course-delay")) {
      ensureCourseDelaysScheduled();
    }

    if (isCourseListPage() || isCoursePage()) {
      scheduleCourseFollowControls();
    }
    return;
  }

  lastBootRoute = route;

  if (isCoursePage()) {
    removeExistingUi();
    removeExistingCourseUi();
    removeExistingCourseFollowUi();
    activeCourseRenderId += 1;
    observeCoursePage();
    scheduleCourseDelays();
    ensureCourseDelaysScheduled(1200);
    observeCourseFollowControls();
    scheduleCourseFollowControls();
    return;
  }

  if (isCourseListPage()) {
    stopCourseObserver();
    removeExistingUi();
    removeExistingCourseUi();
    removeExistingCourseFollowUi();
    activeCourseRenderId += 1;
    observeCourseFollowControls();
    scheduleCourseFollowControls();
    return;
  }

  stopCourseObserver();
  stopCourseFollowObserver();
  removeExistingCourseFollowUi();
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
    window.setTimeout(() => {
      runSafely(() => boot());
    }, 0);
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
    routePollTimer = window.setInterval(() => {
      runSafely(() => boot());
    }, 1000);
  }
}

installCourseFollowStateStorageListener();
primeCourseFollowStateMirror();
installRouteChangeWatcher();
runWhenDocumentReady(() => {
  runSafely(() => boot(true));
});

function runWhenDocumentReady(callback) {
  if (document.body && document.head) {
    callback();
    return;
  }

  document.addEventListener("DOMContentLoaded", () => {
    runSafely(callback);
  }, { once: true });
}
