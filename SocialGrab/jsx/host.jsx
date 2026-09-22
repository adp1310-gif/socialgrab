/* SocialGrab host script — runs inside Premiere Pro or After Effects (ExtendScript). */

function sg_isAE() {
    return typeof BridgeTalk !== "undefined" && BridgeTalk.appName === "aftereffects";
}

/* Folder of the currently saved project, or "" if the project is unsaved. */
function sg_projectDir() {
    try {
        if (sg_isAE()) {
            var f = app.project.file;
            return f ? f.parent.fsName : "";
        }
        var p = app.project.path;
        if (!p) return "";
        var file = new File(p);
        return file.exists ? file.parent.fsName : "";
    } catch (e) {
        return "";
    }
}

/* ---------- Premiere Pro ---------- */

function sg_pproFindBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c && c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    return null;
}

function sg_pproImport(path, binName) {
    var bin = app.project.rootItem;
    if (binName) {
        bin = sg_pproFindBin(binName);
        if (!bin) {
            app.project.rootItem.createBin(binName);
            bin = sg_pproFindBin(binName) || app.project.rootItem;
        }
    }
    var before = bin.children.numItems;
    var ok = app.project.importFiles([path], true, bin, false);
    if (ok === false && bin.children.numItems <= before) return "ERR:Premiere Pro could not import the file.";
    return "OK";
}

/* ---------- After Effects ---------- */

function sg_aeFindFolder(name) {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
        var it = items[i];
        if (it instanceof FolderItem && it.name === name && it.parentFolder === app.project.rootFolder) return it;
    }
    return null;
}

function sg_aeImport(path, binName) {
    app.beginUndoGroup("SocialGrab Import");
    try {
        var opts = new ImportOptions(new File(path));
        if (opts.canImportAs(ImportAsType.FOOTAGE)) opts.importAs = ImportAsType.FOOTAGE;
        var item = app.project.importFile(opts);
        if (binName) {
            var folder = sg_aeFindFolder(binName) || app.project.items.addFolder(binName);
            item.parentFolder = folder;
        }
    } finally {
        app.endUndoGroup();
    }
    return "OK";
}

/* Entry point called from the panel. Returns "OK" or "ERR:<message>". */
function sg_import(path, binName) {
    try {
        if (!app.project) return "ERR:No project is open.";
        if (!new File(path).exists) return "ERR:Downloaded file not found: " + path;
        return sg_isAE() ? sg_aeImport(path, binName) : sg_pproImport(path, binName);
    } catch (e) {
        return "ERR:" + e.toString();
    }
}
