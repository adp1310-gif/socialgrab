/* SocialGrab panel UI. */
(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };
    var cep = window.__adobe_cep__;

    var PLATFORMS = [
        { id: "youtube", name: "YouTube", re: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i },
        { id: "instagram", name: "Instagram", re: /(^|\.)instagram\.com$/i },
        { id: "linkedin", name: "LinkedIn", re: /(^|\.)(linkedin\.com|lnkd\.in)$/i },
        { id: "pinterest", name: "Pinterest", re: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/i },
        { id: "twitter", name: "X / Twitter", re: /(^|\.)(twitter\.com|x\.com|t\.co)$/i }
    ];

    /* ---------- Settings ---------- */

    var SETTINGS_KEY = "socialgrab.settings";
    var settings = { quality: "max", saveMode: "project", customDir: "", binName: "Social Downloads", cookies: "none" };
    try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) { /* defaults */ }
    function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

    /* ---------- Host bridge ---------- */

    var hostName = "PPRO";
    try { hostName = JSON.parse(cep.getHostEnvironment()).appName; } catch (e) { /* default */ }

    function evalHost(code) {
        return new Promise(function (resolve) { cep.evalScript(code, function (r) { resolve(r); }); });
    }

    function resolveDownloadDir() {
        if (settings.saveMode === "custom" && settings.customDir) return Promise.resolve(settings.customDir);
        return evalHost("sg_projectDir()").then(function (dir) {
            if (dir && dir !== "undefined" && dir.indexOf("EvalScript error") === -1) return Engine.joinPath(dir, "Social Downloads");
            return Engine.defaultDownloadDir();
        });
    }

    function importIntoProject(file) {
        var bin = (settings.binName || "").trim();
        return evalHost("sg_import(" + JSON.stringify(file) + "," + JSON.stringify(bin) + ")").then(function (r) {
            if (r !== "OK") throw new Error(String(r || "Import failed").replace(/^ERR:/, ""));
        });
    }

    /* ---------- URL parsing ---------- */

    function platformOf(url) {
        var host = "";
        try { host = new URL(url).hostname; } catch (e) { return null; }
        for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].re.test(host)) return PLATFORMS[i];
        return null;
    }

    function extractUrls(text) {
        var tokens = String(text).split(/[\s,]+/), out = [];
        tokens.forEach(function (t) {
            t = t.trim().replace(/^[<("']+|[>)"'.,]+$/g, "");
            if (!t) return;
            if (!/^https?:\/\//i.test(t) && /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(t)) t = "https://" + t;
            try { new URL(t); } catch (e) { return; }
            if (/^https?:/i.test(t) && out.indexOf(t) === -1) out.push(t);
        });
        return out;
    }

    function renderDetected() {
        var urls = extractUrls($("urls").value), box = $("detected");
        box.innerHTML = "";
        urls.forEach(function (u) {
            var p = platformOf(u), el = document.createElement("span");
            el.className = "chip " + (p ? p.id : "");
            el.textContent = p ? p.name : "Other site";
            box.appendChild(el);
        });
    }

    /* ---------- Jobs ---------- */

    var queue = [], running = null;

    function addJobs(urls) {
        urls.forEach(function (url) {
            var job = { url: url, platform: platformOf(url), state: "queued", files: [], handle: null };
            job.el = buildJobEl(job);
            $("jobs").insertBefore(job.el.root, $("jobs").firstChild);
            queue.push(job);
        });
        $("empty").classList.add("hidden");
        pump();
    }

    function buildJobEl(job) {
        var root = document.createElement("div");
        root.className = "job queued";
        root.innerHTML =
            '<div class="job-top"><span class="chip"></span><div class="job-title"></div></div>' +
            '<div class="bar"><i></i></div>' +
            '<div class="job-status"><span class="msg">Waiting…</span><span class="meta"></span></div>' +
            '<div class="hint hidden"></div>' +
            '<div class="job-actions"></div>';
        var chip = root.querySelector(".chip");
        chip.className = "chip " + (job.platform ? job.platform.id : "");
        chip.textContent = job.platform ? job.platform.name : "Link";
        root.querySelector(".job-title").textContent = job.url;
        root.querySelector(".job-title").title = job.url;
        var el = {
            root: root,
            title: root.querySelector(".job-title"),
            bar: root.querySelector(".bar > i"),
            msg: root.querySelector(".msg"),
            meta: root.querySelector(".meta"),
            hint: root.querySelector(".hint"),
            actions: root.querySelector(".job-actions")
        };
        setActions(job, el);
        return el;
    }

    function button(label, onClick, cls) {
        var b = document.createElement("button");
        b.className = "small " + (cls || "ghost");
        b.textContent = label;
        b.addEventListener("click", onClick);
        return b;
    }

    function setActions(job, el) {
        el = el || job.el;
        el.actions.innerHTML = "";
        if (job.state === "queued" || job.state === "running") {
            el.actions.appendChild(button("Cancel", function () { cancelJob(job); }));
        } else {
            if (job.files.length) el.actions.appendChild(button(Engine.IS_WIN ? "Show in Explorer" : "Show in Finder", function () { Engine.reveal(job.files[0]); }));
            if (job.state === "error") el.actions.appendChild(button("Retry", function () { retryJob(job); }));
            el.actions.appendChild(button("✕", function () { removeJob(job); }));
        }
    }

    function setState(job, state, msg) {
        job.state = state;
        job.el.root.className = "job " + state;
        if (msg != null) job.el.msg.textContent = msg;
        if (state !== "running") job.el.meta.textContent = "";
        setActions(job);
    }

    function cancelJob(job) {
        if (job.state === "queued") {
            queue.splice(queue.indexOf(job), 1);
            setState(job, "error", "Cancelled");
        } else if (job.handle) {
            job.handle.cancel();
        }
    }

    function retryJob(job) {
        job.files = [];
        job.el.hint.classList.add("hidden");
        job.el.bar.style.width = "0";
        setState(job, "queued", "Waiting…");
        queue.push(job);
        pump();
    }

    function removeJob(job) {
        job.el.root.remove();
        if (!$("jobs").querySelector(".job")) $("empty").classList.remove("hidden");
    }

    function pump() {
        if (running || !queue.length) return;
        var job = queue.shift();
        running = job;
        runJob(job).then(function () { running = null; pump(); });
    }

    function runJob(job) {
        setState(job, "running", "Starting…");
        var el = job.el;
        return resolveDownloadDir().then(function (dir) {
            job.handle = Engine.download(
                { url: job.url, dir: dir, mode: settings.quality, cookies: settings.cookies },
                {
                    onTitle: function (t) { el.title.textContent = t; el.title.title = t + "\n" + job.url; },
                    onStage: function (s) { el.msg.textContent = s; el.bar.style.width = "0"; },
                    onProgress: function (pct, speed, eta) {
                        el.bar.style.width = pct.toFixed(1) + "%";
                        el.meta.textContent = pct.toFixed(0) + "%" + (speed && speed !== "Unknown B/s" ? " · " + speed : "") +
                            (eta && eta !== "Unknown" && eta !== "NA" ? " · " + eta : "");
                    }
                });
            return job.handle.promise;
        }).then(function (files) {
            job.files = files;
            job.el.msg.textContent = "Adding to project…";
            return files.reduce(function (p, f) { return p.then(function () { return importIntoProject(f); }); }, Promise.resolve());
        }).then(function () {
            var names = job.files.map(function (f) { return Engine.basename(f); });
            setState(job, "done", (hostName === "AEFT" ? "Imported: " : "Added to project: ") + names.join(", "));
            job.el.msg.title = job.files.join("\n");
        }).catch(function (err) {
            var msg = (err && err.message) || String(err);
            setState(job, "error", msg);
            var hint = hintFor(msg, job);
            if (hint) { job.el.hint.textContent = hint; job.el.hint.classList.remove("hidden"); }
        });
    }

    function hintFor(msg, job) {
        if (/Cancelled/.test(msg)) return "";
        if (/not a bot|log ?in|sign ?in|cookies|private|authenticat|rate.?limit|empty media response|restricted/i.test(msg))
            return "This post may need you to be logged in. Open Settings, choose the browser you're logged in with under “Use login cookies”, then click Retry.";
        if (/No video (formats|was found)|no video/i.test(msg))
            return job.platform && job.platform.id === "pinterest" ? "This pin looks like an image, not a video." : "No video was found in this post.";
        if (/Unsupported URL/i.test(msg)) return "This link isn't a supported video page. Check that it points to a specific post or video.";
        if (/403|nsig|signature|player response|Precondition|Unable to extract|reloaded/i.test(msg))
            return "The site may have changed. Click “Update yt-dlp” (or “Install tools”) at the bottom of the panel, then click Retry.";
        if (/Requested format is not available/i.test(msg)) return "Try the “Fast” quality option.";
        if (/No project is open/i.test(msg)) return "Open or create a project first. The file is already saved on disk.";
        return "";
    }

    /* ---------- Tools footer ---------- */

    function refreshTools(force) {
        return Engine.detectTools(force).then(function (t) {
            var parts = [];
            parts.push(t.ytdlp ? "yt-dlp <b>" + (t.ytdlpVersion || "?") + "</b>" + (t.managed ? "" : " (system)") : '<span class="bad">yt-dlp missing</span>');
            parts.push(t.ffmpeg ? "ffmpeg <b>✓</b>" : '<span class="bad">ffmpeg missing</span>');
            $("toolStatus").innerHTML = parts.join(" · ");
            $("toolStatus").title = [t.ytdlp, t.ffmpeg, t.jsRuntimeArg ? "JS runtime: " + t.jsRuntimeArg : ""].filter(Boolean).join("\n");
            var missing = !t.managed || !t.ffmpeg || !t.ffprobe || !(t.node || t.deno);
            $("installBtn").textContent = missing ? "Install tools" : "Update yt-dlp";
            $("installBtn").title = missing
                ? "Download what SocialGrab needs (yt-dlp" + (Engine.IS_WIN ? ", ffmpeg" : "") + ", and a JS runtime for YouTube if needed) into " + Engine.BIN_DIR
                : "Update SocialGrab's copy of yt-dlp to the newest version";
        });
    }

    /* ---------- Wire up ---------- */

    function init() {
        $("host").textContent = hostName === "AEFT" ? "After Effects" : hostName === "PPRO" ? "Premiere Pro" : hostName;

        $("quality").value = settings.quality;
        $("saveMode").value = settings.saveMode;
        $("customDir").value = settings.customDir;
        $("binName").value = settings.binName;
        $("cookies").value = settings.cookies;
        $("customRow").classList.toggle("hidden", settings.saveMode !== "custom");

        $("quality").addEventListener("change", function () { settings.quality = this.value; saveSettings(); });
        $("cookies").addEventListener("change", function () { settings.cookies = this.value; saveSettings(); });
        $("binName").addEventListener("input", function () { settings.binName = this.value; saveSettings(); });
        $("saveMode").addEventListener("change", function () {
            settings.saveMode = this.value; saveSettings();
            $("customRow").classList.toggle("hidden", settings.saveMode !== "custom");
            if (settings.saveMode === "custom" && !settings.customDir) chooseDir();
        });
        $("chooseDir").addEventListener("click", chooseDir);

        $("urls").addEventListener("input", renderDetected);
        $("urls").addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        });
        $("paste").addEventListener("click", function () {
            Engine.readClipboard().then(function (text) {
                text = (text || "").trim();
                if (!text) return;
                var cur = $("urls").value.trim();
                $("urls").value = cur ? cur + "\n" + text : text;
                renderDetected();
                $("urls").focus();
            });
        });
        $("go").addEventListener("click", submit);

        $("installBtn").addEventListener("click", function () {
            var btn = this;
            btn.disabled = true;
            Engine.installTools(function (s) { $("toolStatus").textContent = s; })
                .then(function () { return refreshTools(true); })
                .catch(function (e) { $("toolStatus").innerHTML = '<span class="bad">' + escapeHtml(e.message) + "</span>"; })
                .then(function () { btn.disabled = false; });
        });

        refreshTools();
    }

    function chooseDir() {
        var res = window.cep.fs.showOpenDialogEx(false, true, "Choose where downloads are saved", settings.customDir || Engine.defaultDownloadDir());
        if (res && res.data && res.data.length) {
            settings.customDir = res.data[0];
            $("customDir").value = settings.customDir;
            saveSettings();
        } else if (!settings.customDir) {
            settings.saveMode = "project";
            $("saveMode").value = "project";
            $("customRow").classList.add("hidden");
            saveSettings();
        }
    }

    function submit() {
        var urls = extractUrls($("urls").value);
        if (!urls.length) { $("urls").focus(); return; }
        $("urls").value = "";
        renderDetected();
        addJobs(urls);
    }

    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

    init();
})();
