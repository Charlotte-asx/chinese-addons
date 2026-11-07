/*
 * Kubb.tv — 酷播 · v6 (API api.kubb.tv)
 * detail  -> /api/video/videodetails (confirmado con tu JSON)
 * servers -> /api/video/getplaydata  (respuesta sin ver: se busca el .m3u8 en el texto)
 * list    -> /api/home/getrelativevideos (respuesta sin ver: parser genérico)
 * search  -> pendiente (falta la URL XHR)
 */

var BASE = String(CONFIG.base || "https://m.kubb.tv").replace(/\/+$/, "");
var API = "https://api.kubb.tv";
var DEVICE_ID = "f361b57d78c7586e378fda1613bd98b7";

var RTMP = {}; // m3u8 de las slides del home (respaldo)

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

// TODO: si el servidor exige "vv" (firma), hay que calcularlo aquí.
function sign(query) { return ""; }

function api(path, params) {
    var q = [];
    for (var k in params) q.push(k + "=" + encodeURIComponent(params[k]));
    q.push("System=h5", "AppVersion=1.0", "SystemVersion=h5", "version=H3");
    var base = q.join("&") + "&v=1&DeviceId=" + DEVICE_ID + "&i18n=0&pub=" + Math.floor(new Date().getTime() / 1000);
    var vv = sign(base);
    var url = API + path + "?" + base + (vv ? "&vv=" + vv : "");
    var txt = get(url);
    var j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error("JSON inválido de " + path + ": " + String(txt).substring(0, 120)); }
    if (j.ret !== undefined && j.ret !== 200) log("kubb API " + path + " ret=" + j.ret + " msg=" + j.msg);
    return { json: j, text: txt };
}

function playParts(url) {
    var u = String(url || "");
    var m = /\/play\/([A-Za-z0-9]+)/.exec(u);
    return {
        mediaKey: m ? m[1] : null,
        episodeKey: (/[?&]id=([A-Za-z0-9]+)/.exec(u) || [])[1] || "",
        vid: (/[?&]vid=(\d+)/.exec(u) || [])[1] || "",
        vt: (/[?&]vt=(\d+)/.exec(u) || [])[1] || "1"
    };
}

// ---------- listado ----------

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
        if (it.rtmp) RTMP[key] = it.rtmp;
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
    // TODO: falta la URL XHR de búsqueda.
    log("kubb search: falta endpoint");
    return [];
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
        d.episodes.push({
            url: BASE + "/play/" + (ep.mediaKey || p.mediaKey) + "?id=" + ep.episodeKey +
                 "&vid=" + ep.episodeId + "&vt=" + (ep.videoType || 1),
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
    var out = [];
    var p = playParts(episodeUrl);
    if (!p.mediaKey) return out;

    // Si la URL no trae vid (ej. viene del home), se saca del primer episodio
    if (!p.vid) {
        try {
            var dr = api("/api/video/videodetails", { mediaKey: p.mediaKey });
            var e0 = dr.json.data.detailInfo.episodes[0];
            p.vid = String(e0.episodeId);
            p.vt = String(e0.videoType || 1);
        } catch (e) { log("kubb servers detalle: " + e); }
    }

    if (p.vid) {
        try {
            var r = api("/api/video/getplaydata", { mediaKey: p.mediaKey, videoId: p.vid, videoType: p.vt, liveLine: "" });
            var txt = r.text.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
            var re = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g, m, seen = {};
            while ((m = re.exec(txt)) !== null) {
                if (seen[m[0]]) continue;
                seen[m[0]] = true;
                out.push({ url: m[0], name: "线路 " + (out.length + 1) + " (HLS)", referer: BASE + "/" });
            }
            if (out.length === 0) log("kubb getplaydata sin m3u8: " + r.text.substring(0, 400));
        } catch (e) { log("kubb getplaydata: " + e); }
    }

    // respaldo: m3u8 de las slides del home
    if (out.length === 0 && RTMP[p.mediaKey]) {
        out.push({ url: RTMP[p.mediaKey], name: "线路一 (HLS)", referer: BASE + "/" });
    }
    return out;
}
