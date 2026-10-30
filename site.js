document.addEventListener("DOMContentLoaded", () => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));

  const menuButton = document.querySelector(".menu-button");
  const nav = document.querySelector(".nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", () => {
      nav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    });
  }

  document.querySelectorAll(".faq button").forEach((button) => {
    button.addEventListener("click", () => {
      const answer = button.nextElementSibling;
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      button.querySelector("span").textContent = expanded ? "+" : "−";
      answer.hidden = expanded;
    });
  });

  const dayLabel = (day, startDate = "") => {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    if (typeof day === "number") return days[day] || "";
    const text = String(day || "").toUpperCase();
    if (text) return text.length > 3 ? text.slice(0, 3) : text;
    const parsed = new Date(`${startDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? "" : days[parsed.getDay()];
  };

  const dateLabel = (date) => {
    const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(date || "");
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
    }).format(parsed);
  };

  const timeLabel = (time) => {
    if (!time) return "";
    const match = String(time).match(/(\d{1,2}):(\d{2})/);
    if (!match) return String(time);
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours)) return String(time);
    const suffix = hours >= 12 ? "PM" : "AM";
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
  };

  const dayIndex = (day, startDate = "") => {
    if (typeof day === "number") return day;
    const value = String(day || "").trim().toUpperCase();
    const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const index = names.findIndex((name) => value.startsWith(name));
    if (index >= 0) return index;
    const parsed = new Date(`${startDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? -1 : parsed.getDay();
  };

  const locationLabel = (event) =>
    event.locationName ||
    [event.locationCity, event.locationState].filter(Boolean).join(", ") ||
    "The Remnant";

  const addressLabel = (event) =>
    [
      event.locationAddress,
      event.locationAddress2,
      event.locationCity,
      event.locationState,
      event.locationZip,
    ].filter(Boolean).join(", ");

  const directionsUrl = (event) => {
    const coordinates = Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude))
      ? `${Number(event.latitude)},${Number(event.longitude)}`
      : addressLabel(event);
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates)}`;
  };

  async function loadSchedule() {
    const list = document.querySelector("#schedule-list");
    const count = document.querySelector("#schedule-count");
    const next = document.querySelector("#next-workouts");
    if (!list && !next) return;
    if (list) list.innerHTML = '<p class="form-note">Loading the live workout schedule…</p>';
    if (next) next.innerHTML = '<p class="eyebrow">Live from F3 The Remnant</p><h2>Loading workouts…</h2>';
    try {
      const response = await fetch("/api/schedule", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Schedule unavailable");
      const { events = [], openQs = 0 } = await response.json();
      if (!events.length) throw new Error("No active workouts");

      const sortedEvents = [...events].sort((a, b) =>
        String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
        String(a.startTime || "").localeCompare(String(b.startTime || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""))
      );

      if (count) {
        const base = `${events.length} workout${events.length === 1 ? "" : "s"} over the next seven days · Always free`;
        count.textContent = openQs ? `${base} · ${openQs} still need a Q` : base;
      }

      if (list) {
        const grouped = new Map();
        sortedEvents.forEach((event) => {
          const day = dayLabel(event.dayOfWeek, event.startDate);
          const key = `${event.startDate || ""}|${day}`;
          if (!grouped.has(key)) grouped.set(key, { day, date: event.startDate, events: [] });
          grouped.get(key).events.push(event);
        });
        list.innerHTML = [...grouped.values()].map(({ day, date, events: dayEvents }, index) => `
          <section class="schedule-day" aria-labelledby="day-${esc(day.toLowerCase())}-${index}">
            <header class="day-heading">
              <h3 id="day-${esc(day.toLowerCase())}-${index}">${esc(day)} <span class="day-date">${esc(dateLabel(date))}</span></h3>
              <span class="workout-count">${dayEvents.length} workout${dayEvents.length === 1 ? "" : "s"}</span>
            </header>
            <div class="day-workouts">
              ${dayEvents.map((event) => {
                const type = event.eventTypes?.[0]?.eventTypeName || "Workout";
                const address = addressLabel(event);
                return `<article class="workout-row">
                  <time>${esc(timeLabel(event.startTime))}</time>
                  <div class="workout-details">
                    <h4>${esc(event.name)}</h4>
                    <p><strong>${esc(locationLabel(event))}</strong>${address ? `<span>${esc(address)}</span>` : ""}</p>
                    <p class="workout-q${event.q ? "" : " open"}">${event.q ? `Q: <strong>${esc(event.q)}</strong>` : "Q needed — sign up in Slack"}</p>
                    ${event.description ? `<p class="workout-description">${esc(event.description)}</p>` : ""}
                  </div>
                  <span class="workout-type">${esc(type)}</span>
                  <a class="directions-link" href="${esc(directionsUrl(event))}" target="_blank" rel="noopener" aria-label="Get directions to ${esc(event.name)}">Directions <span aria-hidden="true">↗</span></a>
                </article>`;
              }).join("")}
            </div>
          </section>
        `).join("");
      }

      if (next) {
        next.innerHTML = `<p class="eyebrow">Live from F3 The Remnant</p><h2>Next workouts</h2>` + events.slice(0, 3).map((event) => {
          const location = event.locationCity || locationLabel(event);
          return `<a class="next-row" href="/schedule.html"><span class="date-box">${esc(dayLabel(event.dayOfWeek, event.startDate))}</span><span><b>${esc(timeLabel(event.startTime))}</b><small>${esc(event.name)} · ${esc(location)}</small></span><span class="arrow">→</span></a>`;
        }).join("");
      }

    } catch {
      if (list) list.innerHTML = '<p class="form-note error">The live workout schedule is temporarily unavailable. Please check back shortly.</p>';
      if (count) count.textContent = "Schedule temporarily unavailable";
      if (next) next.innerHTML = '<p class="eyebrow">Workout schedule</p><h2>Temporarily unavailable</h2><p>Please check back shortly.</p>';
    }
  }

  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const eventDateParts = (date) => {
    const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return { month: "", day: "", weekday: "" };
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return {
      month: MONTHS[parsed.getUTCMonth()],
      day: String(parsed.getUTCDate()),
      weekday: WEEKDAY_NAMES[parsed.getUTCDay()],
    };
  };

  const tagLabel = (tag) => ({
    csaup: "CSAUP",
    service: "Service",
    convergence: "Convergence",
  }[tag] || tag.charAt(0).toUpperCase() + tag.slice(1));

  const mapsUrl = (location) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`;

  const timeRange = (event) => {
    if (event.allDay) return "All day";
    const start = timeLabel(event.startTime);
    const end = event.endTime ? timeLabel(event.endTime) : "";
    return end && end !== start ? `${start} – ${end}` : start;
  };

  const eventCard = (event, compact) => {
    const { month, day, weekday } = eventDateParts(event.startDate);
    const tags = Array.isArray(event.tags) ? event.tags : [];
    return `<article class="event-card">
      <div class="event-date" aria-hidden="true"><span>${esc(month)}</span><b>${esc(day)}</b></div>
      <div class="event-details">
        <h3>${esc(event.name)}</h3>
        <p class="event-when">${esc(weekday)}, ${esc(dateLabel(event.startDate))} · ${esc(timeRange(event))}</p>
        ${event.location ? `<p class="event-location">${esc(event.location)}</p>` : ""}
        ${!compact && event.description ? `<p class="event-description">${esc(event.description)}</p>` : ""}
      </div>
      <div class="event-meta">
        ${tags.map((tag) => `<span class="event-tag">${esc(tagLabel(tag))}</span>`).join("")}
        ${event.location ? `<a class="directions-link" href="${esc(mapsUrl(event.location))}" target="_blank" rel="noopener" aria-label="Get directions to ${esc(event.name)}">Directions <span aria-hidden="true">↗</span></a>` : ""}
      </div>
    </article>`;
  };

  async function loadEvents() {
    const list = document.querySelector("#event-list");
    const count = document.querySelector("#events-count");
    const upcoming = document.querySelector("#upcoming-events");
    if (!list && !upcoming) return;
    try {
      const response = await fetch("/api/events", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Events unavailable");
      const { events = [] } = await response.json();

      if (count) {
        count.textContent = events.length
          ? `${events.length} upcoming event${events.length === 1 ? "" : "s"} · Always free`
          : "Nothing on the calendar yet";
      }

      // An empty calendar is a valid answer, not a failure. Say so plainly
      // instead of dropping into the error state.
      if (list) {
        list.innerHTML = events.length
          ? events.map((event) => eventCard(event, false)).join("")
          : '<p class="form-note">Nothing on the calendar right now. Check back soon, or ask in Slack what is being planned.</p>';
      }

      if (upcoming) {
        upcoming.innerHTML = events.length
          ? events.slice(0, 3).map((event) => eventCard(event, true)).join("")
          : '<p class="form-note">Nothing on the calendar right now. Check back soon.</p>';
      }
    } catch {
      const message = '<p class="form-note error">The event calendar is temporarily unavailable. Please check back shortly.</p>';
      if (list) list.innerHTML = message;
      if (upcoming) upcoming.innerHTML = message;
      if (count) count.textContent = "Events temporarily unavailable";
    }
  }

  async function loadAos(select, status) {
    try {
      const response = await fetch("/api/aos", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("AO list unavailable");
      const { aos = [] } = await response.json();
      select.innerHTML = '<option value="" selected disabled>Select your AO</option>' +
        aos.map((ao) => `<option value="${Number(ao.id)}" data-name="${esc(ao.name)}">${esc(ao.name)}</option>`).join("");
      select.disabled = false;
    } catch {
      select.innerHTML = '<option value="" selected>Unable to load AOs</option>';
      status.textContent = "The AO list is temporarily unavailable. Please refresh the page.";
      status.classList.add("error");
    }
  }

  const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  const parseDay = (date) => {
    const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  };

  // Moleskin is plain text with the occasional blank line. Escape first, then
  // rebuild paragraphs so a stray tag in a backblast cannot break the page.
  const paragraphs = (text) =>
    String(text || "")
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`)
      .join("");

  const paxLine = (backblast) => {
    const parts = [];
    if (backblast.q) parts.push(`Q: <strong>${esc(backblast.q)}</strong>`);
    if (backblast.coq) parts.push(`Co-Q: <strong>${esc(backblast.coq)}</strong>`);
    return parts.join(" · ");
  };

  const backblastCard = (backblast, compact) => {
    const parsed = parseDay(backblast.startDate);
    const month = parsed ? MONTH_ABBR[parsed.getUTCMonth()] : "";
    const day = parsed ? String(parsed.getUTCDate()) : "";
    const count = Number(backblast.paxCount) || 0;
    const fngs = Number(backblast.fngCount) || 0;
    const showBody = !compact && backblast.body;
    const photos = Array.isArray(backblast.photos) ? backblast.photos : [];
    const photoBlock = photos.length
      ? `<div class="backblast-photos${photos.length === 1 ? " single" : ""}">${photos
          .map(
            (src, index) =>
              `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(
                backblast.title
              )} — photo ${index + 1}" width="800" height="600" loading="lazy" decoding="async"></a>`
          )
          .join("")}</div>`
      : "";
    return `<article class="backblast-card${backblast.source === "archive" ? " archived" : ""}">
      <div class="backblast-date" aria-hidden="true"><span>${esc(month)}</span><b>${esc(day)}</b></div>
      <div class="backblast-body">
        <header>
          <h2>${esc(backblast.title)}</h2>
          <p class="backblast-when">${esc(backblast.ao)}${backblast.startTime ? ` · ${esc(timeLabel(backblast.startTime))}` : ""}${backblast.eventType ? ` · ${esc(backblast.eventType)}` : ""}</p>
        </header>
        ${paxLine(backblast) ? `<p class="backblast-q">${paxLine(backblast)}</p>` : ""}
        ${showBody ? `<div class="backblast-text">${paragraphs(backblast.body)}</div>` : ""}
        ${photoBlock}
        ${!compact && !backblast.body ? `<p class="form-note">The moleskin for this one has not been filled in yet.</p>` : ""}
        <div class="backblast-meta">
          ${count ? `<span><b>${count}</b> PAX</span>` : ""}
          ${fngs ? `<span><b>${fngs}</b> FNG${fngs === 1 ? "" : "s"}</span>` : ""}
          ${backblast.source === "archive"
            ? `<span class="backblast-archived">From the archive</span>${
                backblast.archiveUrl
                  ? `<a href="${esc(backblast.archiveUrl)}" target="_blank" rel="noopener">Original ↗</a>`
                  : ""
              }`
            : ""}
          ${compact ? `<a href="backblasts.html">Read it ↗</a>` : ""}
        </div>
      </div>
    </article>`;
  };

  async function loadBackblasts() {
    const list = document.querySelector("#backblast-list");
    if (!list) return;
    const count = document.querySelector("#backblast-count");
    const more = document.querySelector("#backblast-more");
    const aoSelect = document.querySelector("#backblast-ao");
    let cursor = "";
    let loading = false;

    const setBusy = (busy, label) => {
      loading = busy;
      if (more) {
        more.disabled = busy;
        more.hidden = busy && !label;
        more.textContent = label || "Load older backblasts";
      }
    };

    const fetchPage = async (before) => {
      const params = new URLSearchParams();
      if (before) params.set("before", before);
      if (aoSelect?.value) params.set("ao", aoSelect.value);
      const response = await fetch(`/api/backblasts?${params}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Backblasts unavailable");
      return response.json();
    };

    const render = async (before, append) => {
      if (loading) return;
      setBusy(true, append ? "Loading…" : "");
      if (!append) list.innerHTML = '<p class="form-note">Loading the backblast library…</p>';
      try {
        const { backblasts = [], nextBefore = "", hasMore = false } = await fetchPage(before);
        const html = backblasts.map((backblast) => backblastCard(backblast)).join("");

        if (append) {
          list.insertAdjacentHTML(
            "beforeend",
            html || '<p class="form-note">No backblasts in that stretch. Try again to keep going back.</p>'
          );
        } else if (html) {
          list.innerHTML = html;
        } else {
          list.innerHTML = '<p class="form-note">No backblasts here yet. Post one in Slack after your next Q and it will show up.</p>';
        }

        if (count) {
          const shown = list.querySelectorAll(".backblast-card").length;
          count.textContent = shown
            ? `${shown} backblast${shown === 1 ? "" : "s"}${aoSelect?.value ? ` at ${aoSelect.options[aoSelect.selectedIndex]?.textContent || "this AO"}` : ""} · newest first`
            : "No backblasts yet";
        }

        cursor = nextBefore;
        setBusy(false);
        if (more) {
          more.hidden = !hasMore;
          more.textContent = "Load older backblasts";
        }
      } catch {
        setBusy(false);
        if (!append) {
          list.innerHTML = '<p class="form-note error">The backblast library is temporarily unavailable. Please check back shortly.</p>';
          if (count) count.textContent = "Backblasts temporarily unavailable";
        } else if (more) {
          more.textContent = "Could not load more — try again";
          more.hidden = false;
        }
      }
    };

    const fillAos = async () => {
      if (!aoSelect) return;
      try {
        const response = await fetch("/api/aos", { headers: { accept: "application/json" } });
        if (!response.ok) return;
        const { aos = [] } = await response.json();
        if (!aos.length) return;
        aoSelect.innerHTML = '<option value="">All AOs</option>' +
          aos.map((ao) => `<option value="${Number(ao.id)}">${esc(ao.name)}</option>`).join("");
      } catch {
        // The AO filter is a convenience; the library works without it.
      }
    };

    await fillAos();
    await render("", false);

    aoSelect?.addEventListener("change", () => render("", false));
    more?.addEventListener("click", () => render(cursor, true));
  }

  async function loadBackblastTeaser() {
    const list = document.querySelector("#backblast-teaser");
    if (!list) return;
    try {
      const response = await fetch("/api/backblasts?limit=3", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Backblasts unavailable");
      const { backblasts = [] } = await response.json();
      list.innerHTML = backblasts.length
        ? backblasts.map((backblast) => backblastCard(backblast, true)).join("")
        : '<p class="form-note">The library fills up as Qs post. <a class="inline-link" href="backblasts.html">See the library →</a></p>';
    } catch {
      list.innerHTML = '<p class="form-note">The latest backblasts are temporarily unavailable.</p>';
    }
  }

  const form = document.querySelector("#fng-form");
  const success = document.querySelector("#fng-success");
  const submitAnother = document.querySelector("#submit-another");
  const aoSelect = document.querySelector("#ao-select");
  const formStatus = document.querySelector("#form-status");
  if (form && success && aoSelect && formStatus) {
    loadAos(aoSelect, formStatus);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const data = new FormData(form);
      const option = aoSelect.options[aoSelect.selectedIndex];
      const payload = Object.fromEntries(data.entries());
      payload.aoId = Number(payload.aoId);
      payload.aoName = option?.dataset?.name || option?.textContent || "";
      button.disabled = true;
      button.textContent = "Submitting…";
      formStatus.classList.remove("error");
      formStatus.textContent = "Sending your Slack invitation…";
      try {
        const response = await fetch("/api/fng", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Submission failed");
        form.hidden = true;
        success.hidden = false;
      } catch (error) {
        formStatus.textContent = error.message || "We could not submit your information. Please try again.";
        formStatus.classList.add("error");
      } finally {
        button.disabled = false;
        button.textContent = "Submit →";
      }
    });
    submitAnother?.addEventListener("click", () => {
      form.reset();
      success.hidden = true;
      form.hidden = false;
      formStatus.classList.remove("error");
      formStatus.textContent = "We’ll email your invitation to the F3 The Remnant Slack workspace.";
    });
  }

  loadSchedule();
  loadEvents();
  loadBackblasts();
  loadBackblastTeaser();
});
