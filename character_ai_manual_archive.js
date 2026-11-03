/*
 * Character.AI Manual Archive 1.0.0
 * Run as a Chrome DevTools Snippet in your already signed-in chat tab.
 * No dependencies, HTTP requests, credentials, message-menu actions, or timers
 * that advance swipes. Every operation starts with an explicit panel command.
 * See README.md for setup, scope, and limitations.
 */
(function (global) {
  "use strict";

  const SCHEMA = "cai-manual-archive/v1";
  const HEADER = "Character.AI manual archive v1\n";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const uuid = () => global.crypto.randomUUID();
  const fail = (message) => { throw new Error(message); };
  const all = (node, selector) => Array.from(node.querySelectorAll(selector));
  const attr = (node, name) => node?.getAttribute(name) || null;
  const canonicalURL = (href) => { const u = new URL(href); u.hash = ""; return u.href; };

  async function hash(value) {
    const bytes = new TextEncoder().encode(value);
    const result = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // textContent alone joins adjacent paragraphs. This also works for inactive
  // slides whose innerText can be empty because they are hidden by the carousel.
  function plainText(node) {
    const blocks = new Set(["P", "DIV", "SECTION", "BLOCKQUOTE", "PRE", "UL", "OL",
      "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR"]);
    function visit(n) {
      if (n.nodeType === 3) return n.nodeValue || "";
      if (n.nodeType !== 1) return "";
      if (["SCRIPT", "STYLE", "BUTTON"].includes(n.tagName)) return "";
      if (n.tagName === "BR") return "\n";
      if (n.tagName === "IMG") return attr(n, "alt") || "";
      const content = Array.from(n.childNodes).map(visit).join("");
      if (n.tagName === "LI") return "\n• " + content + "\n";
      if (blocks.has(n.tagName)) return "\n\n" + content + "\n\n";
      if (["TD", "TH"].includes(n.tagName)) return content + "\t";
      return content;
    }
    return visit(node).replace(/\r\n?/g, "\n").replace(/\n[ \t]+\n/g, "\n\n")
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  function counterIn(scope) {
    const counters = [];
    for (const n of all(scope, "p, span")) {
      if (n.closest(".prose")) continue;
      const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(n.textContent);
      if (!match) continue;
      const position = Number(match[1]), denominator = Number(match[2]);
      if (position >= 1 && position <= denominator) counters.push({position, denominator});
    }
    // An ambiguous counter is evidence only; never guess a navigation target.
    return counters.length === 1 ? counters[0] : null;
  }

  class Reader {
    constructor(document, location) {
      this.document = document;
      this.location = location;
      this.session = uuid();
      this.ids = new WeakMap();
      this.nextId = 1;
    }
    url() { return canonicalURL(this.location.href); }
    nodeId(node) {
      if (!this.ids.has(node)) this.ids.set(node, this.session + ":node:" + this.nextId++);
      return this.ids.get(node);
    }
    root() {
      const roots = all(this.document, "#chat-messages");
      if (roots.length !== 1) fail("Expected one #chat-messages container. Open a chat and rescan.");
      return roots[0];
    }
    rows() {
      return all(this.root(), '[data-owner="char"]');
    }
    rowId(row) {
      for (const key of ["data-turn-id", "data-message-id"]) {
        if (attr(row, key)) return {key: key + ":" + attr(row, key), method: key};
      }
      return {key: this.nodeId(row), method: "DOM identity; specific to this page session"};
    }
    promptFor(row) {
      const root = this.root();
      const rows = all(root, "[data-owner]");
      const reverse = global.getComputedStyle(root).flexDirection === "column-reverse";
      const step = reverse ? 1 : -1;
      for (let i = rows.indexOf(row) + step; i >= 0 && i < rows.length; i += step) {
        if (attr(rows[i], "data-owner") !== "user") continue;
        const prose = rows[i].querySelector(".prose");
        return {text: prose ? plainText(prose) : "", loaded: !!prose};
      }
      return {text: "", loaded: false};
    }
    variant(element, index, isSlide) {
      const completed = all(element, '[data-testid="completed-message"]');
      const prose = completed.flatMap((n) => all(n, ".prose"));
      const unique = Array.from(new Set(prose));
      const body = unique.length === 1 ? unique[0] : null;
      const text = body ? plainText(body) : "";
      const busy = !!element.querySelector('.ticontainer, [aria-busy="true"], [data-testid="streaming-message"]');
      const counter = isSlide ? counterIn(element) : null;
      const explicitIndex = attr(element, "data-swiper-slide-index");
      const dataIndex = explicitIndex !== null && /^\d+$/.test(explicitIndex) ? Number(explicitIndex) : null;
      const candidateId = attr(element, "data-candidate-id") || attr(element, "data-swipe-id");
      const position = counter?.position ?? (dataIndex !== null ? dataIndex + 1 : null);
      // A DOM slot can be reused by a virtualizing site. Without an absolute
      // identifier, use the element's identity so distinct variants survive.
      const key = candidateId ? "candidate:" + candidateId : position !== null ? "position:" + position :
        isSlide ? "dom-slide:" + this.nodeId(element) : "displayed-response";
      return {
        element, index, key, position, counter, candidateId,
        positionSource: counter ? "UI counter" : dataIndex !== null ? "data-swiper-slide-index" :
          isSlide ? "DOM slot only; absolute swipe number unknown" : "no swipe controls exposed",
        text, html: body?.innerHTML || "", completed: !!body && !!text.trim() && !busy,
        busy, ambiguousBody: unique.length > 1,
      };
    }
    read(row, reference = "") {
      if (!row?.isConnected || !this.root().contains(row)) fail("Selected reply changed or unloaded. Rescan and select it again.");
      const swipers = all(row, ".swiper");
      if (swipers.length > 1) fail("Multiple carousels in this reply; refusing to guess.");
      const carousel = swipers[0] || null;
      const slides = carousel ? all(carousel, ".swiper-slide") : [];
      if (carousel && !slides.length) fail("Carousel has no loaded slides yet. Wait, then rescan.");
      const variants = (slides.length ? slides : [row]).map((n, i) => this.variant(n, i, !!slides.length));
      const active = slides.length ? variants.filter((v) => v.element.classList.contains("swiper-slide-active")) : variants;
      const avatar = row.querySelector('[data-msg-avatar="true"]');
      const identity = this.rowId(row);
      return {
        row, rowKey: identity.key, turnKey: reference.trim() ? "user-reference:" + reference.trim() : identity.key,
        identityMethod: reference.trim() ? "user-supplied turn reference" : identity.method,
        reference: reference.trim(), url: this.url(), character: attr(avatar, "alt") || "Character",
        prompt: this.promptFor(row), carousel, variants,
        active: active.length === 1 ? active[0] : null,
        counters: variants.filter((v) => v.counter).map((v) => v.counter),
      };
    }
  }

  function signature(snapshot) {
    return JSON.stringify([snapshot.url, snapshot.turnKey, snapshot.active?.key,
      snapshot.variants.map((v) => [v.key, v.text, v.html, v.completed, v.counter])]);
  }

  async function stableRead(reader, row, reference = "", timeout = 10000) {
    const url = reader.url();
    const started = Date.now();
    let previous = null, unchangedSince = 0;
    while (Date.now() - started < timeout) {
      if (reader.url() !== url) fail("Chat URL changed. Rescan and open an archive for this chat.");
      const snapshot = reader.read(row, reference);
      const current = signature(snapshot);
      if (current !== previous) { previous = current; unchangedSince = Date.now(); }
      if (Date.now() - unchangedSince >= 650) return snapshot;
      await delay(150);
    }
    fail("Reply is still changing. Wait until generation stops, then save again.");
  }

  // Navigation deliberately never clicks any Character.AI button. In particular,
  // its aria-label="Next" refresh icon may GENERATE a new reply. Only an already
  // completed adjacent slide can be selected through the existing Swiper API.
  function planMove(snapshot, direction) {
    if (direction !== -1 && direction !== 1) fail("Direction must be previous or next.");
    if (!snapshot.carousel) return {allowed: false, reason: "This reply exposes no swipe carousel. Waiting for your next command."};
    if (!snapshot.active?.completed) return {allowed: false, reason: "Current reply is empty, ambiguous, or still generating. Waiting."};
    const target = snapshot.variants[snapshot.active.index + direction];
    if (!target?.completed) return {allowed: false, reason: "No completed adjacent swipe is loaded in that direction. No navigation performed. You can expose an existing swipe manually, then Save current."};
    const swiper = snapshot.carousel.swiper;
    if (!swiper || typeof swiper.slideTo !== "function" || swiper.destroyed) {
      return {allowed: false, reason: "Swiper control is unavailable. Use the page's existing-swipe control yourself, then Save current."};
    }
    if (swiper.params?.loop || swiper.params?.virtual?.enabled || swiper.virtual?.enabled) {
      return {allowed: false, reason: "Looped or virtual carousel: safe DOM-to-swipe mapping is unknown. Navigate existing swipes manually, then Save current."};
    }
    const apiSlides = Array.from(swiper.slides || []);
    if (swiper.animating || swiper.enabled === false || swiper.activeIndex !== snapshot.active.index ||
        apiSlides.length !== snapshot.variants.length || apiSlides[target.index] !== target.element ||
        apiSlides[snapshot.active.index] !== snapshot.active.element) {
      return {allowed: false, reason: "Carousel state is changing or its indices differ. Wait and rescan; no navigation performed."};
    }
    if (direction === 1 && swiper.allowSlideNext === false || direction === -1 && swiper.allowSlidePrev === false) {
      return {allowed: false, reason: "The page has disabled this swipe direction. Waiting for your next command."};
    }
    return {allowed: true, target, swiper, from: snapshot.active, before: signature(snapshot)};
  }

  function readable(record) {
    const begin = "[[CAI-BEGIN " + record.id + "]]";
    const end = "[[CAI-END " + record.id + "]]";
    const metadata = {...record};
    delete metadata.response_text;
    delete metadata.response_html;
    delete metadata.user_prompt;
    let body = "\n" + begin + "\n" + record.kind.toUpperCase() + " — " + record.captured_at + "\n";
    body += "Metadata: " + JSON.stringify(metadata) + "\n";
    if (record.kind === "capture") {
      body += "\nPRECEDING USER MESSAGE" + (record.prompt_loaded ? "" : " (not loaded)") + ":\n" +
        record.user_prompt + "\n\nCHARACTER RESPONSE:\n" + record.response_text + "\n";
    } else {
      body += "\nUser marked capture " + record.capture_id + " as preferred. Other swipes remain archived.\n";
    }
    return body + end + "\n";
  }

  class Archive {
    constructor(jsonHandle, textHandle, url) {
      this.jsonHandle = jsonHandle;
      this.textHandle = textHandle;
      this.url = url;
      this.records = [];
      this.captures = new Map();
      this.textIds = new Set();
      this.sizes = new Map();
      this.failed = false;
    }
    static async open(directory, base, url) {
      if (!/^[\p{L}\p{N}_][\p{L}\p{N}_. -]{0,89}$/u.test(base) || /[. ]$/.test(base) ||
          /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)) {
        fail("Use a simple filename stem such as Lullaby-Love-chat-1 (90 characters maximum).");
      }
      const jsonHandle = await directory.getFileHandle(base + ".jsonl", {create: true});
      const textHandle = await directory.getFileHandle(base + ".txt", {create: true});
      const archive = new Archive(jsonHandle, textHandle, url);
      const jf = await jsonHandle.getFile(), tf = await textHandle.getFile();
      archive.sizes.set(jsonHandle, jf.size);
      archive.sizes.set(textHandle, tf.size);
      const journal = await jf.text(), text = await tf.text();
      if (journal && !journal.endsWith("\n")) fail("Journal has an incomplete last line. Preserving it; choose a new filename stem.");
      if (text && !text.startsWith(HEADER)) fail("Text file is not an archive from this script. Choose a new filename stem.");
      for (const line of journal.split("\n").filter((line) => line.trim())) {
        let r;
        try { r = JSON.parse(line); } catch { fail("Journal contains invalid JSON. Preserving it; choose a new filename stem."); }
        if (r.schema !== SCHEMA || !["capture", "preferred"].includes(r.kind) ||
            !/^[a-f0-9-]{36}$/.test(r.id || "") || r.conversation_url !== url ||
            r.kind === "capture" && (typeof r.capture_key !== "string" || typeof r.response_text !== "string")) {
          fail("Archive format or chat URL does not match. Choose a separate filename stem for this chat.");
        }
        archive.records.push(r);
        if (r.kind === "capture") archive.captures.set(r.capture_key, r);
      }
      if (text && !journal && text !== HEADER) fail("This text archive has no matching journal. Preserve both and choose a new stem.");
      for (const r of archive.records) {
        const begin = text.includes("[[CAI-BEGIN " + r.id + "]]");
        const end = text.includes("[[CAI-END " + r.id + "]]");
        if (begin !== end) fail("Text archive has an incomplete record. Preserving it; choose a new stem.");
        if (begin && end) archive.textIds.add(r.id);
      }
      if (!text) await archive.append(textHandle, HEADER);
      await archive.syncText();
      return archive;
    }
    ensure(url) {
      if (this.failed) fail("An earlier disk write failed. Reopen the archive before continuing.");
      if (url !== this.url) fail("Chat URL changed. Open a separate archive for this chat.");
    }
    async append(handle, contents) {
      if (this.failed) fail("Reopen the archive after the disk error.");
      let stream;
      try {
        const file = await handle.getFile();
        if (file.size !== this.sizes.get(handle)) fail("Archive changed outside this script. Reopen it; no data was overwritten.");
        stream = await handle.createWritable({keepExistingData: true});
        await stream.seek(file.size);
        await stream.write(contents);
        await stream.close();
        this.sizes.set(handle, file.size + new TextEncoder().encode(contents).byteLength);
      } catch (error) {
        this.failed = true;
        try { if (stream) await stream.abort(); } catch { /* preserve original error */ }
        throw error;
      }
    }
    async syncText() {
      for (const r of this.records) {
        if (this.textIds.has(r.id)) continue;
        await this.append(this.textHandle, readable(r));
        this.textIds.add(r.id);
      }
    }
    async record(record) {
      this.ensure(record.conversation_url);
      await this.append(this.jsonHandle, JSON.stringify(record) + "\n");
      this.records.push(record);
      if (record.kind === "capture") this.captures.set(record.capture_key, record);
      await this.syncText();
      return record;
    }
    async capture(snapshot, variant, source) {
      this.ensure(snapshot.url);
      if (!variant?.completed) fail("No unambiguous completed response in this slide; nothing saved.");
      const contentHash = await hash(variant.text);
      const htmlHash = await hash(variant.html);
      const captureKey = await hash(JSON.stringify([snapshot.url, snapshot.turnKey,
        snapshot.prompt.text, variant.key, contentHash, htmlHash]));
      const existing = this.captures.get(captureKey);
      if (existing) { await this.syncText(); return {record: existing, added: false}; }
      const record = {
        schema: SCHEMA, kind: "capture", id: uuid(), capture_key: captureKey,
        captured_at: new Date().toISOString(), conversation_url: snapshot.url,
        character: snapshot.character, turn_key: snapshot.turnKey, identity_method: snapshot.identityMethod,
        turn_reference: snapshot.reference, variant_key: variant.key,
        swipe_position: variant.position, position_source: variant.positionSource,
        dom_slot: variant.index + 1, ui_counter: variant.counter,
        loaded_completed_variants: snapshot.variants.filter((v) => v.completed).length,
        loaded_slide_elements: snapshot.variants.length, observed_ui_counters: snapshot.counters,
        prompt_loaded: snapshot.prompt.loaded, user_prompt: snapshot.prompt.text,
        response_sha256: contentHash, response_text: variant.text, response_html: variant.html,
        capture_source: source,
      };
      await this.record(record);
      return {record, added: true};
    }
    async prefer(snapshot, variant) {
      const capture = await this.capture(snapshot, variant, "mark-preferred");
      return this.record({schema: SCHEMA, kind: "preferred", id: uuid(),
        captured_at: new Date().toISOString(), conversation_url: snapshot.url,
        character: snapshot.character, turn_key: snapshot.turnKey,
        capture_id: capture.record.id, variant_key: variant.key});
    }
  }

  class Controller {
    constructor(document, location) {
      this.document = document;
      this.reader = new Reader(document, location);
      this.archive = null;
      this.selected = null;
      this.references = new Map();
      this.selectedURL = null;
      this.busy = false;
    }
    requireArchive() {
      if (!this.archive) fail("First choose an archive folder and filename stem.");
      this.archive.ensure(this.reader.url());
    }
    selection() {
      if (!this.selected) fail("Rescan and select a loaded character reply.");
      if (this.selectedURL !== this.reader.url()) fail("Chat URL changed. Rescan and open the appropriate archive.");
      return this.selected;
    }
    reference(row = this.selected) {
      return this.references.get(this.reader.rowId(row).key) || "";
    }
    async snapshot(row = this.selection()) {
      return stableRead(this.reader, row, this.reference(row));
    }
    async saveCurrent() {
      this.requireArchive();
      const s = await this.snapshot();
      const result = await this.archive.capture(s, s.active, "save-current");
      return result.added ? "Saved current swipe to both files." : "Current swipe already saved; both files are up to date.";
    }
    async saveVariants() {
      this.requireArchive();
      const s = await this.snapshot();
      let added = 0;
      for (const v of s.variants.filter((v) => v.completed)) {
        if ((await this.archive.capture(s, v, "save-loaded-variants")).added) added++;
      }
      return "Saved " + added + " new variant snapshot(s); inspected " + s.variants.length + " loaded slide(s). No swipe movement.";
    }
    async saveConversation() {
      this.requireArchive();
      const url = this.reader.url(), rows = this.reader.rows();
      let added = 0, skipped = 0;
      // This is a read-and-save batch, never an automatic swipe/navigation loop.
      for (const row of rows) {
        if (this.reader.url() !== url) fail("Chat changed. Batch stopped; completed writes are preserved.");
        if (!row.isConnected) { skipped++; continue; }
        const s = await this.snapshot(row);
        for (const v of s.variants) {
          if (!v.completed) { skipped++; continue; }
          if ((await this.archive.capture(s, v, "save-loaded-conversation")).added) added++;
        }
        this.status("Saving loaded conversation: " + added + " new snapshot(s). Keep this chat open.");
      }
      return "Saved " + added + " new snapshot(s) from " + rows.length + " loaded replies; skipped " + skipped + " empty, busy, or unloaded item(s). Scroll for more history, then Rescan.";
    }
    async move(direction) {
      this.requireArchive();
      const row = this.selection();
      let s = await this.snapshot(row);
      await this.archive.capture(s, s.active, "before-navigation");
      s = await this.snapshot(row);
      const plan = planMove(s, direction);
      if (!plan.allowed) return "Current swipe saved. " + plan.reason;
      // Protect both sides before changing the page; a disk failure stops here.
      await this.archive.capture(s, plan.target, "loaded-target-before-navigation");
      const fresh = this.reader.read(row, this.reference(row));
      const recheck = planMove(fresh, direction);
      if (!recheck.allowed || signature(fresh) !== plan.before || recheck.target.element !== plan.target.element) {
        fail("Reply changed during saving. Captures are preserved; no navigation performed. Try again.");
      }
      plan.swiper.slideTo(plan.target.index, 250, true);
      const started = Date.now();
      while (Date.now() - started < 5000) {
        if (this.reader.url() !== s.url) fail("Chat changed after navigation; both pre-navigation captures are preserved.");
        const next = this.reader.read(row, this.reference(row));
        if (next.active?.element === plan.target.element) {
          const settled = await this.snapshot(row);
          if (settled.active?.element !== plan.target.element) fail("Active swipe changed again. Saved captures are preserved; verify the page and save manually.");
          await this.archive.capture(settled, settled.active, "after-navigation");
          return "Moved one stored swipe " + (direction === -1 ? "backward" : "forward") + " and saved it.";
        }
        await delay(150);
      }
      fail("Page did not confirm the selected swipe. Both loaded variants were saved; check the page before continuing.");
    }
    status(text) { if (this.log) this.log.textContent = text; }
    refreshInfo() {
      if (!this.info) return;
      try {
        const s = this.reader.read(this.selection(), this.reference());
        const count = s.variants.filter((v) => v.completed).length;
        const active = s.active ? s.active.position !== null ? "swipe " + s.active.position :
          "DOM slot " + (s.active.index + 1) + " (absolute swipe number unknown)" : "unknown";
        const counters = s.counters.map((c) => c.position + " / " + c.denominator).join(", ") || "none";
        const saved = this.archive?.records.filter((r) => r.kind === "capture" && r.turn_key === s.turnKey).length || 0;
        this.info.textContent = s.character + "\n" + count + " completed variant(s) loaded; " +
          s.variants.length + " slide element(s).\nActive: " + active + "\nUI counters: " + counters +
          " (denominator may be a limit).\nSaved snapshots for this turn: " + saved +
          (!s.carousel ? "\nThis reply exposes no alternative-swipe controls." : "");
      } catch (error) { this.info.textContent = error.message; }
    }
    scan() {
      const rows = this.reader.rows();
      this.replySelect.replaceChildren();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const option = this.document.createElement("option");
        const s = this.reader.read(row);
        const preview = (s.prompt.text || s.active?.text || "[no loaded text]").replace(/\s+/g, " ").slice(0, 65);
        option.value = String(i);
        option.textContent = "Reply " + (i + 1) + ": " + preview;
        this.replySelect.append(option);
      }
      this.scannedRows = rows;
      const oldIndex = rows.indexOf(this.selected);
      const index = oldIndex >= 0 ? oldIndex : 0;
      this.replySelect.value = String(index);
      this.selectRow(index);
      return rows.length + " character replies currently loaded (DOM order). Select a reply; scroll in the chat and Rescan to load more.";
    }
    selectRow(index) {
      this.selected = this.scannedRows[index] || null;
      this.selectedURL = this.reader.url();
      this.refInput.value = this.selected ? this.reference() : "";
      this.refreshInfo();
    }
    async run(fn) {
      if (this.busy) return;
      this.busy = true;
      for (const n of all(this.shadow, "button, input, select")) n.disabled = true;
      this.status("Working…");
      try { this.status((await fn()) + "\nWaiting for your next command."); }
      catch (error) { this.status("Stopped: " + error.message + "\nWaiting for your next command."); }
      finally {
        this.busy = false;
        for (const n of all(this.shadow, "button, input, select")) n.disabled = false;
        this.refreshInfo();
      }
    }
    mount() {
      const d = this.document;
      this.host = d.createElement("div");
      this.host.id = "cai-manual-archive-panel";
      this.host.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;width:min(390px,95vw);";
      this.shadow = this.host.attachShadow({mode: "open"});
      const css = d.createElement("style");
      css.textContent = ":host{all:initial}*{box-sizing:border-box}section{font:13px/1.45 system-ui,sans-serif;color:#eef3ff;background:#172235;border:1px solid #637596;border-radius:12px;padding:14px;max-height:92vh;overflow:auto;box-shadow:0 8px 36px #0009}h2{margin:0 0 8px;font-size:17px}label{display:block;margin:10px 0 4px}input,select,button{font:inherit;color:#eef3ff;background:#263751;border:1px solid #8192ad;border-radius:5px;padding:7px;width:100%}button{cursor:pointer;margin-top:7px;text-align:left}button:disabled,input:disabled,select:disabled{opacity:.55;cursor:wait}.pair{display:grid;grid-template-columns:1fr 1fr;gap:7px}pre{font:12px/1.45 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;background:#101b2c;border-radius:5px}small{color:#c6d4ec}summary{cursor:pointer;margin-top:10px}";
      this.shadow.append(css);
      const section = d.createElement("section");
      section.setAttribute("aria-label", "Character.AI manual archive controls");
      this.shadow.append(section);
      const heading = d.createElement("h2"); heading.textContent = "Character.AI manual archive"; section.append(heading);
      const note = d.createElement("small");
      note.textContent = "One command at a time. Stored text is saved before swipe movement. No automatic advancing.";
      section.append(note);
      const input = (label, defaultValue) => {
        const l = d.createElement("label"); l.textContent = label;
        const n = d.createElement("input"); n.value = defaultValue; l.append(n); section.append(l); return n;
      };
      this.baseInput = input("Archive filename stem (one per chat)", "character-ai-chat-1");
      const button = (label, fn, parent = section) => {
        const b = d.createElement("button"); b.type = "button"; b.textContent = label;
        b.addEventListener("click", () => this.run(fn)); parent.append(b); return b;
      };
      button("Choose / reopen archive folder", async () => {
        if (typeof global.showDirectoryPicker !== "function") fail("Chrome's local folder picker is unavailable here. Use desktop Chrome on the HTTPS chat page.");
        // Picker must be called immediately within the user's click gesture.
        const directory = await global.showDirectoryPicker({mode: "readwrite", id: "cai-manual-archive"});
        const opened = await Archive.open(directory, this.baseInput.value.trim(), this.reader.url());
        this.archive = opened;
        return "Archive ready: " + opened.textHandle.name + " and " + opened.jsonHandle.name + ". Existing captures were preserved.";
      });
      const label = d.createElement("label"); label.textContent = "Loaded character reply";
      this.replySelect = d.createElement("select"); label.append(this.replySelect); section.append(label);
      this.replySelect.addEventListener("change", () => this.selectRow(Number(this.replySelect.value)));
      this.refInput = input("Optional turn reference for resuming this same reply", "");
      this.refInput.placeholder = "Example: chapter-4-prompt-27";
      this.refInput.addEventListener("change", () => {
        if (this.selected) this.references.set(this.reader.rowId(this.selected).key, this.refInput.value.trim());
        this.refreshInfo();
      });
      const pair = d.createElement("div"); pair.className = "pair"; section.append(pair);
      button("Rescan loaded replies", () => this.scan(), pair);
      button("Show selected reply", () => { this.selection().scrollIntoView({block: "center"}); return "Selected reply brought into view."; }, pair);
      this.info = d.createElement("pre"); section.append(this.info);
      button("Save current swipe", () => this.saveCurrent());
      button("Save all loaded variants of this reply", () => this.saveVariants());
      const nav = d.createElement("div"); nav.className = "pair"; section.append(nav);
      button("← Previous stored swipe", () => this.move(-1), nav);
      button("Next stored swipe →", () => this.move(1), nav);
      button("Mark current as preferred", async () => {
        this.requireArchive(); const s = await this.snapshot();
        await this.archive.prefer(s, s.active);
        return "Preferred choice recorded locally. All archived alternatives are retained.";
      });
      const details = d.createElement("details");
      const summary = d.createElement("summary"); summary.textContent = "More actions / limits"; details.append(summary); section.append(details);
      button("Save entire currently loaded conversation", () => this.saveConversation(), details);
      const limits = d.createElement("p");
      limits.textContent = "Only completed text present in the page can be saved. A counter such as 15 / 100 does not prove 100 stored replies exist. Older alternatives may be hidden by Character.AI. Scroll and rescan for more history. Empty or unknown swipe destinations are never selected.";
      details.append(limits);
      button("Close archive panel", () => {
        this.host.remove();
        if (global.CAIManualArchive === this) delete global.CAIManualArchive;
        return "Panel closed; saved files remain on disk.";
      }, details);
      this.log = d.createElement("pre"); this.log.setAttribute("role", "status"); section.append(this.log);
      for (const event of ["keydown", "keyup", "keypress", "click", "pointerdown", "pointerup", "wheel"]) {
        this.host.addEventListener(event, (e) => e.stopPropagation());
      }
      d.body.append(this.host);
      try { this.status(this.scan() + "\nChoose an archive folder. Waiting for your command."); }
      catch (error) { this.status(error.message + "\nOpen a chat, then Rescan."); }
    }
  }

  const api = {Reader, Archive, Controller, plainText, counterIn, planMove, stableRead, signature, readable, hash};
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // For offline tests; nothing is installed into a page.
  } else {
    if (global.CAIManualArchive?.host?.isConnected) {
      global.CAIManualArchive.status("Archive panel is already running. Waiting for your command.");
      return;
    }
    if (!global.isSecureContext) fail("Run this snippet on the HTTPS Character.AI chat page.");
    if (!/(^|\.)character\.ai$/i.test(global.location.hostname)) fail("Run this snippet only on character.ai.");
    const controller = new Controller(global.document, global.location);
    global.CAIManualArchive = controller;
    controller.mount();
  }
})(globalThis);
