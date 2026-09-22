/* SocialGrab engine — finds yt-dlp / ffmpeg, downloads, and makes files edit-friendly.
   Runs in the CEP panel with Node.js enabled (mixed context). */
(function (global) {
    "use strict";

    var cp = require("child_process");
    var fs = require("fs");
    var path = require("path");
    var os = require("os");
    var https = require("https");

    var IS_WIN = process.platform === "win32";
    var IS_MAC = process.platform === "darwin";
    var HOME = os.homedir();
    var APP_DIR = IS_WIN
        ? path.join(process.env.APPDATA || HOME, "SocialGrab")
        : path.join(HOME, "Library", "Application Support", "SocialGrab");
    var BIN_DIR = path.join(APP_DIR, "bin");

    // Codecs Premiere Pro / After Effects import natively.
    var EDITABLE_VIDEO = ["h264", "hevc", "prores", "mpeg4", "mjpeg", "dnxhd"];
    var EDITABLE_AUDIO = ["aac", "mp3", "alac", "ac3", "eac3", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le"];

    function exe(name) { return IS_WIN ? name + ".exe" : name; }

    function searchDirs() {
        var dirs = [BIN_DIR];
        if (IS_WIN) {
            var local = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
            dirs.push(path.join(local, "Microsoft", "WinGet", "Links"), path.join(HOME, "scoop", "shims"),
                "C:\\ProgramData\\chocolatey\\bin", "C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin",
                path.join(HOME, ".deno", "bin"), "C:\\Program Files\\nodejs");
        } else {
            dirs.push(path.join(HOME, "bin"), path.join(HOME, ".local", "bin"), path.join(HOME, ".deno", "bin"),
                "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
            try {
                var py = path.join(HOME, "Library", "Python");
                fs.readdirSync(py).sort().reverse().forEach(function (v) { dirs.push(path.join(py, v, "bin")); });
            } catch (e) { /* none */ }
        }
        return dirs;
    }

    function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

    function which(name) {
        var dirs = searchDirs();
        for (var i = 0; i < dirs.length; i++) {
            var p = path.join(dirs[i], exe(name));
            if (isFile(p)) return p;
        }
        try {
            var out = IS_WIN
                ? cp.execFileSync("where", [name], { timeout: 5000, windowsHide: true }).toString().split(/\r?\n/)[0]
                : cp.execFileSync("/bin/zsh", ["-lc", "command -v " + name], { timeout: 5000 }).toString().trim();
            if (out && isFile(out.trim())) return out.trim();
        } catch (e) { /* not found */ }
        return null;
    }

    function childEnv() {
        var env = Object.assign({}, process.env);
        env.PATH = searchDirs().join(path.delimiter) + path.delimiter + (env.PATH || "");
        env.NO_COLOR = "1";
        env.PYTHONWARNINGS = "ignore";
        env.PYTHONIOENCODING = "utf-8";
        return env;
    }

    function run(bin, args, timeout) {
        return new Promise(function (resolve) {
            cp.execFile(bin, args, { env: childEnv(), timeout: timeout || 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
                function (err, stdout, stderr) {
                    resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
                });
        });
    }

    /* ---------------- Tool discovery ---------------- */

    var toolsCache = null;

    function detectTools(force) {
        if (toolsCache && !force) return Promise.resolve(toolsCache);
        var t = {
            ytdlp: which("yt-dlp"),
            ffmpeg: which("ffmpeg"),
            ffprobe: which("ffprobe"),
            node: which("node"),
            deno: which("deno"),
            managed: isFile(path.join(BIN_DIR, exe("yt-dlp"))),
            ytdlpVersion: null,
            jsRuntimeArg: null
        };
        if (!t.ytdlp) { toolsCache = t; return Promise.resolve(t); }
        return run(t.ytdlp, ["--version"]).then(function (r) {
            t.ytdlpVersion = (r.stdout.trim().split(/\r?\n/).pop() || "").trim() || null;
            return run(t.ytdlp, ["--help"]);
        }).then(function (r) {
            // Newer yt-dlp needs a JS runtime for YouTube. Deno is used automatically; Node must be opted in.
            if (r.stdout.indexOf("--js-runtimes") !== -1) {
                if (t.deno) t.jsRuntimeArg = "deno:" + t.deno;
                else if (t.node) t.jsRuntimeArg = "node:" + t.node;
            }
            toolsCache = t;
            return t;
        });
    }

    /* Install whatever is missing into SocialGrab's own bin folder (and self-update yt-dlp):
       - yt-dlp: standalone build from GitHub
       - ffmpeg + ffprobe: Windows only (yt-dlp's FFmpeg builds); on macOS use Homebrew
       - deno: JS runtime YouTube needs, only if neither Node.js nor Deno is present */
    function installTools(onStatus) {
        var status = onStatus || function () {};
        fs.mkdirSync(BIN_DIR, { recursive: true });
        return installYtDlp(status)
            .then(function () { return detectTools(true); })
            .then(function (t) {
                if (t.ffmpeg && t.ffprobe) return t;
                if (!IS_WIN) throw new Error("ffmpeg is missing. Install it with Homebrew: brew install ffmpeg");
                return installZipTool("ffmpeg",
                    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
                    ["ffmpeg", "ffprobe"], status).then(function () { return detectTools(true); });
            })
            .then(function (t) {
                if (t.node || t.deno) return t;
                var asset = IS_WIN ? "deno-x86_64-pc-windows-msvc.zip"
                    : IS_MAC ? (process.arch === "arm64" ? "deno-aarch64-apple-darwin.zip" : "deno-x86_64-apple-darwin.zip")
                    : "deno-x86_64-unknown-linux-gnu.zip";
                return installZipTool("Deno (for YouTube)",
                    "https://github.com/denoland/deno/releases/latest/download/" + asset,
                    ["deno"], status).then(function () { return detectTools(true); });
            });
    }

    function installYtDlp(status) {
        var target = path.join(BIN_DIR, exe("yt-dlp"));
        if (isFile(target)) {
            status("Updating yt-dlp…");
            return run(target, ["-U"], 180000).then(function (r) {
                if (r.code !== 0) throw new Error(lastError(r.stderr + r.stdout) || "yt-dlp update failed");
            });
        }
        var asset = IS_WIN ? "yt-dlp.exe" : IS_MAC ? "yt-dlp_macos" : "yt-dlp_linux";
        var tmp = target + ".part";
        return fetchToFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + asset, tmp,
            progressReporter("yt-dlp", status)).then(function () {
            fs.chmodSync(tmp, 493); // 0755
            fs.renameSync(tmp, target);
        });
    }

    /* Download a zip, extract it, and copy the named executables into BIN_DIR. */
    function installZipTool(label, url, names, status) {
        var work = path.join(APP_DIR, "tmp-" + Date.now());
        var zip = path.join(work, "download.zip");
        fs.mkdirSync(work, { recursive: true });
        return fetchToFile(url, zip, progressReporter(label, status))
            .then(function () { status("Unpacking " + label + "…"); return extractZip(zip, work); })
            .then(function () {
                names.forEach(function (n) {
                    var found = findFile(work, exe(n));
                    if (!found) throw new Error("Couldn't find " + exe(n) + " in the " + label + " download.");
                    var dest = path.join(BIN_DIR, exe(n));
                    fs.copyFileSync(found, dest);
                    fs.chmodSync(dest, 493);
                });
            })
            .then(function () { removeDir(work); }, function (e) { removeDir(work); throw e; });
    }

    function extractZip(zip, dir) {
        if (!IS_WIN) {
            return run("/usr/bin/unzip", ["-o", "-q", zip, "-d", dir], 600000).then(function (r) {
                if (r.code !== 0) throw new Error("Unzip failed: " + r.stderr);
            });
        }
        // tar.exe ships with Windows 10+; PowerShell is the fallback.
        var tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
        return run(tar, ["-xf", zip, "-C", dir], 600000).then(function (r) {
            if (r.code === 0) return;
            return run("powershell", ["-NoProfile", "-Command",
                "Expand-Archive -LiteralPath '" + zip.replace(/'/g, "''") + "' -DestinationPath '" + dir.replace(/'/g, "''") + "' -Force"],
                600000).then(function (r2) { if (r2.code !== 0) throw new Error("Unzip failed: " + r2.stderr); });
        });
    }

    function findFile(dir, name) {
        var entries = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
            var p = path.join(dir, entries[i].name);
            if (entries[i].isFile() && entries[i].name.toLowerCase() === name.toLowerCase()) return p;
            if (entries[i].isDirectory()) { var f = findFile(p, name); if (f) return f; }
        }
        return null;
    }

    function removeDir(dir) {
        try { (fs.rmSync || fs.rmdirSync)(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }

    function progressReporter(label, status) {
        return function (done, total) {
            var mb = (done / 1048576).toFixed(0);
            status("Downloading " + label + "… " + (total ? Math.floor(done / total * 100) + "%" : mb + " MB"));
        };
    }

    function fetchToFile(url, dest, onProgress, redirectsLeft) {
        if (redirectsLeft == null) redirectsLeft = 8;
        return new Promise(function (resolve, reject) {
            https.get(url, { headers: { "User-Agent": "SocialGrab" } }, function (res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
                    return resolve(fetchToFile(res.headers.location, dest, onProgress, redirectsLeft - 1));
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error("Download failed (HTTP " + res.statusCode + ")")); }
                var total = parseInt(res.headers["content-length"], 10) || 0, done = 0, lastTick = 0;
                var out = fs.createWriteStream(dest);
                res.on("data", function (c) {
                    done += c.length;
                    var now = Date.now();
                    if (onProgress && now - lastTick > 250) { lastTick = now; onProgress(done, total); }
                });
                res.pipe(out);
                out.on("finish", function () { out.close(resolve); });
                out.on("error", reject);
                res.on("error", reject);
            }).on("error", reject);
        });
    }

    /* ---------------- Download ---------------- */

    var FORMAT_ARGS = {
        // Best resolution available; prefer SDR and H.264 when resolutions tie. Converted afterwards if needed.
        max: ["-f", "bv*+ba/b", "-S", "hdr:sdr,res,fps,vcodec:h264,acodec:aac", "--merge-output-format", "mp4"],
        prores: ["-f", "bv*+ba/b", "-S", "hdr:sdr,res,fps,vcodec:h264,acodec:aac", "--merge-output-format", "mp4"],
        // Native H.264 + AAC only — no conversion step (YouTube tops out around 1080p).
        fast: ["-f", "bv*+ba/b", "-S", "vcodec:h264,acodec:aac,res,fps", "--merge-output-format", "mp4"],
        audio: ["-f", "ba/b", "-x", "--audio-format", "wav"]
    };

    function lastError(text) {
        var lines = String(text).split(/\r?\n/).filter(function (l) { return /^ERROR:/.test(l); });
        if (!lines.length) return null;
        return lines[lines.length - 1]
            .replace(/^ERROR:\s*/, "")
            .replace(/;?\s*please report this issue.*$/i, "")
            .replace(/^\[\w+\]\s*[\w-]+:\s*/, "");
    }

    /* opts: {url, dir, mode, cookies}; cb: {onTitle, onProgress(pct, speed, eta), onStage(text)}
       Returns {promise -> [filepaths], cancel()} */
    function download(opts, cb) {
        cb = cb || {};
        var child = null, cancelled = false;

        var promise = detectTools().then(function (t) {
            if (!t.ytdlp) throw new Error("yt-dlp is not installed. Click “Install tools” at the bottom of the panel.");
            fs.mkdirSync(opts.dir, { recursive: true });

            var args = [
                "--newline", "--progress", "--no-playlist", "--no-mtime", "--no-part",
                "--retries", "5", "--fragment-retries", "5", "--concurrent-fragments", "4",
                "--progress-template", "download:[SGPROG]%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
                "--print", "before_dl:[SGTITLE]%(title).150s",
                "--print", "post_process:[SGPOST]",
                "--print", "after_move:[SGFILE]%(filepath)s",
                "-P", opts.dir,
                "-o", "%(extractor_key)s - %(title).60B [%(id)s].%(ext)s"
            ].concat(FORMAT_ARGS[opts.mode] || FORMAT_ARGS.max);
            if (t.ffmpeg) args.push("--ffmpeg-location", t.ffmpeg);
            if (t.jsRuntimeArg) args.push("--js-runtimes", t.jsRuntimeArg);
            if (opts.cookies && opts.cookies !== "none") args.push("--cookies-from-browser", opts.cookies);
            args.push("--", opts.url);

            return new Promise(function (resolve, reject) {
                var files = [], errText = "", buf = { out: "", err: "" };
                child = cp.spawn(t.ytdlp, args, { env: childEnv(), windowsHide: true });

                function onLine(line) {
                    line = line.trim();
                    if (!line) return;
                    var m;
                    if ((m = /^\[SGPROG\]\s*([\d.]+)%\s*\|([^|]*)\|(.*)$/.exec(line))) {
                        cb.onProgress && cb.onProgress(parseFloat(m[1]), m[2].trim(), m[3].trim());
                    } else if (line.indexOf("[SGTITLE]") === 0) {
                        cb.onTitle && cb.onTitle(line.slice(9));
                        cb.onStage && cb.onStage("Downloading…");
                    } else if (line.indexOf("[SGPOST]") === 0) {
                        cb.onStage && cb.onStage(opts.mode === "audio" ? "Extracting audio…" : "Finishing up…");
                    } else if (line.indexOf("[SGFILE]") === 0) {
                        files.push(line.slice(8));
                    } else if (/^(ERROR|WARNING):/.test(line)) {
                        errText += line + "\n";
                    }
                }
                function feed(key, chunk) {
                    buf[key] += chunk.toString("utf8");
                    var parts = buf[key].split(/\r?\n|\r/);
                    buf[key] = parts.pop();
                    parts.forEach(onLine);
                }
                child.stdout.on("data", function (c) { feed("out", c); });
                child.stderr.on("data", function (c) { feed("err", c); });
                child.on("error", reject);
                child.on("close", function (code) {
                    onLine(buf.out); onLine(buf.err);
                    if (cancelled) return reject(new Error("Cancelled"));
                    if (code === 0 && files.length) return resolve(files);
                    reject(new Error(lastError(errText) || (code === 0 ? "No video was found at this link." : "yt-dlp exited with code " + code)));
                });
            });
        }).then(function (files) {
            // Convert anything Premiere/AE can't read natively (VP9, AV1, Opus…) one file at a time.
            var results = [];
            return files.reduce(function (p, f) {
                return p.then(function () {
                    if (cancelled) throw new Error("Cancelled");
                    return makeEditable(f, opts.mode, cb, function (c) { child = c; });
                }).then(function (out) { results.push(out); });
            }, Promise.resolve()).then(function () { return results; });
        });

        return {
            promise: promise,
            cancel: function () { cancelled = true; if (child) try { child.kill(); } catch (e) { /* gone */ } }
        };
    }

    /* ---------------- Post-processing ---------------- */

    function probe(file) {
        return detectTools().then(function (t) {
            if (t.ffprobe) {
                return run(t.ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]).then(function (r) {
                    var j = {};
                    try { j = JSON.parse(r.stdout); } catch (e) { /* ignore */ }
                    var v = (j.streams || []).filter(function (s) { return s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic); })[0];
                    var a = (j.streams || []).filter(function (s) { return s.codec_type === "audio"; })[0];
                    var fps = 30;
                    if (v && v.avg_frame_rate) { var fr = v.avg_frame_rate.split("/"); if (+fr[1]) fps = fr[0] / fr[1]; }
                    return {
                        vcodec: v ? v.codec_name : null, acodec: a ? a.codec_name : null,
                        width: v ? v.width : 0, height: v ? v.height : 0, fps: fps || 30,
                        duration: parseFloat((j.format || {}).duration) || 0
                    };
                });
            }
            return run(t.ffmpeg, ["-hide_banner", "-i", file]).then(function (r) {
                var s = r.stderr, v = /Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(s), a = /Audio: (\w+)/.exec(s);
                var d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s), f = /([\d.]+) fps/.exec(s);
                return {
                    vcodec: v ? v[1] : null, acodec: a ? a[1] : null,
                    width: v ? +v[2] : 0, height: v ? +v[3] : 0, fps: f ? +f[1] : 30,
                    duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0
                };
            });
        });
    }

    function makeEditable(file, mode, cb, setChild) {
        if (mode === "audio") return Promise.resolve(file);
        return detectTools().then(function (t) {
            if (!t.ffmpeg) return file; // can't check or convert — import as-is
            return probe(file).then(function (info) {
                var vOk = !info.vcodec || EDITABLE_VIDEO.indexOf(info.vcodec) !== -1;
                var aOk = !info.acodec || EDITABLE_AUDIO.indexOf(info.acodec) !== -1;
                var dir = path.dirname(file), base = path.basename(file, path.extname(file));

                if (mode === "prores") {
                    cb.onStage && cb.onStage("Converting to ProRes 422 HQ…");
                    var mov = path.join(dir, base + ".mov");
                    var pArgs = ["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-pix_fmt", "yuv422p10le",
                        "-c:a", "pcm_s16le"];
                    return transcode(t.ffmpeg, file, mov, pArgs, info.duration, cb, setChild).then(function () {
                        safeUnlink(file);
                        return mov;
                    });
                }
                if (vOk && aOk) return file;

                cb.onStage && cb.onStage("Converting " + (vOk ? "" : (info.vcodec || "").toUpperCase() + " ") + "to H.264 for editing…");
                var tmp = path.join(dir, base + ".converting.mp4");
                var out = path.join(dir, base + ".mp4");
                var audio = aOk ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "320k"];
                var common = ["-movflags", "+faststart"];
                if (vOk) {
                    return transcode(t.ffmpeg, file, tmp, ["-c:v", "copy"].concat(audio, common), info.duration, cb, setChild)
                        .then(function () { return finalize(file, tmp, out); });
                }
                var px = Math.max(info.width * info.height, 640 * 360);
                var bitrate = Math.round(Math.min(Math.max(px * info.fps * 0.14, 8e6), 90e6));
                var hw = ["-c:v", "h264_videotoolbox", "-b:v", String(bitrate), "-maxrate", String(Math.round(bitrate * 1.5)),
                    "-profile:v", "high", "-pix_fmt", "yuv420p", "-tag:v", "avc1"];
                var sw = ["-c:v", "libx264", "-crf", "16", "-preset", "fast", "-pix_fmt", "yuv420p", "-tag:v", "avc1"];
                var first = IS_MAC ? hw : sw;
                return transcode(t.ffmpeg, file, tmp, first.concat(audio, common), info.duration, cb, setChild)
                    .catch(function (e) {
                        if (!IS_MAC || /Cancelled/.test(e.message)) throw e;
                        return transcode(t.ffmpeg, file, tmp, sw.concat(audio, common), info.duration, cb, setChild);
                    })
                    .then(function () { return finalize(file, tmp, out); });
            });
        });
    }

    function finalize(original, tmp, out) {
        safeUnlink(original);
        if (original !== out) safeUnlink(out);
        fs.renameSync(tmp, out);
        return out;
    }

    function safeUnlink(p) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } }

    function transcode(ffmpeg, input, output, codecArgs, duration, cb, setChild) {
        return new Promise(function (resolve, reject) {
            var args = ["-hide_banner", "-y", "-i", input, "-map", "0:v:0?", "-map", "0:a:0?"].concat(codecArgs, [output]);
            var child = cp.spawn(ffmpeg, args, { env: childEnv(), windowsHide: true });
            setChild && setChild(child);
            var tail = "";
            child.stderr.on("data", function (c) {
                var s = c.toString();
                tail = (tail + s).slice(-4000);
                var m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
                if (m && duration > 0 && cb.onProgress) {
                    var sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
                    cb.onProgress(Math.min(100, sec / duration * 100), "", "");
                }
            });
            child.on("error", reject);
            child.on("close", function (code) {
                if (code === 0) return resolve(output);
                safeUnlink(output);
                if (code === null) return reject(new Error("Cancelled"));
                var errLine = tail.trim().split(/\r?\n/).pop();
                reject(new Error("Conversion failed: " + errLine));
            });
        });
    }

    /* ---------------- Misc helpers ---------------- */

    function readClipboard() {
        return IS_WIN ? run("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]).then(function (r) { return r.stdout; })
            : run("/usr/bin/pbpaste", []).then(function (r) { return r.stdout; });
    }

    function reveal(file) {
        if (IS_WIN) cp.spawn("explorer.exe", ['/select,"' + file + '"'], { windowsVerbatimArguments: true });
        else cp.spawn("/usr/bin/open", ["-R", file]);
    }

    function defaultDownloadDir() {
        var movies = path.join(HOME, IS_WIN ? "Videos" : "Movies");
        return path.join(isDir(movies) ? movies : HOME, "Social Downloads");
    }

    function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

    global.Engine = {
        detectTools: detectTools,
        installTools: installTools,
        IS_WIN: IS_WIN,
        download: download,
        readClipboard: readClipboard,
        reveal: reveal,
        makeEditable: makeEditable,
        defaultDownloadDir: defaultDownloadDir,
        joinPath: path.join,
        basename: path.basename,
        BIN_DIR: BIN_DIR
    };
})(window);
