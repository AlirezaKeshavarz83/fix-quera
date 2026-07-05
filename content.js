const BOX_ID = "deadline-viewer-box";
const STYLE_ID = "deadline-viewer-style";
const TOOLTIP_ID = "deadline-viewer-tooltip";
const TEHRAN_TIME_ZONE = "Asia/Tehran";
const COURSE_TOTAL_ID = "deadline-viewer-course-total";
const COURSE_CACHE_PREFIX = "qdv-course-delay";
const COURSE_DELAY_BUCKETS_KEY = "qdv-course-delay-buckets:v1";
const COURSE_DELAY_BUCKET_PANEL_ID = "deadline-viewer-delay-buckets";
const COURSE_FOLLOW_STATE_KEY = "qdv-course-follow-state:v1";
const COURSE_FOLLOW_STATE_MIRROR_KEY = "qdv-course-follow-state-mirror:v1";
const COURSE_FOLLOW_BUTTON_CLASS = "qdv-course-follow-button";
const COURSE_FOLLOW_MENUITEM_CLASS = "qdv-course-follow-menuitem";
const COURSE_FOLLOW_INDICATOR_CLASS = "qdv-course-follow-indicator";
const CACHE_TTL_HARD_DEADLINE_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_TTL_ACTIVE_COURSE_MS = 60 * 60 * 1000;
const CACHE_TTL_ACTIVE_ASSIGNMENT_MS = 5 * 60 * 1000;
const COURSE_QUEUE_BATCH_SIZE = 1;
const RATE_LIMIT_DEESCALATE_IDLE_MS = 30000;
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
let delayBucketRenderTimer = null;
let delayBucketStateReady = null;
let lastBootRoute = "";
let routePollTimer = null;
let activeCourseRenderId = 0;
let courseFollowStateCache = null;
let courseFollowStateReady = null;
let courseFollowObserver = null;
let courseFollowRenderTimer = null;
let lastCourseFollowRenderKey = "";
let courseBucketEditor = null;

const rateLimiter = {
  tier: 1,
  tierStartedAt: 0,
  lastRequestAt: 0
};

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

    #${COURSE_DELAY_BUCKET_PANEL_ID} {
      --qdv-primary: var(--colors-primary, #0076a6);
      --qdv-primary-soft: var(--colors-primary-hover-opaque, rgba(0, 168, 214, 0.07));
      --qdv-text: var(--chakra-colors-text-normal, #1a202c);
      --qdv-muted: var(--chakra-colors-text-pale, #718096);
      --qdv-border: var(--colors-border, var(--chakra-colors-border-gray, #e2e8f0));
      --qdv-surface: var(--chakra-colors-bg-pale, #ffffff);
      width: 100%;
      color: var(--qdv-text);
      direction: rtl;
      font-family: inherit;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-toolbar,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-list,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-form,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card,
    .qdv-bucket-modal,
    .qdv-bucket-dialog {
      box-sizing: border-box;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-heading {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-title {
      color: var(--qdv-text);
      font-size: 13px;
      font-weight: 800;
      line-height: 1.5;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-empty {
      margin: 0;
      padding: 10px 12px;
      color: var(--qdv-muted);
      background: var(--qdv-primary-soft);
      border: 1px dashed var(--qdv-border);
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.7;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card {
      padding: 12px;
      background: transparent;
      border: 1px solid var(--qdv-border);
      border-radius: 8px;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-form {
      padding: 12px;
      background: var(--qdv-surface);
      border: 1px solid var(--qdv-border);
      border-radius: 8px;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card.is-over {
      border-color: rgba(220, 64, 64, 0.42);
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card.is-warning {
      border-color: rgba(183, 121, 31, 0.42);
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-head,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-actions,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metrics,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-form-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-head,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metrics {
      justify-content: space-between;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-name {
      min-width: 0;
      color: var(--qdv-text);
      font-size: 13px;
      font-weight: 800;
      line-height: 1.6;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-title-wrap {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-capacity {
      flex: 0 0 auto;
      color: var(--qdv-muted);
      font-size: 10px;
      font-weight: 700;
      line-height: 1.5;
      white-space: nowrap;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-note {
      color: var(--qdv-muted);
      font-size: 11px;
      line-height: 1.6;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-note.has-warning {
      color: #b7791f;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-note.has-error {
      color: #dc4040;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-progress {
      position: relative;
      height: 8px;
      margin: 10px 0;
      overflow: hidden;
      background: var(--qdv-primary-soft);
      border-radius: 999px;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-progress-fill {
      height: 100%;
      width: 0;
      background: var(--qdv-primary);
      border-radius: inherit;
      transition: width 160ms ease;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card.is-over .qdv-bucket-progress-fill {
      background: #dc4040;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metric {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metric-label {
      color: var(--qdv-muted);
      font-size: 10px;
      line-height: 1.4;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metric-value {
      color: var(--qdv-text);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metric-value.is-over {
      color: #dc4040;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} button,
    #${COURSE_DELAY_BUCKET_PANEL_ID} input,
    #${COURSE_DELAY_BUCKET_PANEL_ID} select {
      font: inherit;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 5px 10px;
      color: var(--qdv-primary);
      background: var(--qdv-primary-soft);
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.5;
      white-space: nowrap;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button:hover,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button:focus {
      border-color: var(--qdv-primary);
      outline: none;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button.is-subtle {
      color: var(--qdv-muted);
      background: transparent;
      border-color: var(--qdv-border);
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button.is-danger {
      color: #dc4040;
      background: rgba(220, 64, 64, 0.08);
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-gear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      color: var(--qdv-muted);
      background: transparent;
      border: 1px solid var(--qdv-border);
      border-radius: 6px;
      cursor: pointer;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-info-button,
    .qdv-bucket-modal .qdv-bucket-info-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      color: var(--qdv-muted);
      background: transparent;
      border: 1px solid var(--qdv-border);
      border-radius: 6px;
      cursor: pointer;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-info-button:hover,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-info-button:focus,
    .qdv-bucket-modal .qdv-bucket-info-button:hover,
    .qdv-bucket-modal .qdv-bucket-info-button:focus {
      color: var(--qdv-primary);
      border-color: var(--qdv-primary);
      outline: none;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-info-button svg,
    .qdv-bucket-modal .qdv-bucket-info-button svg {
      display: block;
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-gear:hover,
    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-gear:focus {
      color: var(--qdv-primary);
      border-color: var(--qdv-primary);
      outline: none;
    }

    #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-gear svg {
      display: block;
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    .qdv-bucket-modal {
      --qdv-primary: var(--colors-primary, #0076a6);
      --qdv-primary-soft: var(--colors-primary-hover-opaque, rgba(0, 168, 214, 0.07));
      --qdv-primary-softer: rgba(0, 168, 214, 0.04);
      --qdv-text: var(--chakra-colors-text-normal, #1a202c);
      --qdv-muted: var(--chakra-colors-text-pale, #718096);
      --qdv-border: var(--colors-border, var(--chakra-colors-border-gray, #e2e8f0));
      --qdv-border-soft: rgba(113, 128, 150, 0.24);
      --qdv-surface: transparent;
      --qdv-surface-raised: #ffffff;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      color: var(--qdv-text);
      background: rgba(15, 23, 42, 0.52);
      direction: rtl;
      font-family: inherit;
    }

    .qdv-bucket-dialog {
      display: flex;
      flex-direction: column;
      width: min(680px, 100%);
      max-height: min(760px, calc(100vh - 36px));
      overflow: hidden;
      background: var(--qdv-surface-raised);
      border: 1px solid var(--qdv-border);
      border-radius: 8px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.32);
    }

    .qdv-bucket-modal-head,
    .qdv-bucket-modal-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--qdv-border-soft);
    }

    .qdv-bucket-modal-head {
      justify-content: space-between;
      min-height: 54px;
    }

    .qdv-bucket-modal-head-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .qdv-bucket-modal-actions {
      justify-content: flex-end;
      flex-wrap: wrap;
      border-top: 1px solid var(--qdv-border-soft);
      border-bottom: 0;
      background: var(--qdv-surface-raised);
    }

    .qdv-bucket-modal-title {
      color: var(--qdv-text);
      font-size: 13px;
      font-weight: 800;
      line-height: 1.5;
    }

    .qdv-bucket-modal-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow: auto;
      padding: 16px 16px 20px;
      scroll-padding-bottom: 76px;
    }

    .qdv-bucket-modal button,
    .qdv-bucket-modal input,
    .qdv-bucket-modal select {
      font: inherit;
    }

    .qdv-bucket-modal .qdv-bucket-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
    }

    .qdv-bucket-modal .qdv-bucket-capacity {
      display: grid;
      grid-column: 1 / -1;
      gap: 6px;
    }

    .qdv-bucket-modal .qdv-bucket-capacity-title {
      color: var(--qdv-text);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.5;
    }

    .qdv-bucket-modal .qdv-bucket-capacity-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .qdv-bucket-modal .qdv-bucket-section-title {
      color: var(--qdv-text);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.6;
    }

    .qdv-bucket-modal .qdv-bucket-member-section {
      padding-top: 2px;
      border-top: 1px solid var(--qdv-border-soft);
    }

    .qdv-bucket-modal .qdv-bucket-member-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .qdv-bucket-modal .qdv-bucket-assignment-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 8px;
    }

    .qdv-bucket-modal .qdv-bucket-assignment {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 42px;
      padding: 6px 0;
      border-bottom: 1px solid var(--qdv-border-soft);
      font-size: 12px;
    }

    .qdv-bucket-modal .qdv-bucket-assignment:last-child {
      border-bottom: 0;
    }

    .qdv-bucket-modal .qdv-bucket-assignment-name {
      min-width: 0;
      overflow: hidden;
      color: var(--qdv-text);
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .qdv-bucket-modal .qdv-bucket-assignment-meta {
      color: var(--qdv-muted);
      font-size: 11px;
      line-height: 1.5;
      white-space: nowrap;
    }

    .qdv-bucket-modal .qdv-bucket-pick-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      padding: 5px 0;
      border-top: 1px solid var(--qdv-border-soft);
    }

    .qdv-bucket-modal .qdv-bucket-pick-row:first-child {
      border-top: 0;
    }

    .qdv-bucket-modal .qdv-bucket-icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      color: var(--qdv-primary);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      font-size: 18px;
      font-weight: 800;
      line-height: 1;
    }

    .qdv-bucket-modal .qdv-bucket-icon-button:hover,
    .qdv-bucket-modal .qdv-bucket-icon-button:focus {
      background: var(--qdv-primary-soft);
      border-color: var(--qdv-primary);
      outline: none;
    }

    .qdv-bucket-modal .qdv-bucket-icon-button.is-danger {
      color: #dc4040;
      background: transparent;
    }

    .qdv-bucket-modal .qdv-bucket-icon-button.is-danger:hover,
    .qdv-bucket-modal .qdv-bucket-icon-button.is-danger:focus {
      background: rgba(220, 64, 64, 0.08);
      border-color: currentColor;
    }

    .qdv-bucket-modal .qdv-bucket-icon-button svg {
      display: block;
      width: 15px;
      height: 15px;
      stroke: currentColor;
    }

    .qdv-bucket-modal .qdv-bucket-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--qdv-text);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .qdv-bucket-modal .qdv-bucket-rounding {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .qdv-bucket-modal .qdv-bucket-toggle input {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--qdv-primary);
    }

    .qdv-bucket-modal .qdv-bucket-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .qdv-bucket-modal .qdv-bucket-field.is-wide,
    .qdv-bucket-modal .qdv-bucket-field.is-hidden {
      grid-column: 1 / -1;
    }

    .qdv-bucket-modal .qdv-bucket-field.is-hidden {
      display: none;
    }

    .qdv-bucket-modal .qdv-bucket-field label {
      color: var(--qdv-text);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.5;
    }

    .qdv-bucket-modal .qdv-bucket-field input,
    .qdv-bucket-modal .qdv-bucket-field select {
      min-width: 0;
      min-height: 34px;
      padding: 6px 9px;
      color: var(--qdv-text);
      background: var(--qdv-surface);
      border: 1px solid var(--qdv-border);
      border-radius: 6px;
      direction: rtl;
      font-size: 12px;
      line-height: 1.5;
    }

    .qdv-bucket-modal .qdv-bucket-field input:focus,
    .qdv-bucket-modal .qdv-bucket-field select:focus {
      border-color: var(--qdv-primary);
      box-shadow: 0 0 0 1px var(--qdv-primary);
      outline: none;
    }

    .qdv-bucket-modal .qdv-bucket-field-help {
      color: var(--qdv-muted);
      font-size: 10px;
      line-height: 1.6;
    }

    .qdv-bucket-modal .qdv-bucket-add-list {
      margin-top: 8px;
      padding: 4px 0 0;
      border-top: 1px solid var(--qdv-border-soft);
      border-radius: 6px;
    }

    .qdv-bucket-modal .qdv-bucket-add-button-row {
      display: flex;
      justify-content: flex-start;
      margin-top: 8px;
    }

    .qdv-bucket-modal .qdv-bucket-help {
      color: var(--qdv-text);
      font-size: 12px;
      line-height: 1.8;
    }

    .qdv-bucket-modal .qdv-bucket-help p {
      margin: 0;
    }

    .qdv-bucket-modal .qdv-bucket-help ul {
      margin: 8px 0 0;
      padding: 0 18px 0 0;
    }

    .qdv-bucket-modal .qdv-bucket-help li {
      margin: 4px 0;
    }

    .qdv-bucket-modal .qdv-bucket-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 30px;
      padding: 5px 10px;
      color: #ffffff;
      background: var(--qdv-primary);
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.5;
      white-space: nowrap;
    }

    .qdv-bucket-modal .qdv-bucket-button:hover,
    .qdv-bucket-modal .qdv-bucket-button:focus {
      filter: brightness(0.96);
      outline: none;
    }

    .qdv-bucket-modal .qdv-bucket-button.is-subtle {
      color: var(--qdv-muted);
      background: transparent;
      border-color: var(--qdv-border);
    }

    .qdv-bucket-modal .qdv-bucket-button.is-danger {
      color: #dc4040;
      background: transparent;
      border-color: transparent;
    }

    .qdv-bucket-modal .qdv-bucket-button.is-danger:hover,
    .qdv-bucket-modal .qdv-bucket-button.is-danger:focus {
      background: rgba(220, 64, 64, 0.08);
      border-color: currentColor;
      filter: none;
    }

    .qdv-bucket-modal .qdv-bucket-button svg {
      display: block;
      width: 14px;
      height: 14px;
      stroke: currentColor;
    }

    html[data-theme="dark"] #${COURSE_DELAY_BUCKET_PANEL_ID},
    [data-theme="dark"] #${COURSE_DELAY_BUCKET_PANEL_ID},
    body.chakra-ui-dark #${COURSE_DELAY_BUCKET_PANEL_ID},
    html[data-theme="dark"] .qdv-bucket-modal,
    [data-theme="dark"] .qdv-bucket-modal,
    body.chakra-ui-dark .qdv-bucket-modal {
      --qdv-primary: #91def3;
      --qdv-primary-soft: rgba(145, 222, 243, 0.12);
      --qdv-primary-softer: rgba(145, 222, 243, 0.06);
      --qdv-text: #edf2f7;
      --qdv-muted: #a0aec0;
      --qdv-border: #2d3748;
      --qdv-border-soft: rgba(160, 174, 192, 0.22);
      --qdv-surface: #1a202c;
      --qdv-surface-raised: #1a202c;
    }

    html[data-theme="dark"] #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card,
    [data-theme="dark"] #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card,
    body.chakra-ui-dark #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card {
      background: var(--qdv-surface);
    }

    html[data-theme="dark"] #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button.is-danger,
    [data-theme="dark"] #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button.is-danger,
    body.chakra-ui-dark #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-button.is-danger,
    html[data-theme="dark"] .qdv-bucket-modal .qdv-bucket-button.is-danger,
    [data-theme="dark"] .qdv-bucket-modal .qdv-bucket-button.is-danger,
    body.chakra-ui-dark .qdv-bucket-modal .qdv-bucket-button.is-danger,
    html[data-theme="dark"] .qdv-bucket-modal .qdv-bucket-icon-button.is-danger,
    [data-theme="dark"] .qdv-bucket-modal .qdv-bucket-icon-button.is-danger,
    body.chakra-ui-dark .qdv-bucket-modal .qdv-bucket-icon-button.is-danger {
      color: #feb2b2;
    }

    html[data-theme="dark"] .qdv-bucket-modal .qdv-bucket-button:not(.is-subtle):not(.is-danger),
    [data-theme="dark"] .qdv-bucket-modal .qdv-bucket-button:not(.is-subtle):not(.is-danger),
    body.chakra-ui-dark .qdv-bucket-modal .qdv-bucket-button:not(.is-subtle):not(.is-danger) {
      color: #12212a;
    }

    @media (max-width: 640px) {
      #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-toolbar,
      #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-card-head,
      #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-metrics {
        align-items: stretch;
        flex-direction: column;
      }

      #${COURSE_DELAY_BUCKET_PANEL_ID} .qdv-bucket-form {
        grid-template-columns: 1fr;
      }

      .qdv-bucket-modal {
        align-items: stretch;
        padding: 10px;
      }

      .qdv-bucket-dialog {
        max-height: calc(100vh - 20px);
      }

      .qdv-bucket-modal .qdv-bucket-form {
        grid-template-columns: 1fr;
      }

      .qdv-bucket-modal .qdv-bucket-modal-actions {
        justify-content: stretch;
      }

      .qdv-bucket-modal .qdv-bucket-button {
        flex: 1 1 auto;
      }
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

function isSubmissionsPage() {
  return /^\/course\/assignments\/\d+\/submissions/.test(window.location.pathname);
}

function getAssignmentIdFromUrl() {
  return window.location.pathname.match(/^\/course\/assignments\/(\d+)\//)?.[1] || null;
}

function getPageContext() {
  if (isSubmissionsPage()) {
    return "submissions";
  }
  if (isAssignmentPage()) {
    return "assignment";
  }
  return "course";
}

function getEffectiveCacheTTL(cacheEntry, pageContext) {
  if (cacheEntry?.hardDeadlinePassed) {
    return CACHE_TTL_HARD_DEADLINE_MS;
  }
  if (pageContext === "submissions") {
    return 0;
  }
  if (pageContext === "assignment") {
    return CACHE_TTL_ACTIVE_ASSIGNMENT_MS;
  }
  return CACHE_TTL_ACTIVE_COURSE_MS;
}

function isUserTyping() {
  const active = document.activeElement;
  if (!active || active === document.body) {
    return false;
  }
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;
}

function getRateLimitDelayMs() {
  maybeDeescalateRateLimit();
  return rateLimiter.tier * 1000 + Math.floor(Math.random() * 250);
}

function maybeDeescalateRateLimit() {
  if (!rateLimiter.lastRequestAt) {
    return;
  }
  const idleMs = Date.now() - rateLimiter.lastRequestAt;
  if (idleMs >= RATE_LIMIT_DEESCALATE_IDLE_MS) {
    const tiers = Math.floor(idleMs / RATE_LIMIT_DEESCALATE_IDLE_MS);
    rateLimiter.tier = Math.max(1, rateLimiter.tier - tiers);
    rateLimiter.tierStartedAt = Date.now();
  }
}

function recordRateLimitRequest() {
  const now = Date.now();
  maybeDeescalateRateLimit();
  if (!rateLimiter.tierStartedAt) {
    rateLimiter.tierStartedAt = now;
  }
  rateLimiter.lastRequestAt = now;
  const tierDurationMs = rateLimiter.tier * 10 * 1000;
  if (now - rateLimiter.tierStartedAt >= tierDurationMs) {
    rateLimiter.tier += 1;
    rateLimiter.tierStartedAt = now;
  }
}

function escalateRateLimit() {
  rateLimiter.tier += 1;
  rateLimiter.tierStartedAt = Date.now();
}

function buildAssignmentFinishTimeMap(nextCourse) {
  const map = new Map();
  if (!nextCourse?.assignments) {
    return map;
  }
  for (const assignment of nextCourse.assignments) {
    const id = String(assignment?.pk || assignment?.id || "");
    const finishTime = assignment?.finish_time;
    if (id && finishTime) {
      const date = new Date(finishTime);
      if (!Number.isNaN(date.getTime())) {
        map.set(id, date);
      }
    }
  }
  return map;
}

function detectHardDeadlinePassedFromDoc(doc) {
  const patterns = {
    serverNow: /(?:var|let|const)\s+server_now\s*=\s*new\s+Date\s*\(['"]([^'"]+)['"]\)/,
    finishTime: /(?:var|let|const)\s+finish_time\s*=\s*new\s+Date\s*\(['"]([^'"]+)['"]\)/,
    extraTimeSeconds: /(?:var|let|const)\s+extra_time\s*=\s*([0-9]+)/
  };

  let serverNow = null;
  let finishTime = null;
  let extraTimeSeconds = null;

  for (const script of doc.scripts) {
    const text = script.textContent || "";
    if (!serverNow) {
      const match = text.match(patterns.serverNow);
      if (match) serverNow = new Date(match[1]);
    }
    if (!finishTime) {
      const match = text.match(patterns.finishTime);
      if (match) finishTime = new Date(match[1]);
    }
    if (extraTimeSeconds === null) {
      const match = text.match(patterns.extraTimeSeconds);
      if (match) extraTimeSeconds = Number(match[1]);
    }
    if (serverNow && finishTime && extraTimeSeconds !== null) {
      break;
    }
  }

  if (!serverNow || !finishTime || extraTimeSeconds === null) {
    return false;
  }
  if (Number.isNaN(serverNow.getTime()) || Number.isNaN(finishTime.getTime())) {
    return false;
  }
  return serverNow >= new Date(finishTime.getTime() + extraTimeSeconds * 1000);
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

    if (typeof normalized.isArchived !== "boolean" && typeof previous.isArchived === "boolean") {
      nextCourse.isArchived = previous.isArchived;
    }

    if (!normalized.archivedBy && previous.archivedBy) {
      nextCourse.archivedBy = previous.archivedBy;
    }

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

function createEmptyDelayBucketState() {
  return {
    version: 1,
    courses: {}
  };
}

function normalizeDelayBucketState(value) {
  const state = createEmptyDelayBucketState();

  if (!value || typeof value !== "object") {
    return state;
  }

  const courses = value.courses && typeof value.courses === "object"
    ? value.courses
    : {};

  Object.entries(courses).forEach(([courseId, courseState]) => {
    const buckets = Array.isArray(courseState?.buckets)
      ? courseState.buckets
      : [];

    state.courses[String(courseId)] = {
      buckets: buckets
        .map((bucket, index) => normalizeDelayBucket(bucket, index))
        .filter(Boolean)
    };
  });

  return state;
}

function normalizeDelayBucket(bucket, index = 0) {
  if (!bucket || typeof bucket !== "object") {
    return null;
  }

  const id = normalizeText(String(bucket.id || ""));
  const keyword = normalizeText(bucket.keyword || "");

  if (!id || !keyword) {
    return null;
  }

  const overrides = {};
  if (bucket.overrides && typeof bucket.overrides === "object") {
    Object.entries(bucket.overrides).forEach(([assignmentId, value]) => {
      if (value === "include" || value === "exclude") {
        overrides[String(assignmentId)] = value;
      }
    });
  }

  const rounding = ["none", "hour", "day"].includes(bucket.rounding)
    ? bucket.rounding
    : "hour";

  return {
    id,
    title: normalizeText(bucket.title || ""),
    keyword,
    capacityHours: Math.max(0, Math.floor(Number(bucket.capacityHours) || 0)),
    rounding,
    order: Number.isFinite(Number(bucket.order)) ? Number(bucket.order) : index,
    overrides,
    createdAt: Number(bucket.createdAt) || Date.now(),
    updatedAt: Number(bucket.updatedAt) || Date.now()
  };
}

async function readDelayBucketState() {
  if (!delayBucketStateReady) {
    delayBucketStateReady = storageGet(COURSE_DELAY_BUCKETS_KEY)
      .then((values) => normalizeDelayBucketState(values?.[COURSE_DELAY_BUCKETS_KEY]))
      .catch((error) => {
        if (isExtensionContextInvalidatedError(error)) {
          return createEmptyDelayBucketState();
        }
        console.warn("[Deadline Viewer] delay bucket state read failed", error);
        return createEmptyDelayBucketState();
      });
  }
  return delayBucketStateReady;
}

async function writeDelayBucketState(state) {
  const normalized = normalizeDelayBucketState(state);
  delayBucketStateReady = Promise.resolve(normalized);
  await storageSet({ [COURSE_DELAY_BUCKETS_KEY]: normalized });
}

async function updateDelayBucketState(mutator) {
  delayBucketStateReady = null;
  const state = await readDelayBucketState();
  const mutatedState = mutator(state);
  const nextState = mutatedState || state;
  await writeDelayBucketState(nextState);
  return nextState;
}

function getCourseDelayBucketState(state, courseId) {
  const id = String(courseId || "");
  if (!state.courses[id]) {
    state.courses[id] = { buckets: [] };
  }

  state.courses[id].buckets.sort((a, b) => a.order - b.order);
  return state.courses[id];
}

function createDelayBucketId() {
  return `bucket-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCourseAssignments(nextCourse = getNextDataCourse()) {
  const assignmentsById = new Map();

  if (Array.isArray(nextCourse?.assignments)) {
    nextCourse.assignments.forEach((assignment) => {
      const id = String(assignment?.pk || assignment?.id || "");
      if (!id) {
        return;
      }

      assignmentsById.set(id, {
        id,
        name: normalizeText(assignment.name || id),
        finalUrl: `/course/assignments/${id}/submissions/final`,
        card: null
      });
    });
  }

  document
    .querySelectorAll('a[href*="/course/assignments/"][href*="/problems"]')
    .forEach((link) => {
      const url = new URL(link.href, window.location.href);
      const id = url.pathname.match(/\/course\/assignments\/(\d+)\/problems\/?/)?.[1];

      if (!id) {
        return;
      }

      const card = link.closest(".chakra-linkbox");
      if (!card) {
        return;
      }

      const previous = assignmentsById.get(id) || {};
      assignmentsById.set(id, {
        ...previous,
        id,
        name: normalizeText(link.textContent || link.getAttribute("title") || previous.name || id),
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

  if (isUserTyping()) {
    scheduleCourseDelays(1000);
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
  const assignments = getCourseAssignments(nextCourse);

  if (!assignments.length) {
    injectStyles();
    removeExistingCourseUi();
    const emptyState = createCourseDelayState(courseId, courseName, []);
    await renderDelayBucketPanel(emptyState);
    return;
  }

  injectStyles();

  const state = createCourseDelayState(courseId, courseName, assignments);

  if (!document.getElementById(COURSE_TOTAL_ID)) {
    insertCourseTotalBadge(state);
  }
  await renderDelayBucketPanel(state);

  for (const assignment of assignments) {
    if (assignment.card && !assignment.card.querySelector(
      `.qdv-course-delay[data-assignment-id="${escapeCssIdent(assignment.id)}"]`
    )) {
      insertAssignmentDelayBadge(assignment, COURSE_DELAY_STATUS.loading, "...");
    }
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
    delaySecondsByAssignment: new Map(),
    delayHoursByAssignment: new Map(),
    statusByAssignment: new Map(),
    failedAssignments: new Set(),
    pendingAssignments: new Set(assignments.map((assignment) => assignment.id))
  };
}

async function hydrateCourseDelayState(state) {
  const now = Date.now();
  const nextCourse = getNextDataCourse();
  const finishTimeMap = buildAssignmentFinishTimeMap(nextCourse);
  const pageContext = getPageContext();

  for (const assignment of state.assignments) {
    const finishTime = finishTimeMap.get(assignment.id);
    if (finishTime && finishTime.getTime() > now) {
      applyAssignmentDelayResult(state, assignment, {
        delaySeconds: 0,
        fetchedAt: now,
        status: COURSE_DELAY_STATUS.fresh
      });
      continue;
    }

    const cache = await readAssignmentDelayCache(state.courseId, assignment.id);

    if (cache) {
      const ttl = getEffectiveCacheTTL(cache, pageContext);
      const isFresh = ttl > 0 && now - Number(cache.fetchedAt) < ttl;

      applyAssignmentDelayResult(state, assignment, {
        delaySeconds: Number(cache.delaySeconds) || 0,
        fetchedAt: Number(cache.fetchedAt) || 0,
        status: isFresh ? COURSE_DELAY_STATUS.fresh : COURSE_DELAY_STATUS.stale
      });

      if (isFresh) {
        continue;
      }
    }

    enqueueAssignmentDelayFetch(state, assignment, {
      showLoading: !cache
    });
  }

  updateCourseTotalBadge(state);
}

async function readAssignmentDelayCache(courseId, assignmentId) {
  const key = getAssignmentDelayCacheKey(courseId, assignmentId);
  const values = await storageGet(key);
  return values?.[key] || null;
}

async function writeAssignmentDelayCache(courseId, assignment, delaySeconds, status, hardDeadlinePassed) {
  const key = getAssignmentDelayCacheKey(courseId, assignment.id);
  await storageSet({
    [key]: {
      courseId,
      assignmentId: assignment.id,
      assignmentName: assignment.name,
      delaySeconds,
      displayHours: getRoundedDelayHours(delaySeconds),
      fetchedAt: Date.now(),
      status,
      hardDeadlinePassed: Boolean(hardDeadlinePassed)
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
  state.statusByAssignment.set(assignment.id, COURSE_DELAY_STATUS.loading);
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
          recordRateLimitRequest();
          await writeAssignmentDelayCache(
            courseId,
            assignment,
            result.delaySeconds,
            COURSE_DELAY_STATUS.fresh,
            result.hardDeadlinePassed
          );
          return result;
        })
        .catch((error) => {
          console.warn("[Deadline Viewer] course delay fetch failed", assignment.id, error);
          return {
            delaySeconds: 0,
            fetchedAt: Date.now(),
            status: COURSE_DELAY_STATUS.error,
            hardDeadlinePassed: false
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
    cache: "no-cache"
  });

  if (response.status === 429 || response.status >= 500) {
    escalateRateLimit();
  }

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

  const hardDeadlinePassed = detectHardDeadlinePassedFromDoc(doc);

  return {
    delaySeconds: delays.length ? Math.max(...delays) : 0,
    fetchedAt: Date.now(),
    status: COURSE_DELAY_STATUS.fresh,
    hardDeadlinePassed
  };
}

function applyAssignmentDelayResult(state, assignment, result) {
  if (state.renderId !== activeCourseRenderId) {
    return;
  }

  const delaySeconds = Number(result.delaySeconds) || 0;
  const delayHours = getRoundedDelayHours(delaySeconds);
  const status = result.status || COURSE_DELAY_STATUS.fresh;
  const hadKnownValue = state.delaySecondsByAssignment.has(assignment.id);

  state.pendingAssignments.delete(assignment.id);
  state.statusByAssignment.set(assignment.id, status);

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

  state.delaySecondsByAssignment.set(assignment.id, delaySeconds);
  state.delayHoursByAssignment.set(assignment.id, delayHours);
  insertAssignmentDelayBadge(assignment, status, formatRoundedHours(delayHours));
  updateCourseTotalBadge(state);
}

function waitForCourseQueueDelay() {
  const delayMs = getRateLimitDelayMs();
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function insertAssignmentDelayBadge(assignment, status, value) {
  if (!assignment.card) {
    return;
  }

  const badge = getOrCreateAssignmentDelayBadge(assignment);
  badge.className = `qdv-course-delay is-${status}`;
  badge.title = getAssignmentDelayTitle(status);
  badge.replaceChildren(
    document.createTextNode("تاخیر"),
    createCourseDelayValue(value)
  );
}

function getOrCreateAssignmentDelayBadge(assignment) {
  if (!assignment.card) {
    return null;
  }

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

  const firstCard = state.assignments.find((assignment) => assignment.card)?.card;
  firstCard?.parentElement?.prepend(total);
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

  scheduleDelayBucketPanelRender(state);
}

async function renderDelayBucketPanel(courseDelayState) {
  if (courseDelayState.renderId !== activeCourseRenderId) {
    return;
  }

  injectStyles();
  captureDelayBucketEditor();

  const bucketState = await readDelayBucketState();
  const courseBuckets = getCourseDelayBucketState(bucketState, courseDelayState.courseId);
  const panel = getOrCreateDelayBucketPanel(courseDelayState);

  if (!panel) {
    return;
  }

  panel.replaceChildren(
    createDelayBucketToolbar(courseDelayState, courseBuckets),
    ...createDelayBucketBody(courseDelayState, courseBuckets)
  );

  if (courseBucketEditor?.courseId === courseDelayState.courseId) {
    const modal = courseBucketEditor.mode === "info"
      ? createDelayBucketInfoModal(courseDelayState)
      : createDelayBucketModal(
        courseDelayState,
        courseBuckets,
        courseBuckets.buckets.find((bucket) => bucket.id === courseBucketEditor.bucketId)
      );
    panel.appendChild(modal);
    if (courseBucketEditor.needsInitialFocus) {
      courseBucketEditor.needsInitialFocus = false;
      focusInitialDelayBucketModalField(modal);
    }
  }
}

function scheduleDelayBucketPanelRender(courseDelayState, delayMs = 0) {
  if (delayBucketRenderTimer) {
    clearTimeout(delayBucketRenderTimer);
  }

  delayBucketRenderTimer = setTimeout(() => {
    delayBucketRenderTimer = null;

    if (courseDelayState.renderId !== activeCourseRenderId) {
      return;
    }

    if (isUserTyping()) {
      scheduleDelayBucketPanelRender(courseDelayState, 1000);
      return;
    }

    renderDelayBucketPanel(courseDelayState).catch((error) => {
      if (isExtensionContextInvalidatedError(error)) {
        return;
      }

      console.warn("[Deadline Viewer] delay bucket render failed", error);
    });
  }, delayMs);
}

function getOrCreateDelayBucketPanel(courseDelayState) {
  let panel = document.getElementById(COURSE_DELAY_BUCKET_PANEL_ID);
  if (panel) {
    return panel;
  }

  panel = document.createElement("section");
  panel.id = COURSE_DELAY_BUCKET_PANEL_ID;
  panel.dir = "rtl";

  const lectureSection = findCourseLecturesSection();
  if (lectureSection?.children?.length > 1) {
    lectureSection.children[0].insertAdjacentElement("afterend", panel);
    return panel;
  }

  if (lectureSection) {
    lectureSection.appendChild(panel);
    return panel;
  }

  const firstCard = courseDelayState.assignments.find((assignment) => assignment.card)?.card;
  if (firstCard?.parentElement) {
    firstCard.parentElement.insertAdjacentElement("afterend", panel);
    return panel;
  }

  document.querySelector("main")?.appendChild(panel);
  return panel;
}

function findCourseLecturesSection() {
  const heading = Array.from(document.querySelectorAll("h1, h2, h3, h4")).find(
    (element) => normalizeText(element.textContent || "").includes("درسنامه")
  );

  return heading?.parentElement?.parentElement || null;
}

function createDelayBucketToolbar(courseDelayState, courseBuckets) {
  const toolbar = document.createElement("div");
  toolbar.className = "qdv-bucket-toolbar";

  const heading = document.createElement("div");
  heading.className = "qdv-bucket-heading";

  const title = document.createElement("div");
  title.className = "qdv-bucket-title";
  title.textContent = "بودجه تاخیر";

  const infoButton = createDelayBucketInfoButton(courseDelayState, {
    returnFocus: { type: "info" }
  });
  infoButton.dataset.bucketAction = "info";

  heading.append(title, infoButton);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "qdv-bucket-button";
  addButton.dataset.bucketAction = "add";
  addButton.textContent = "افزودن باکت";
  addButton.addEventListener("click", () => {
    courseBucketEditor = {
      courseId: courseDelayState.courseId,
      mode: "create",
      bucketId: null,
      draft: createDelayBucketDraft(),
      adding: false,
      needsInitialFocus: true,
      returnFocus: { type: "add" }
    };
    renderDelayBucketPanel(courseDelayState);
  });

  toolbar.append(heading, addButton);
  return toolbar;
}

function createDelayBucketBody(courseDelayState, courseBuckets) {
  const children = [];

  if (!courseBuckets.buckets.length) {
    const empty = document.createElement("p");
    empty.className = "qdv-bucket-empty";
    empty.textContent = "هنوز باکتی ندارید.";
    children.push(empty);
    return children;
  }

  const list = document.createElement("div");
  list.className = "qdv-bucket-list";

  const membershipCounts = getDelayBucketMembershipCounts(courseDelayState, courseBuckets);
  courseBuckets.buckets.forEach((bucket) => {
    list.appendChild(createDelayBucketCard(courseDelayState, courseBuckets, bucket, membershipCounts));
  });

  children.push(list);
  return children;
}

function createDelayBucketDraft(bucket = {}) {
  const capacityHours = Math.max(0, Math.floor(Number(bucket.capacityHours) || 0));
  const capacityDays = Math.floor(capacityHours / 24);
  const remainingHours = capacityHours % 24;
  return {
    title: bucket.title || "",
    keyword: bucket.keyword || "",
    capacityDays: capacityDays ? String(capacityDays) : "",
    capacityHours: remainingHours ? String(remainingHours) : "",
    roundingEnabled: bucket.rounding && bucket.rounding !== "none",
    rounding: bucket.rounding && bucket.rounding !== "none" ? bucket.rounding : "hour"
  };
}

function captureDelayBucketEditor() {
  if (!courseBucketEditor) {
    return;
  }

  const modal = document.querySelector(".qdv-bucket-modal");
  const form = modal?.querySelector(".qdv-bucket-form");
  if (form) {
    courseBucketEditor.draft = {
      title: form.querySelector('[name="title"]')?.value || "",
      keyword: form.querySelector('[name="keyword"]')?.value || "",
      capacityDays: form.querySelector('[name="capacityDays"]')?.value || "",
      capacityHours: form.querySelector('[name="capacityHours"]')?.value || "",
      roundingEnabled: Boolean(form.querySelector('[name="roundingEnabled"]')?.checked),
      rounding: form.querySelector('[name="rounding"]')?.value || "hour"
    };
  }
}

function createDelayBucketModal(courseDelayState, courseBuckets, editingBucket) {
  const modalTitleId = `qdv-bucket-modal-title-${courseDelayState.courseId}`;
  const modal = document.createElement("div");
  modal.className = "qdv-bucket-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", modalTitleId);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      if (courseBucketEditor?.mode === "info") {
        closeDelayBucketInfoModal(courseDelayState);
      } else {
        closeDelayBucketModal(courseDelayState);
      }
    }
  });
  modal.addEventListener("keydown", (event) => {
    handleDelayBucketModalKeydown(event, courseDelayState, modal);
  });

  const dialog = document.createElement("div");
  dialog.className = "qdv-bucket-dialog";
  dialog.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const form = createDelayBucketForm(editingBucket);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveDelayBucketFromModal(courseDelayState, editingBucket, form);
  });

  const body = document.createElement("div");
  body.className = "qdv-bucket-modal-body";
  body.appendChild(form);

  if (editingBucket) {
    body.appendChild(createDelayBucketMemberManager(courseDelayState, courseBuckets, editingBucket));
  }

  dialog.append(
    createDelayBucketModalHead(courseDelayState, editingBucket, modalTitleId),
    body,
    createDelayBucketModalActions(courseDelayState, editingBucket, form)
  );
  modal.appendChild(dialog);
  return modal;
}

function createDelayBucketInfoModal(courseDelayState) {
  const modalTitleId = `qdv-bucket-info-title-${courseDelayState.courseId}`;
  const modal = document.createElement("div");
  modal.className = "qdv-bucket-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", modalTitleId);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeDelayBucketInfoModal(courseDelayState);
    }
  });
  modal.addEventListener("keydown", (event) => {
    handleDelayBucketModalKeydown(event, courseDelayState, modal);
  });

  const dialog = document.createElement("div");
  dialog.className = "qdv-bucket-dialog";
  dialog.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const head = document.createElement("div");
  head.className = "qdv-bucket-modal-head";

  const title = document.createElement("div");
  title.id = modalTitleId;
  title.className = "qdv-bucket-modal-title";
  title.textContent = "راهنمای باکت تاخیر";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "qdv-bucket-icon-button";
  close.setAttribute("aria-label", "بستن");
  close.appendChild(createBucketIcon("x"));
  close.addEventListener("click", () => closeDelayBucketInfoModal(courseDelayState));

  head.append(title, close);

  const body = document.createElement("div");
  body.className = "qdv-bucket-modal-body";
  body.appendChild(createDelayBucketHelpContent());

  dialog.append(head, body);
  modal.appendChild(dialog);
  return modal;
}

function createDelayBucketHelpContent() {
  const help = document.createElement("div");
  help.className = "qdv-bucket-help";

  [
    "در این بخش می‌تونید مجموع تاخیر مجاز مصرف شده و باقی‌مونده‌تون رو رصد کنید.",
    "می‌تونید برای انواع مختلف تمرین باکت‌های مختلف تعریف کنید.",
    "برای هر باکت مجموع تاخیر مجاز و کلیدواژه‌ای که این تمرین‌ها رو پیدا می‌کنه رو مشخص کنید.",
    "هر تمرینی که عنوانش کلیدواژه‌ی مشخص شده رو داشته باشه به طور خودکار به باکت اضافه میشه. می‌تونید دستی تمرین‌ها رو حذف و اضافه کنید."
  ].forEach((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    help.appendChild(paragraph);
  });

  return help;
}

function createDelayBucketInfoButton(courseDelayState, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "qdv-bucket-info-button";
  button.setAttribute("aria-label", "راهنمای باکت تاخیر");
  button.title = "راهنما";
  button.appendChild(createBucketIcon("info", 19));
  button.addEventListener("click", () => {
    if (options.fromEditor) {
      captureDelayBucketEditor();
    }

    const previousEditor = options.fromEditor && courseBucketEditor
      ? { ...courseBucketEditor, needsInitialFocus: false }
      : null;

    courseBucketEditor = {
      courseId: courseDelayState.courseId,
      mode: "info",
      previousEditor,
      needsInitialFocus: true,
      returnFocus: options.returnFocus || courseBucketEditor?.returnFocus || { type: "info" }
    };
    renderDelayBucketPanel(courseDelayState);
  });
  return button;
}

async function closeDelayBucketInfoModal(courseDelayState) {
  const previousEditor = courseBucketEditor?.previousEditor || null;
  const focusTarget = courseBucketEditor?.returnFocus || null;

  if (previousEditor) {
    previousEditor.needsInitialFocus = true;
    courseBucketEditor = previousEditor;
    await renderDelayBucketPanel(courseDelayState);
    return;
  }

  courseBucketEditor = null;
  await renderDelayBucketPanel(courseDelayState);
  restoreDelayBucketFocus(focusTarget);
}

function handleDelayBucketModalKeydown(event, courseDelayState, modal) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (courseBucketEditor?.mode === "info") {
      closeDelayBucketInfoModal(courseDelayState);
    } else {
      closeDelayBucketModal(courseDelayState);
    }
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const focusable = getDelayBucketModalFocusableElements(modal);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return;
  }

  if (!modal.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

function getDelayBucketModalFocusableElements(modal) {
  return Array.from(modal.querySelectorAll(
    'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
  )).filter((element) => {
    return !element.disabled && element.offsetParent !== null;
  });
}

function focusInitialDelayBucketModalField(modal) {
  window.setTimeout(() => {
    const preferred = modal.querySelector('input[name="keyword"]')
      || modal.querySelector('input[name="title"]')
      || getDelayBucketModalFocusableElements(modal)[0];
    preferred?.focus();
  }, 0);
}

function restoreDelayBucketFocus(focusTarget) {
  if (!focusTarget) {
    return;
  }

  window.setTimeout(() => {
    const panel = document.getElementById(COURSE_DELAY_BUCKET_PANEL_ID);
    if (!panel) {
      return;
    }

    const target = focusTarget.type === "bucket"
      ? panel.querySelector(`.qdv-bucket-gear[data-bucket-id="${escapeCssIdent(focusTarget.bucketId)}"]`)
      : focusTarget.type === "info"
        ? panel.querySelector('[data-bucket-action="info"]')
      : panel.querySelector('[data-bucket-action="add"]');
    target?.focus();
  }, 0);
}

function createDelayBucketModalHead(courseDelayState, editingBucket, modalTitleId) {
  const head = document.createElement("div");
  head.className = "qdv-bucket-modal-head";

  const title = document.createElement("div");
  title.id = modalTitleId;
  title.className = "qdv-bucket-modal-title";
  title.textContent = editingBucket ? "مدیریت باکت" : "افزودن باکت";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "qdv-bucket-icon-button";
  close.setAttribute("aria-label", "بستن");
  close.appendChild(createBucketIcon("x"));
  close.addEventListener("click", () => closeDelayBucketModal(courseDelayState));

  const actions = document.createElement("div");
  actions.className = "qdv-bucket-modal-head-actions";
  actions.append(
    createDelayBucketInfoButton(courseDelayState, {
      fromEditor: true
    }),
    close
  );

  head.append(title, actions);
  return head;
}

function createDelayBucketForm(editingBucket) {
  const form = document.createElement("form");
  form.className = "qdv-bucket-form";
  form.dataset.bucketId = editingBucket?.id || "";

  const draft = courseBucketEditor?.draft || createDelayBucketDraft(editingBucket);

  form.append(
    createDelayBucketField("کلیدواژه", "keyword", "text", draft.keyword, {
      required: true
    }),
    createDelayBucketField("عنوان اختیاری", "title", "text", draft.title, {
      help: "اگر خالی بماند، کلیدواژه روی کارت نمایش داده می‌شود."
    }),
    createDelayBucketCapacityFields(draft),
    createDelayBucketRoundingField(draft)
  );

  return form;
}

function createDelayBucketCapacityFields(draft) {
  const wrapper = document.createElement("div");
  wrapper.className = "qdv-bucket-capacity";

  const title = document.createElement("div");
  title.className = "qdv-bucket-capacity-title";
  title.textContent = "ظرفیت";

  const fields = document.createElement("div");
  fields.className = "qdv-bucket-capacity-fields";
  fields.append(
    createDelayBucketField("روز", "capacityDays", "number", draft.capacityDays, {
      min: "0"
    }),
    createDelayBucketField("ساعت", "capacityHours", "number", draft.capacityHours, {
      min: "0"
    })
  );

  wrapper.append(
    title,
    fields
  );
  return wrapper;
}

function createDelayBucketField(labelText, name, type, value, attributes = {}) {
  const field = document.createElement("div");
  field.className = "qdv-bucket-field";
  if (type === "text") {
    field.classList.add("is-wide");
  }

  const label = document.createElement("label");
  const inputId = `qdv-bucket-input-${name}`;
  label.setAttribute("for", inputId);
  label.textContent = labelText;

  const input = document.createElement("input");
  input.id = inputId;
  input.name = name;
  input.type = type;
  input.value = value;
  Object.entries(attributes).forEach(([key, attributeValue]) => {
    if (key === "help") {
      return;
    }

    if (attributeValue === true) {
      input.setAttribute(key, "");
    } else {
      input.setAttribute(key, attributeValue);
    }
  });

  field.append(label, input);

  if (attributes.help) {
    const help = document.createElement("span");
    help.className = "qdv-bucket-field-help";
    help.textContent = attributes.help;
    field.appendChild(help);
  }

  return field;
}

function createDelayBucketRoundingField(draft) {
  const field = document.createElement("div");
  field.className = "qdv-bucket-field is-wide qdv-bucket-rounding";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "qdv-bucket-toggle";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "roundingEnabled";
  checkbox.checked = Boolean(draft.roundingEnabled);

  toggleLabel.append(checkbox, document.createTextNode("گرد کردن تاخیر"));

  const select = document.createElement("select");
  select.name = "rounding";

  [
    ["hour", "گرد به ساعت بالاتر"],
    ["day", "گرد به روز بالاتر"]
  ].forEach(([optionValue, text]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = text;
    option.selected = optionValue === draft.rounding;
    select.appendChild(option);
  });

  const selectContainer = document.createElement("div");
  selectContainer.className = "qdv-bucket-field";
  selectContainer.classList.toggle("is-hidden", !checkbox.checked);
  selectContainer.appendChild(select);

  checkbox.addEventListener("change", () => {
    selectContainer.classList.toggle("is-hidden", !checkbox.checked);
  });

  field.append(toggleLabel, selectContainer);
  return field;
}

function createDelayBucketModalActions(courseDelayState, editingBucket, form) {
  const actions = document.createElement("div");
  actions.className = "qdv-bucket-modal-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "qdv-bucket-button";
  save.textContent = editingBucket ? "ذخیره تغییرات" : "ساخت باکت";
  save.addEventListener("click", async () => {
    await saveDelayBucketFromModal(courseDelayState, editingBucket, form);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "qdv-bucket-button is-subtle";
  cancel.textContent = "بستن";
  cancel.addEventListener("click", () => closeDelayBucketModal(courseDelayState));

  actions.append(save, cancel);

  if (editingBucket) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "qdv-bucket-button is-danger";
    deleteButton.append(createBucketIcon("trash"), document.createTextNode("حذف"));
    deleteButton.addEventListener("click", async () => {
      await deleteDelayBucket(courseDelayState.courseId, editingBucket.id);
      await closeDelayBucketModal(courseDelayState, { type: "add" });
    });
    actions.appendChild(deleteButton);
  }

  return actions;
}

async function saveDelayBucketFromModal(courseDelayState, editingBucket, form) {
  const values = getDelayBucketFormValues(form);
  if (!values.keyword) {
    form.querySelector('[name="keyword"]')?.focus();
    return;
  }

  if (!values.capacityHours) {
    form.querySelector('[name="capacityDays"]')?.focus();
    return;
  }

  await saveDelayBucket(courseDelayState.courseId, editingBucket, values);
  const focusTarget = editingBucket
    ? { type: "bucket", bucketId: editingBucket.id }
    : { type: "add" };
  courseBucketEditor = null;
  await renderDelayBucketPanel(courseDelayState);
  restoreDelayBucketFocus(focusTarget);
}

async function closeDelayBucketModal(courseDelayState, overrideFocusTarget = null) {
  const focusTarget = overrideFocusTarget || courseBucketEditor?.returnFocus || null;
  courseBucketEditor = null;
  await renderDelayBucketPanel(courseDelayState);
  restoreDelayBucketFocus(focusTarget);
}

function getDelayBucketFormValues(form) {
  const roundingEnabled = Boolean(form.querySelector('[name="roundingEnabled"]')?.checked);
  const rounding = roundingEnabled
    ? form.querySelector('[name="rounding"]')?.value || "hour"
    : "none";

  return {
    title: normalizeText(form.querySelector('[name="title"]')?.value || ""),
    keyword: normalizeText(form.querySelector('[name="keyword"]')?.value || ""),
    capacityHours: getCapacityHoursFromInputs(form),
    rounding: ["none", "hour", "day"].includes(rounding) ? rounding : "hour"
  };
}

function getCapacityHoursFromInputs(form) {
  const days = parseNonNegativeInteger(form.querySelector('[name="capacityDays"]')?.value);
  const hours = parseNonNegativeInteger(form.querySelector('[name="capacityHours"]')?.value);
  return days * 24 + hours;
}

function parseNonNegativeInteger(value) {
  const normalized = normalizePersianDigits(String(value || ""));
  const number = Number.parseInt(normalized, 10);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

async function saveDelayBucket(courseId, editingBucket, values) {
  await updateDelayBucketState((state) => {
    const courseBuckets = getCourseDelayBucketState(state, courseId);
    const now = Date.now();

    if (editingBucket) {
      const existing = courseBuckets.buckets.find((bucket) => bucket.id === editingBucket.id);
      if (existing) {
        existing.title = values.title;
        existing.keyword = values.keyword;
        existing.capacityHours = values.capacityHours;
        existing.rounding = values.rounding;
        existing.updatedAt = now;
      }
      return state;
    }

    courseBuckets.buckets.push({
      id: createDelayBucketId(),
      title: values.title,
      keyword: values.keyword,
      capacityHours: values.capacityHours,
      rounding: values.rounding,
      order: courseBuckets.buckets.length,
      overrides: {},
      createdAt: now,
      updatedAt: now
    });
    return state;
  });
}

async function deleteDelayBucket(courseId, bucketId) {
  await updateDelayBucketState((state) => {
    const courseBuckets = getCourseDelayBucketState(state, courseId);
    courseBuckets.buckets = courseBuckets.buckets.filter((bucket) => bucket.id !== bucketId);
    courseBuckets.buckets.forEach((bucket, index) => {
      bucket.order = index;
      bucket.updatedAt = Date.now();
    });
    return state;
  });
}

function createDelayBucketCard(courseDelayState, courseBuckets, bucket, membershipCounts) {
  const summary = getDelayBucketSummary(courseDelayState, bucket);
  const overlaps = summary.assignments.filter((assignment) => {
    return (membershipCounts.get(assignment.id) || 0) > 1;
  });
  const hasOverlap = overlaps.length > 0;

  const card = document.createElement("article");
  card.className = "qdv-bucket-card";
  card.classList.toggle("is-over", summary.remainingHours < 0);
  card.classList.toggle("is-warning", hasOverlap && summary.remainingHours >= 0);

  card.append(
    createDelayBucketCardHead(courseDelayState, bucket, summary),
    createDelayBucketProgress(summary),
    createDelayBucketMetrics(summary),
    createDelayBucketNote(summary, overlaps)
  );

  return card;
}

function createDelayBucketCardHead(courseDelayState, bucket, summary) {
  const head = document.createElement("div");
  head.className = "qdv-bucket-card-head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "qdv-bucket-card-title-wrap";

  const name = document.createElement("div");
  name.className = "qdv-bucket-card-name";
  name.textContent = bucket.title || bucket.keyword;

  const capacity = document.createElement("div");
  capacity.className = "qdv-bucket-card-capacity";
  capacity.textContent = `ظرفیت ${formatBucketHours(summary.capacityHours)}`;

  titleWrap.append(name, capacity);

  const actions = document.createElement("div");
  actions.className = "qdv-bucket-card-actions";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "qdv-bucket-gear";
  edit.dataset.bucketId = bucket.id;
  edit.setAttribute("aria-label", "مدیریت باکت");
  edit.title = "مدیریت باکت";
  edit.appendChild(createGearIcon());
  edit.addEventListener("click", () => {
    courseBucketEditor = {
      courseId: courseDelayState.courseId,
      mode: "edit",
      bucketId: bucket.id,
      draft: createDelayBucketDraft(bucket),
      adding: false,
      needsInitialFocus: true,
      returnFocus: { type: "bucket", bucketId: bucket.id }
    };
    renderDelayBucketPanel(courseDelayState);
  });

  actions.append(edit);
  head.append(titleWrap, actions);
  return head;
}

function createGearIcon() {
  return createBucketIcon("gear", 16);
}

function createBucketIcon(name, size = 15) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;

  const icons = {
    gear: [
      ["path", { d: "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" }],
      ["path", { d: "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06A2 2 0 1 1 7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.08A1.7 1.7 0 0 0 15.03 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.97 1.7 1.7 0 0 0 20.96 10H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" }]
    ],
    plus: [
      ["path", { d: "M12 5v14" }],
      ["path", { d: "M5 12h14" }]
    ],
    trash: [
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M8 6V4h8v2" }],
      ["path", { d: "M19 6l-1 14H6L5 6" }],
      ["path", { d: "M10 11v5" }],
      ["path", { d: "M14 11v5" }]
    ],
    x: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }]
    ],
    info: [
      ["path", { d: "M12 17v-6" }],
      ["path", { d: "M12 8h.01" }]
    ]
  };

  (icons[name] || icons.x).forEach(([tagName, attributes]) => {
    const element = document.createElementNS(svgNamespace, tagName);
    Object.entries(attributes).forEach(([attrName, attrValue]) => {
      element.setAttribute(attrName, attrValue);
    });
    svg.appendChild(element);
  });

  return svg;
}

function createDelayBucketProgress(summary) {
  const progress = document.createElement("div");
  progress.className = "qdv-bucket-progress";
  progress.setAttribute("aria-hidden", "true");

  const fill = document.createElement("div");
  fill.className = "qdv-bucket-progress-fill";
  const percent = summary.capacityHours > 0
    ? Math.min(100, Math.max(0, (summary.usedHours / summary.capacityHours) * 100))
    : summary.usedHours > 0
      ? 100
      : 0;
  fill.style.width = `${percent}%`;

  progress.appendChild(fill);
  return progress;
}

function createDelayBucketMetrics(summary) {
  const metrics = document.createElement("div");
  metrics.className = "qdv-bucket-metrics";
  metrics.append(
    createDelayBucketMetric("مصرف‌شده", formatBucketHours(summary.usedHours)),
    createDelayBucketMetric(
      summary.remainingHours < 0 ? "بیش از ظرفیت" : "باقی‌مانده",
      formatBucketHours(Math.abs(summary.remainingHours)),
      summary.remainingHours < 0
    )
  );
  return metrics;
}

function createDelayBucketMetric(label, value, over = false) {
  const metric = document.createElement("div");
  metric.className = "qdv-bucket-metric";

  const labelElement = document.createElement("span");
  labelElement.className = "qdv-bucket-metric-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "qdv-bucket-metric-value";
  valueElement.classList.toggle("is-over", over);
  valueElement.textContent = value;

  metric.append(labelElement, valueElement);
  return metric;
}

function createDelayBucketNote(summary, overlaps) {
  const note = document.createElement("div");
  note.className = "qdv-bucket-note";

  if (summary.failedCount > 0) {
    note.classList.add("has-error");
    note.textContent = "دریافت تاخیر بعضی تمرین‌ها ناموفق بود؛ مجموع ممکن است ناقص باشد.";
    return note;
  }

  if (summary.pendingCount > 0) {
    note.textContent = "در انتظار دریافت تاخیر همه تمرین‌های این باکت.";
    return note;
  }

  if (overlaps.length) {
    note.classList.add("has-warning");
    note.textContent = `${formatPersianNumber(overlaps.length)} تمرین در بیش از یک باکت شمرده می‌شود.`;
    return note;
  }

  return document.createDocumentFragment();
}

function createDelayBucketMemberManager(courseDelayState, courseBuckets, bucket) {
  const section = document.createElement("section");
  section.className = "qdv-bucket-member-section";

  const heading = document.createElement("div");
  heading.className = "qdv-bucket-section-title";
  heading.textContent = "تمرین‌های این باکت";

  const summary = getDelayBucketSummary(courseDelayState, bucket);
  const list = document.createElement("div");
  list.className = "qdv-bucket-assignment-list";

  if (summary.assignments.length) {
    summary.assignments.forEach((assignment) => {
      list.appendChild(createDelayBucketMemberRow(
        courseDelayState,
        bucket,
        assignment,
        summary.chargedHoursByAssignment.get(assignment.id)
      ));
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "qdv-bucket-note";
    empty.textContent = "هنوز تمرینی در این باکت نیست.";
    list.appendChild(empty);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "qdv-bucket-button is-subtle";
  addButton.setAttribute("aria-label", "افزودن تمرین");
  addButton.append(createBucketIcon("plus", 14), document.createTextNode("افزودن تمرین"));
  addButton.addEventListener("click", () => {
    captureDelayBucketEditor();
    courseBucketEditor = {
      ...(courseBucketEditor || {}),
      courseId: courseDelayState.courseId,
      mode: "edit",
      bucketId: bucket.id,
      adding: !courseBucketEditor?.adding
    };
    renderDelayBucketPanel(courseDelayState);
  });

  const top = document.createElement("div");
  top.className = "qdv-bucket-member-head";
  top.appendChild(heading);

  const addButtonRow = document.createElement("div");
  addButtonRow.className = "qdv-bucket-add-button-row";
  addButtonRow.appendChild(addButton);

  section.append(top, list, addButtonRow);

  if (courseBucketEditor?.adding) {
    section.appendChild(createDelayBucketAddList(courseDelayState, bucket));
  }

  return section;
}

function createDelayBucketMemberRow(courseDelayState, bucket, assignment, chargedHours) {
  const row = document.createElement("div");
  row.className = "qdv-bucket-assignment";

  const textContainer = document.createElement("div");

  const name = document.createElement("div");
  name.className = "qdv-bucket-assignment-name";
  name.textContent = assignment.name;

  const meta = document.createElement("div");
  meta.className = "qdv-bucket-assignment-meta";
  meta.textContent = getDelayBucketAssignmentMeta(courseDelayState, assignment, chargedHours);

  textContainer.append(name, meta);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "qdv-bucket-icon-button is-danger";
  remove.setAttribute("aria-label", "حذف از باکت");
  remove.appendChild(createBucketIcon("trash"));
  remove.addEventListener("click", async () => {
    await setDelayBucketAssignmentMembership(courseDelayState.courseId, bucket, assignment, false);
    await renderDelayBucketPanel(courseDelayState);
  });

  row.append(textContainer, remove);
  return row;
}

function createDelayBucketAddList(courseDelayState, bucket) {
  const wrapper = document.createElement("div");
  wrapper.className = "qdv-bucket-add-list";

  const availableAssignments = courseDelayState.assignments.filter((assignment) => {
    return !isAssignmentInDelayBucket(bucket, assignment);
  });

  if (!availableAssignments.length) {
    const empty = document.createElement("div");
    empty.className = "qdv-bucket-note";
    empty.textContent = "تمرین دیگری برای افزودن وجود ندارد.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  availableAssignments.forEach((assignment) => {
    const row = document.createElement("div");
    row.className = "qdv-bucket-pick-row";

    const name = document.createElement("div");
    name.className = "qdv-bucket-assignment-name";
    name.textContent = assignment.name;

    const add = document.createElement("button");
    add.type = "button";
    add.className = "qdv-bucket-icon-button";
    add.setAttribute("aria-label", "افزودن به باکت");
    add.appendChild(createBucketIcon("plus"));
    add.addEventListener("click", async () => {
      await setDelayBucketAssignmentMembership(courseDelayState.courseId, bucket, assignment, true);
      courseBucketEditor = {
        ...(courseBucketEditor || {}),
        adding: false
      };
      await renderDelayBucketPanel(courseDelayState);
    });

    row.append(name, add);
    wrapper.appendChild(row);
  });

  return wrapper;
}

function getDelayBucketAssignmentMeta(courseDelayState, assignment, chargedHours) {
  const status = courseDelayState.statusByAssignment.get(assignment.id);
  const hasKnownDelay = courseDelayState.delaySecondsByAssignment.has(assignment.id);
  if (status === COURSE_DELAY_STATUS.loading || courseDelayState.pendingAssignments.has(assignment.id)) {
    if (hasKnownDelay) {
      return `تاخیر ذخیره‌شده: ${formatBucketHours(chargedHours || 0)}؛ در صف به‌روزرسانی`;
    }

    return "در صف دریافت تاخیر";
  }

  if (status === COURSE_DELAY_STATUS.error) {
    if (hasKnownDelay) {
      return `تاخیر ذخیره‌شده: ${formatBucketHours(chargedHours || 0)}؛ به‌روزرسانی ناموفق`;
    }

    return "دریافت ناموفق";
  }

  if (!hasKnownDelay) {
    return "تاخیر نامشخص";
  }

  return `تاخیر محاسبه‌شده: ${formatBucketHours(chargedHours || 0)}`;
}

async function setDelayBucketAssignmentMembership(courseId, bucket, assignment, included) {
  await updateDelayBucketState((state) => {
    const courseBuckets = getCourseDelayBucketState(state, courseId);
    const target = courseBuckets.buckets.find((item) => item.id === bucket.id);
    if (!target) {
      return state;
    }

    const keywordMatches = doesAssignmentMatchDelayBucketKeyword(target, assignment);
    if (included === keywordMatches) {
      delete target.overrides[assignment.id];
    } else {
      target.overrides[assignment.id] = included ? "include" : "exclude";
    }
    target.updatedAt = Date.now();
    return state;
  });
}

function getDelayBucketSummary(courseDelayState, bucket) {
  const includedAssignments = courseDelayState.assignments.filter((assignment) => {
    return isAssignmentInDelayBucket(bucket, assignment);
  });
  const chargedHoursByAssignment = new Map();
  let usedHours = 0;
  let pendingCount = 0;
  let failedCount = 0;

  includedAssignments.forEach((assignment) => {
    const hasKnownDelay = courseDelayState.delaySecondsByAssignment.has(assignment.id);
    const status = courseDelayState.statusByAssignment.get(assignment.id);

    if (courseDelayState.pendingAssignments.has(assignment.id)) {
      pendingCount += 1;

      if (!hasKnownDelay) {
        chargedHoursByAssignment.set(assignment.id, 0);
        return;
      }
    }

    if (status === COURSE_DELAY_STATUS.error) {
      failedCount += 1;

      if (!hasKnownDelay) {
        chargedHoursByAssignment.set(assignment.id, 0);
        return;
      }
    }

    const delaySeconds = courseDelayState.delaySecondsByAssignment.get(assignment.id) || 0;
    const chargedHours = getDelayBucketChargedHours(delaySeconds, bucket.rounding);
    chargedHoursByAssignment.set(assignment.id, chargedHours);
    usedHours += chargedHours;
  });

  const capacityHours = Math.max(0, Number(bucket.capacityHours) || 0);
  return {
    assignments: includedAssignments,
    chargedHoursByAssignment,
    usedHours,
    capacityHours,
    remainingHours: capacityHours - usedHours,
    pendingCount,
    failedCount
  };
}

function getDelayBucketChargedHours(delaySeconds, rounding) {
  const safeSeconds = Math.max(0, Number(delaySeconds) || 0);
  if (!safeSeconds) {
    return 0;
  }

  if (rounding === "day") {
    return Math.ceil(safeSeconds / 86400) * 24;
  }

  if (rounding === "none") {
    return safeSeconds / 3600;
  }

  return Math.ceil(safeSeconds / 3600);
}

function getDelayBucketMembershipCounts(courseDelayState, courseBuckets) {
  const counts = new Map();

  courseBuckets.buckets.forEach((bucket) => {
    courseDelayState.assignments.forEach((assignment) => {
      if (!isAssignmentInDelayBucket(bucket, assignment)) {
        return;
      }

      counts.set(assignment.id, (counts.get(assignment.id) || 0) + 1);
    });
  });

  return counts;
}

function isAssignmentInDelayBucket(bucket, assignment) {
  const override = bucket.overrides?.[assignment.id];
  if (override === "include") {
    return true;
  }

  if (override === "exclude") {
    return false;
  }

  return doesAssignmentMatchDelayBucketKeyword(bucket, assignment);
}

function doesAssignmentMatchDelayBucketKeyword(bucket, assignment) {
  const keyword = normalizeText(bucket.keyword || "").toLocaleLowerCase("fa-IR");
  if (!keyword) {
    return false;
  }

  return normalizeText(assignment.name || "")
    .toLocaleLowerCase("fa-IR")
    .includes(keyword);
}

function formatBucketHours(hours) {
  return formatRoundedHours(Math.ceil(Math.max(0, Number(hours) || 0)));
}

function findCourseAssignmentsHeading() {
  return Array.from(document.querySelectorAll("h1, h2, h3, h4")).find(
    (heading) => normalizeText(heading.textContent || "").includes("تمرین")
  );
}

function removeExistingCourseUi() {
  if (delayBucketRenderTimer) {
    clearTimeout(delayBucketRenderTimer);
    delayBucketRenderTimer = null;
  }

  document.getElementById(COURSE_TOTAL_ID)?.remove();
  document.getElementById(COURSE_DELAY_BUCKET_PANEL_ID)?.remove();
  document.querySelectorAll(".qdv-course-delay").forEach((element) => element.remove());
  courseBucketEditor = null;
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

  if (isUserTyping()) {
    scheduleCourseFollowControls(1000);
    return;
  }

  const state = await readCourseFollowState();
  const route = window.location.pathname;
  const cardCount = getCourseCardLinks().length;
  const expandedMenuId =
    findExpandedCourseCardMenuButton()?.getAttribute("aria-controls") || "";
  const renderKey = `${route}:${JSON.stringify(state.overrides)}:${cardCount}:${expandedMenuId}`;

  if (renderKey === lastCourseFollowRenderKey) {
    return;
  }
  lastCourseFollowRenderKey = renderKey;

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
    Object.entries(attributes).forEach(([attrName, attrValue]) => {
      element.setAttribute(attrName, attrValue);
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

  if (courseNode) {
    return normalizeCourseMetadata(courseNode);
  }

  return normalizeCourseMetadata({
    id: courseId,
    name: getCourseNameFromCardLink(link)
  });
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
      if (isUserTyping()) {
        return;
      }

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
  lastCourseFollowRenderKey = "";

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
    enrichAssignmentDelayCache();
    return;
  }

  removeExistingUi();
}

async function enrichAssignmentDelayCache() {
  const assignmentId = getAssignmentIdFromUrl();
  if (!assignmentId) {
    return;
  }

  const followState = await readCourseFollowState();
  const mapping = followState.assignments[assignmentId];
  if (!mapping?.courseId) {
    return;
  }

  const courseId = mapping.courseId;
  const pageContext = getPageContext();
  const cache = await readAssignmentDelayCache(courseId, assignmentId);

  if (cache) {
    const ttl = getEffectiveCacheTTL(cache, pageContext);
    if (ttl > 0 && Date.now() - Number(cache.fetchedAt) < ttl) {
      return;
    }
  }

  if (pageContext === "submissions") {
    const delays = Array.from(
      document.querySelectorAll(".humanize_duration.delay[data-duration]")
    )
      .map((el) => Number(el.getAttribute("data-duration")))
      .filter(Number.isFinite);

    if (delays.length) {
      const deadlineData = extractDeadlineData();
      const hardDeadlinePassed = deadlineData
        ? deadlineData.serverNow.date >= deadlineData.hardFinishTime
        : false;

      await writeAssignmentDelayCache(
        courseId,
        { id: assignmentId, name: mapping.assignmentName || assignmentId },
        Math.max(...delays),
        COURSE_DELAY_STATUS.fresh,
        hardDeadlinePassed
      );
      return;
    }
  }

  const assignment = {
    id: assignmentId,
    name: mapping.assignmentName || assignmentId,
    finalUrl: `/course/assignments/${assignmentId}/submissions/final`
  };

  try {
    const result = await fetchAssignmentDelay(assignment);
    recordRateLimitRequest();
    await writeAssignmentDelayCache(
      courseId,
      assignment,
      result.delaySeconds,
      COURSE_DELAY_STATUS.fresh,
      result.hardDeadlinePassed
    );
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn("[Deadline Viewer] assignment delay enrichment failed", error);
    }
  }
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
      runSafely(() => {
        if (!isUserTyping()) {
          boot();
        }
      });
    }, 500);
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
