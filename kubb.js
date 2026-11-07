/*
 * Kubb.tv — 酷播 · v7 (API api.kubb.tv)
 * list    -> /api/home/getrelativevideos
 * search  -> /api/list/getsmallvideo (SearchCriteria)
 * detail  -> /api/video/videodetails
 * servers -> devuelve la URL de la página (/play/<mediaKey>[?id=<episodeKey>])
 *            y la app extrae el m3u8 con su WebView
 */

var BASE = String(CONFIG.base || "https://m.kubb.tv").replace(/\/+$/, "");
var API = "https://api.kubb.tv";
var DEVICE_ID = "f361b57d78c7586e378fda1613bd98b7";

function clean(s) {
    return util.htmlDecode(String(s || ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

function get(url, referer) {
    var h = http.get(url, {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Origin": BASE,
        "Referer": referer || (BASE + "/")
    });
    if (!h) throw new Error("无响应 (HTTP " + http.status() + ") 来自 " + url);
    return h;
}

function api(path, params) {
    var q = [];
    for (var k in params) q.push(k + "=" + encodeURIComponent(params[k]));
    q.push("System=h5", "AppVersion=1.0", "SystemVersion=h5", "version=H3");
    var url = API + path + "?" + q.join("&") + "&v=1&DeviceId=" + DEVICE_ID + "&i18n=0";
    var txt = get(url);
    var j;
    try { j = JSON.parse(txt); } catch (e) {
        throw new Error("JSON inválido de " + path + ": " + String(txt).substring(0, 120));
    }
    if (j.ret !== undefined && j.ret !== 200) log("kubb API " + path + " ret=" + j.ret + " msg=" + j.msg);
    return { json: j, text: txt };
}

function playParts(url) {
    var u = String(url || "");
    var m = /\/play\/([A-Za-z0-9]+)/.exec(u);
    return {
        mediaKey: m ? m[1] : null,
        episodeKey: (/[?&]id=([A-Za-z0-9]+)/.exec(u) || [])[1] || ""
    };
}

// ---------- listado / búsqueda ----------

function findItems(node, out, depth) {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
        if (node.length && node[0] && typeof node[0] === "object" && (node[0].mediaKey || node[0].listPath) && node[0].title) {
            for (var i = 0; i < node.length; i++) out.push(node[i]);
            return;
        }
        for (var j = 0; j < node.length; j++) findItems(node[j], out, depth + 1);
    } else if (typeof node === "object") {
        for (var k in node) findItems(node[k], out, depth + 1);
    }
}

function itemsToCards(items) {
    var out = [], seen = {};
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var key = it.mediaKey || it.listPath;
        if (!key || seen[key]) continue;
        seen[key] = true;
        var t = String(it.typeName || it.subTitle || "");
        var isSerie = t !== "" && t.indexOf("电影") !== 0;
        out.push({
            url: BASE + "/play/" + key,
            image: it.coverImgUrl || it.img || it.image || it.cover || "",
            title: clean(it.title) || "无标题",
            type: isSerie ? "剧集" : "电影",
            kind: isSerie ? "serie" : "movie"
        });
    }
    return out;
}

function homeSlides() {
    var html = get(BASE + "/list/movie");
    var m = /var injectJson = (\{[\s\S]*?\});\s*<\/script>/.exec(html);
    if (!m) return [];
    var data;
    try { data = JSON.parse(m[1]); } catch (e) { return []; }
    var items = [];
    findItems(data, items, 0);
    return itemsToCards(items);
}

function list(page) {
    page = page || 1;
    try {
        var r = api("/api/home/getrelativevideos", { titleid: 3, page: page });
        var items = [];
        findItems(r.json, items, 0);
        var cards = itemsToCards(items);
        if (cards.length) return cards;
        log("kubb list: respuesta sin items reconocibles: " + r.text.substring(0, 300));
    } catch (e) { log("kubb list: " + e); }
    return page === 1 ? homeSlides() : [];
}

function search(query, page) {
    page = page || 1;
    try {
        var r = api("/api/list/getsmallvideo", {
            videoType: 3,
            page: page,
            size: 20,
            SearchCriteria: query
        });
        var items = [];
        findItems(r.json, items, 0);
        var cards = itemsToCards(items);
        if (!cards.length) log("kubb search sin items: " + r.text.substring(0, 400));
        return cards;
    } catch (e) {
        log("kubb search: " + e);
        return [];
    }
}

// ---------- detalle ----------

function detail(pageUrl) {
    var p = playParts(pageUrl);
    if (!p.mediaKey) throw new Error("URL sin mediaKey: " + pageUrl);

    var r = api("/api/video/videodetails", { mediaKey: p.mediaKey });
    var info = r.json && r.json.data && r.json.data.detailInfo;
    if (!info) throw new Error("videodetails sin detailInfo: " + r.text.substring(0, 200));

    var eps = info.episodes || [];
    var isMovie = String(info.typeName || "").indexOf("电影") === 0;
    var d = {
        title: clean(info.title),
        poster: info.coverImgUrl || "",
        year: info.postTime ? String(info.postTime).substring(0, 4) : "",
        synopsis: clean(info.introduce),
        isSeries: !isMovie && eps.length > 0,
        episodes: []
    };

    for (var i = 0; i < eps.length; i++) {
        var ep = eps[i];
        var mk = ep.mediaKey || p.mediaKey;
        d.episodes.push({
            url: isMovie
                ? BASE + "/play/" + mk
                : BASE + "/play/" + mk + "?id=" + ep.episodeKey,
            title: isMovie ? "立即播放" : ("第 " + (ep.episodeTitle || (i + 1)) + " 集"),
            season: "1",
            episode: String(parseInt(ep.episodeTitle, 10) || (i + 1)),
            image: info.coverImgUrl || ""
        });
    }
    if (d.episodes.length === 0) {
        d.episodes.push({ url: pageUrl, title: "立即播放", season: "1", episode: "1", image: d.poster });
    }
    return d;
}

// ---------- servers ----------

function servers(episodeUrl) {
    var p = playParts(episodeUrl);
    if (!p.mediaKey) return [];
    var url = BASE + "/play/" + p.mediaKey + (p.episodeKey ? "?id=" + p.episodeKey : "");
    return [{ url: url, name: "酷播", referer: BASE + "/" }];
}
