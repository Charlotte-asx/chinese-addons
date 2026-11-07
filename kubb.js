/*
 * Kubb.tv — 酷播 · v8 (Inicio Reparado + Servers Corregidos)
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
    var base = q.join("&") + "&v=1&DeviceId=" + DEVICE_ID + "&i18n=0&pub=" + Math.floor(new Date().getTime() / 1000);
    var url = API + path + "?" + base;
    var txt = get(url);
    var j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error("JSON inválido de " + path); }
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

// ==========================================
// PARSER DE LISTAS (A prueba de balas)
// ==========================================
function extractVideos(node, out, depth) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
        if (node.length && node[0] && typeof node[0] === 'object') {
            // Si el primer elemento parece un video, procesamos todo el array
            var first = node[0];
            if (first.mediaKey || first.listPath || (first.title && (first.coverImgUrl || first.img))) {
                for (var i = 0; i < node.length; i++) {
                    out.push(node[i]);
                }
                return;
            }
        }
        for (var j = 0; j < node.length; j++) extractVideos(node[j], out, depth + 1);
    } else if (typeof node === 'object') {
        for (var k in node) extractVideos(node[k], out, depth + 1);
    }
}

function parseVideoList(json) {
    var out = [], seen = {};
    var rawItems = [];
    
    extractVideos(json, rawItems, 0);

    for (var i = 0; i < rawItems.length; i++) {
        var it = rawItems[i];
        var key = it.mediaKey || it.listPath;
        if (!key || seen[key]) continue;
        seen[key] = true;
        
        var typeStr = String(it.typeName || it.subTitle || "");
        var isSerie = typeStr.indexOf("剧") >= 0 || typeStr.indexOf("动漫") >= 0 || typeStr.indexOf("综艺") >= 0;

        out.push({
            url: BASE + "/play/" + key,
            image: it.coverImgUrl || it.img || it.image || it.verticalImg || "",
            title: clean(it.title) || "无标题",
            type: isSerie ? "剧集" : "电影",
            kind: isSerie ? "serie" : "movie"
        });
    }
    return out;
}

function list(page) {
    page = page || 1;
    try {
        var r = api("/api/home/getrelativevideos", { titleid: 3, page: page });
        var cards = parseVideoList(r.json);
        if (cards.length > 0) return cards;
    } catch (e) {
        log("kubb list api falló: " + e);
    }

    // PLAN B: Leer el HTML de la portada si la API falla o viene vacía
    try {
        var html = get(BASE + "/list/movie" + (page > 1 ? "?page=" + page : ""));
        var m = /var injectJson = (\{[\s\S]*?\});\s*<\/script>/.exec(html);
        if (m) {
            var data = JSON.parse(m[1]);
            return parseVideoList(data);
        }
    } catch (e) {
        log("kubb list plan B falló: " + e);
    }
    
    return [];
}

function search(query, page) {
    page = page || 1;
    var r = api("/api/list/getsmallvideo", { videoType: 3, page: page, size: 20, SearchCriteria: query });
    return parseVideoList(r.json);
}

// ==========================================
// DETALLE
// ==========================================
function detail(pageUrl) {
    var p = playParts(pageUrl);
    if (!p.mediaKey) throw new Error("URL sin mediaKey");

    var r = api("/api/video/videodetails", { mediaKey: p.mediaKey });
    var info = r.json && r.json.data && r.json.data.detailInfo;
    if (!info) throw new Error("videodetails sin detailInfo");

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
            url: BASE + "/play/" + p.mediaKey + "?id=" + ep.episodeKey,
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

// ==========================================
// SERVIDORES
// ==========================================
function servers(episodeUrl) {
    var out = [];
    var p = playParts(episodeUrl);
    if (!p.mediaKey || !p.episodeKey) return out;

    try {
        var r = api("/api/video/getplaydata", {
            mediaKey: p.mediaKey,
            videoId: p.episodeKey,
            videoType: 1,
            liveLine: ""
        });

        var txt = r.text.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
        
        var re = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g;
        var m, seen = {};
        
        while ((m = re.exec(txt)) !== null) {
            var url = m[0].replace(/&amp;/g, "&");
            if (seen[url]) continue;
            seen[url] = true;
            
            out.push({
                url: url,
                name: "线路 " + (out.length + 1) + " (HLS)",
                referer: BASE + "/"
            });
        }
    } catch (e) {
        log("kubb servers error: " + e);
    }

    return out;
}
