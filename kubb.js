/*
 * Kubb.tv — 酷播 · v7 (Final)
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

// ---------- LIST & SEARCH ----------

function parseVideoList(json) {
    var out = [];
    var items = json.data && json.data.list ? json.data.list : (json.data || []);
    if (!Array.isArray(items)) return out;

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var key = it.mediaKey || it.listPath;
        if (!key) continue;
        
        var typeStr = String(it.typeName || "");
        var isSerie = typeStr.indexOf("剧") >= 0 || typeStr.indexOf("动漫") >= 0;

        out.push({
            url: BASE + "/play/" + key,
            image: it.coverImgUrl || it.img || it.image || "",
            title: clean(it.title) || "无标题",
            type: isSerie ? "剧集" : "电影",
            kind: isSerie ? "serie" : "movie"
        });
    }
    return out;
}

function list(page) {
    page = page || 1;
    var r = api("/api/home/getrelativevideos", { titleid: 3, page: page });
    return parseVideoList(r.json);
}

function search(query, page) {
    page = page || 1;
    // Endpoint descubierto en tus capturas
    var r = api("/api/list/getsmallvideo", { videoType: 3, page: page, size: 20, SearchCriteria: query });
    return parseVideoList(r.json);
}

// ---------- DETAIL ----------

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
        // IMPORTANTE: Se añade el ?id= exacto a la URL para que servers() lo lea
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

// ---------- SERVERS ----------

function servers(episodeUrl) {
    var out = [];
    var p = playParts(episodeUrl);
    if (!p.mediaKey || !p.episodeKey) {
        log("kubb servers: Faltan IDs en la URL (" + episodeUrl + ")");
        return out;
    }

    try {
        // Pedimos los datos de reproducción usando el episodeKey (?id=)
        var r = api("/api/video/getplaydata", {
            mediaKey: p.mediaKey,
            videoId: p.episodeKey,
            videoType: 1,
            liveLine: ""
        });

        // A veces el JSON viene con barras escapadas
        var txt = r.text.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
        
        // Buscar enlaces .m3u8
        var re = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g;
        var m, seen = {};
        
        while ((m = re.exec(txt)) !== null) {
            var url = m[0].replace(/&amp;/g, "&");
            if (seen[url]) continue;
            seen[url] = true;
            
            out.push({
                url: url,
                name: "线路 " + (out.length + 1) + " (HLS)",
                // Añadimos un referer limpio, ya que el de dudupro a veces da problemas
                referer: BASE + "/"
            });
        }

        if (out.length === 0) {
            // Si no encontró el m3u8, mostramos un log con lo que devolvió para depurar
            log("kubb getplaydata sin m3u8. Respuesta: " + r.text.substring(0, 300));
        }

    } catch (e) {
        log("kubb getplaydata error: " + e);
    }

    return out;
}
