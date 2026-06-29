(function () {
const QDV_COURSE_FOLLOW_STATE_MIRROR_KEY = "qdv-course-follow-state-mirror:v1";
const QDV_DEBUG_KEY = "__qdvCourseFollowFilterDebug";

(function installCourseFollowDataFilter() {
  if (window[QDV_DEBUG_KEY]?.installed) {
    return;
  }

  const debug = {
    installed: true,
    installedAt: Date.now(),
    fetchPatched: false,
    xhrPatched: false,
    nextDataObserverInstalled: false,
    nextDataFilterCount: 0,
    responseFilterCount: 0,
    lastPayloadType: null,
    lastUrl: null,
    lastOriginalDeadlineCount: null,
    lastFilteredDeadlineCount: null,
    lastError: null
  };

  window[QDV_DEBUG_KEY] = debug;

  markDebug(debug);
  patchFetch(debug);
  patchXMLHttpRequest(debug);
  installNextDataFilter(debug);
  markDebug(debug);
})();

function markDebug(debug) {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  root.dataset.qdvCourseFollowFilterInstalled = "true";
  root.dataset.qdvCourseFollowFilterFetchPatched = String(Boolean(debug.fetchPatched));
  root.dataset.qdvCourseFollowFilterXhrPatched = String(Boolean(debug.xhrPatched));
  root.dataset.qdvCourseFollowFilterNextCount = String(debug.nextDataFilterCount || 0);
  root.dataset.qdvCourseFollowFilterResponseCount = String(debug.responseFilterCount || 0);
  root.dataset.qdvCourseFollowFilterLastType = debug.lastPayloadType || "";
}

function createEmptyState() {
  return {
    version: 1,
    courses: {},
    assignments: {},
    overrides: {}
  };
}

function normalizeState(value) {
  const state = createEmptyState();

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

function readMirrorState() {
  try {
    return normalizeState(
      JSON.parse(window.localStorage.getItem(QDV_COURSE_FOLLOW_STATE_MIRROR_KEY) || "null")
    );
  } catch {
    return createEmptyState();
  }
}

function writeMirrorState(state) {
  try {
    window.localStorage.setItem(
      QDV_COURSE_FOLLOW_STATE_MIRROR_KEY,
      JSON.stringify(normalizeState(state))
    );
  } catch {
    // Extension storage remains authoritative if page storage is unavailable.
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCourse(course) {
  if (!course || typeof course !== "object") {
    return null;
  }

  const id = String(course.id || course.pk || course.courseId || "");
  if (!id) {
    return null;
  }

  const archivedValue = course.is_archived ?? course.isArchived;
  const metadata = {
    id,
    name: normalizeText(course.name || course.courseName || ""),
    archivedBy: course.archived_by ?? course.archivedBy ?? null,
    lastSeenAt: Date.now()
  };

  if (typeof archivedValue === "boolean") {
    metadata.isArchived = archivedValue;
  }

  return metadata;
}

function mergeCourses(state, courses) {
  let changed = false;

  (courses || []).forEach((course) => {
    const normalized = normalizeCourse(course);
    if (!normalized) {
      return;
    }

    const previous = state.courses[normalized.id] || {};
    state.courses[normalized.id] = {
      ...previous,
      ...normalized,
      name: normalized.name || previous.name || normalized.id
    };
    changed = true;
  });

  return changed;
}

function mergeAssignments(state, course, assignments) {
  const normalizedCourse = normalizeCourse(course);
  if (!normalizedCourse || !Array.isArray(assignments)) {
    return false;
  }

  let changed = mergeCourses(state, [normalizedCourse]);

  assignments.forEach((assignment) => {
    const assignmentId = String(assignment?.pk || assignment?.id || "");
    if (!assignmentId) {
      return;
    }

    state.assignments[assignmentId] = {
      assignmentId,
      courseId: normalizedCourse.id,
      courseName: normalizedCourse.name,
      assignmentName: normalizeText(assignment.name || ""),
      lastSeenAt: Date.now()
    };
    changed = true;
  });

  return changed;
}

function mergeCourseContainer(state, course) {
  let changed = false;
  const courseNodes = course?.courses?.edges
    ?.map((edge) => edge?.node)
    .filter(Boolean) || [];

  changed = mergeCourses(state, courseNodes) || changed;

  if (course?.id && course?.name) {
    changed = mergeAssignments(state, course, course.assignments) || changed;
  }

  return changed;
}

function isCourseFollowed(state, courseId) {
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

function shouldShowDeadline(deadline, state) {
  const assignmentId = String(deadline?.id || "");
  const mappedCourseId = state.assignments[assignmentId]?.courseId;

  if (mappedCourseId) {
    return isCourseFollowed(state, mappedCourseId);
  }

  const courseName = normalizeText(deadline?.course_name || "");
  if (!courseName) {
    return true;
  }

  const matchingCourses = Object.values(state.courses).filter((course) => {
    return normalizeText(course.name || "") === courseName;
  });

  if (!matchingCourses.length) {
    return true;
  }

  return matchingCourses.some((course) => {
    return isCourseFollowed(state, course.id);
  });
}

function getCourseContainers(rootValue) {
  const containers = [];
  const seen = new Set();

  function visit(value, depth) {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 8) {
      return;
    }

    seen.add(value);

    if (
      Array.isArray(value.course_deadline_widget_data) ||
      value.courses?.edges ||
      value.assignments
    ) {
      containers.push(value);
    }

    if (Array.isArray(value)) {
      value.slice(0, 80).forEach((item) => visit(item, depth + 1));
      return;
    }

    Object.keys(value).slice(0, 80).forEach((key) => {
      visit(value[key], depth + 1);
    });
  }

  visit(rootValue?.props?.pageProps?.course, 0);
  visit(rootValue?.pageProps?.course, 0);
  visit(rootValue, 0);

  return Array.from(new Set(containers));
}

function filterDataPayload(data, debug, payloadType, url) {
  const state = readMirrorState();
  let changed = false;

  getCourseContainers(data).forEach((course) => {
    mergeCourseContainer(state, course);

    if (!Array.isArray(course.course_deadline_widget_data)) {
      return;
    }

    const originalDeadlines = course.course_deadline_widget_data;
    const filteredDeadlines = originalDeadlines.filter((deadline) => {
      return shouldShowDeadline(deadline, state);
    });

    debug.lastOriginalDeadlineCount = originalDeadlines.length;
    debug.lastFilteredDeadlineCount = filteredDeadlines.length;

    if (filteredDeadlines.length !== originalDeadlines.length) {
      course.course_deadline_widget_data = filteredDeadlines;
      changed = true;
    }
  });

  writeMirrorState(state);

  if (changed) {
    debug.lastPayloadType = payloadType;
    debug.lastUrl = url || window.location.href;
    debug.lastError = null;
  }

  return changed;
}

function filterJsonText(text, debug, payloadType, url) {
  if (!text || !text.includes("course_deadline_widget_data")) {
    return { changed: false, text };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    debug.lastError = `json parse failed: ${error?.message || error}`;
    return { changed: false, text };
  }

  const changed = filterDataPayload(data, debug, payloadType, url);
  if (!changed) {
    return { changed: false, text };
  }

  return { changed: true, text: JSON.stringify(data) };
}

function shouldTryResponse(url, contentType) {
  return (
    String(url || "").includes("/_next/data/") ||
    String(contentType || "").includes("application/json")
  );
}

function patchFetch(debug) {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function" || originalFetch.__qdvFiltered) {
    return;
  }

  window.fetch = async function qdvFilteredFetch(...args) {
    const response = await originalFetch.apply(this, args);
    const contentType = response.headers?.get?.("content-type") || "";
    const url = response.url || args[0]?.url || args[0];

    if (!shouldTryResponse(url, contentType)) {
      return response;
    }

    try {
      const text = await response.clone().text();
      const result = filterJsonText(text, debug, "fetch", String(url || ""));

      if (!result.changed) {
        return response;
      }

      debug.responseFilterCount += 1;
      markDebug(debug);
      const headers = new Headers(response.headers);
      headers.delete("content-length");

      return new Response(result.text, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      debug.lastError = `fetch filter failed: ${error?.message || error}`;
      return response;
    }
  };

  window.fetch.__qdvFiltered = true;
  debug.fetchPatched = true;
}

function patchXMLHttpRequest(debug) {
  const xhrPrototype = window.XMLHttpRequest?.prototype;
  if (!xhrPrototype?.open || !xhrPrototype?.send || xhrPrototype.__qdvFiltered) {
    return;
  }

  const originalOpen = xhrPrototype.open;
  const originalSend = xhrPrototype.send;

  xhrPrototype.__qdvFiltered = true;
  xhrPrototype.open = function qdvOpen(method, url, ...args) {
    this.__qdvRequestUrl = String(url || "");
    return originalOpen.call(this, method, url, ...args);
  };

  xhrPrototype.send = function qdvSend(...args) {
    this.addEventListener("readystatechange", function qdvReadystatechange() {
      if (this.readyState !== 4) {
        return;
      }

      const contentType = this.getResponseHeader?.("content-type") || "";
      if (!shouldTryResponse(this.__qdvRequestUrl, contentType)) {
        return;
      }

      try {
        const result = filterJsonText(
          this.responseText || "",
          debug,
          "xhr",
          this.__qdvRequestUrl
        );

        if (!result.changed) {
          return;
        }

        debug.responseFilterCount += 1;
        markDebug(debug);
        Object.defineProperty(this, "responseText", {
          configurable: true,
          get() {
            return result.text;
          }
        });

        if (!this.responseType || this.responseType === "text") {
          Object.defineProperty(this, "response", {
            configurable: true,
            get() {
              return result.text;
            }
          });
        }
      } catch (error) {
        debug.lastError = `xhr filter failed: ${error?.message || error}`;
      }
    }, true);

    return originalSend.apply(this, args);
  };

  debug.xhrPatched = true;
}

function installNextDataFilter(debug) {
  const filterWhenAvailable = () => {
    const script = document.getElementById("__NEXT_DATA__");
    if (!script?.textContent) {
      return;
    }

    const signature = getNextDataSignature(script);
    if (script.dataset.qdvDeadlineFilterSignature === signature) {
      return;
    }

    try {
      const result = filterJsonText(
        script.textContent,
        debug,
        "next-data",
        window.location.href
      );

      if (result.changed) {
        script.textContent = result.text;
        debug.nextDataFilterCount += 1;
        markDebug(debug);
      }

      script.dataset.qdvDeadlineFiltered = "true";
      script.dataset.qdvDeadlineFilterSignature = getNextDataSignature(script);
    } catch (error) {
      debug.lastError = `next data filter failed: ${error?.message || error}`;
    }
  };

  filterWhenAvailable();

  const observeRoot = document.documentElement || document;
  if (!observeRoot || typeof MutationObserver !== "function") {
    return;
  }

  const observer = new MutationObserver(() => {
    filterWhenAvailable();
  });

  observer.observe(observeRoot, {
    childList: true,
    characterData: true,
    subtree: true
  });

  debug.nextDataObserverInstalled = true;
}

function getNextDataSignature(script) {
  const text = script?.textContent || "";
  return `${window.location.pathname}${window.location.search}:${text.length}:${hashText(text)}`;
}

function hashText(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return String(hash);
}
})();
